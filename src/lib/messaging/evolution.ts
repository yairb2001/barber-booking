/**
 * Our own WhatsApp server — the unofficial channel without Green's per-number
 * fee (docs/PLAN-MASTER.md §4ג, "ערוצי וואטסאפ ומדידה" §2).
 *
 * ENGINE (since 1.10.2026): GOWA (aldinokemal/go-whatsapp-web-multidevice, MIT,
 * built on whatsmeow) on manceo-server. It replaced Evolution API the day after
 * it was installed: Evolution's stable build could no longer link devices
 * (WhatsApp's July-2026 companion_reg_refresh step) and its fixed build (2.4)
 * requires a licence activation that transmits the API key and usage counters to
 * its vendor. GOWA has no licence, no telemetry, the pairing fix, and ~10 MB RAM.
 *
 * The exported names keep the word "evolution" (and Business.messagingProvider
 * stays "evolution", Business.evolutionInstance = the device id) so nothing
 * else in the app had to change: read "evolution" as "our own server".
 *
 * One device per business (id = the business slug). The server keeps no chat
 * history (WHATSAPP_CHAT_STORAGE=false), only the session keys. Every incoming
 * message is POSTed to /api/webhook/gowa, HMAC-signed, and translated there into
 * the shape the Green webhook handler already understands.
 *
 * Env (Vercel): GOWA_URL, GOWA_BASIC_AUTH ("user:pass"), GOWA_WEBHOOK_SECRET.
 * Server files: /opt/chator-wa on manceo-server (docker compose).
 */
import type { MessagingProvider, ProviderConfig, SendResult } from "./types";
import { normalizeIsraeliPhone } from "./phone";

const BASE = (process.env.GOWA_URL || "").replace(/\/+$/, "");
const AUTH = process.env.GOWA_BASIC_AUTH || "";

export function evolutionConfigured(): boolean { return !!BASE && !!AUTH; }

const authHeader = () => ({ Authorization: `Basic ${Buffer.from(AUTH).toString("base64")}` });

type Envelope<T> = { code?: string; message?: string; results?: T };

async function api<T = unknown>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, opts: { device?: string | null; json?: unknown; form?: FormData; timeoutMs?: number } = {}): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  if (!evolutionConfigured()) return { ok: false, status: 0, data: null, error: "wa_server_not_configured" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const headers: Record<string, string> = { ...authHeader() };
    if (opts.device) headers["X-Device-Id"] = opts.device;
    if (opts.json !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.form ?? (opts.json === undefined ? undefined : JSON.stringify(opts.json)), signal: ctrl.signal, cache: "no-store" });
    const text = await res.text();
    let env: Envelope<T> | null = null;
    try { env = text ? JSON.parse(text) as Envelope<T> : null; } catch { env = null; }
    if (!res.ok) return { ok: false, status: res.status, data: env?.results ?? null, error: `WA server HTTP ${res.status}: ${(env?.message || text).slice(0, 200)}` };
    return { ok: true, status: res.status, data: (env?.results ?? null) as T | null };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : "network" };
  } finally { clearTimeout(t); }
}

/** The server answers "device … not found" with HTTP 500, not 404. */
const missing = (r: { status: number; error?: string }) => r.status === 404 || /not found/i.test(r.error ?? "");

/** Asking the server for a QR restarts the linking session, so the last QR is reused for a while (per warm instance). */
const QR_REUSE_MS = 30_000;
const qrCache = new Map<string, { qr: string; at: number }>();

const jid = (phone: string) => `${normalizeIsraeliPhone(phone)}@s.whatsapp.net`;

export class EvolutionProvider implements MessagingProvider {
  private device: string | null;
  constructor(config: ProviderConfig) { this.device = config.evolutionInstance ?? null; }

  isConfigured(): boolean { return evolutionConfigured() && !!this.device; }

  async sendText(phone: string, body: string): Promise<SendResult> {
    if (!this.isConfigured()) return { ok: false, error: "provider_not_configured" };
    const r = await api<{ message_id?: string }>("POST", "/send/message", { device: this.device, json: { phone: jid(phone), message: body } });
    return r.ok ? { ok: true, providerId: r.data?.message_id } : { ok: false, error: r.error };
  }

  /** .ogg → a real voice note (ptt); images by URL; anything else as a file by URL. */
  async sendFileByUrl(phone: string, file: { urlFile: string; fileName: string; caption?: string }): Promise<SendResult> {
    if (!this.isConfigured()) return { ok: false, error: "provider_not_configured" };
    const ext = (file.fileName.split(".").pop() || "").toLowerCase();
    const form = new FormData();
    form.set("phone", jid(phone));
    let path = "/send/file";
    if (ext === "ogg" || ext === "opus") { path = "/send/audio"; form.set("audio_url", file.urlFile); form.set("ptt", "true"); }
    else if (/^(jpe?g|png|gif|webp)$/.test(ext)) { path = "/send/image"; form.set("image_url", file.urlFile); if (file.caption) form.set("caption", file.caption); }
    else { form.set("file_url", file.urlFile); if (file.caption) form.set("caption", file.caption); }
    const r = await api<{ message_id?: string }>("POST", path, { device: this.device, form, timeoutMs: 45_000 });
    return r.ok ? { ok: true, providerId: r.data?.message_id } : { ok: false, error: r.error };
  }

  /** Mapped to the labels the app already uses for Green: authorized / starting / notAuthorized. */
  async getState(): Promise<{ ok: boolean; state?: string; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "provider_not_configured" };
    const r = await api<{ is_connected?: boolean; is_logged_in?: boolean }>("GET", `/devices/${this.device}/status`);
    if (!r.ok) return missing(r) ? { ok: true, state: "notAuthorized" } : { ok: false, error: r.error };
    const s = r.data ?? {};
    return { ok: true, state: s.is_logged_in && s.is_connected ? "authorized" : s.is_logged_in ? "starting" : "notAuthorized" };
  }

  async reboot(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "provider_not_configured" };
    const r = await api("POST", `/devices/${this.device}/reconnect`);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  /** Linking QR as a data URL (the server hands out a PNG link; the owner's browser can't fetch it without our credentials). */
  async getQr(): Promise<{ ok: boolean; type?: string; qr?: string; message?: string; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "provider_not_configured" };
    const cached = qrCache.get(this.device!);
    if (cached && Date.now() - cached.at < QR_REUSE_MS) return { ok: true, type: "qrCode", qr: cached.qr };
    let r = await api<{ qr_link?: string; qr_duration?: number }>("GET", `/devices/${this.device}/login`, { timeoutMs: 30_000 });
    if (!r.ok && missing(r)) {
      // The device slot is gone (server reinstall) — recreate it and try once more.
      const made = await ensureEvolutionInstance(this.device!);
      if (!made.ok) return { ok: false, error: made.error };
      r = await api<{ qr_link?: string; qr_duration?: number }>("GET", `/devices/${this.device}/login`, { timeoutMs: 30_000 });
    }
    if (!r.ok) {
      if (/already|logged in/i.test(r.error ?? "")) return { ok: true, type: "alreadyLogged", message: "connected" };
      return { ok: false, error: r.error };
    }
    const link = r.data?.qr_link;
    if (!link) return { ok: true, type: "pending", message: "no qr yet" };
    const png = await fetchAsDataUrl(link.replace(/^https?:\/\/[^/]+/, ""), "image/png");
    if (!png) return { ok: false, error: "qr image unavailable" };
    qrCache.set(this.device!, { qr: png, at: Date.now() });
    return { ok: true, type: "qrCode", qr: png };
  }

  /** Unlink the number (the device slot stays; a new QR relinks). */
  async logout(): Promise<{ ok: boolean; error?: string }> {
    const r = await api("POST", `/devices/${this.device}/logout`);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
}

// ─── Device lifecycle (super-admin) ─────────────────────────────────────────

export function evolutionWebhookUrl(): string {
  const app = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
  return `${app}/api/webhook/gowa`;
}

/** Create the device slot for a business (or re-point its webhook). Idempotent. */
export async function ensureEvolutionInstance(name: string): Promise<{ ok: boolean; created: boolean; error?: string }> {
  if (!evolutionConfigured()) return { ok: false, created: false, error: "wa_server_not_configured" };
  const hook = { webhook_url: evolutionWebhookUrl(), webhook_secret: process.env.GOWA_WEBHOOK_SECRET || "", webhook_events: "message" };
  const existing = await api("GET", `/devices/${name}`);
  if (existing.ok) {
    const w = await api("PATCH", `/devices/${name}/webhook`, { json: hook });
    return { ok: w.ok, created: false, error: w.error };
  }
  const r = await api("POST", "/devices", { json: { device_id: name, ...hook } });
  return r.ok ? { ok: true, created: true } : { ok: false, created: false, error: r.error };
}

/** "קישור באמצעות מספר הטלפון": an 8-character code bound to the business's number. */
export async function pairingCodeForNumber(name: string, number: string): Promise<{ ok: boolean; code?: string; error?: string }> {
  const made = await ensureEvolutionInstance(name);
  if (!made.ok) return { ok: false, error: made.error };
  qrCache.delete(name);
  const r = await api<{ pair_code?: string }>("POST", `/devices/${name}/login/code?phone=${encodeURIComponent(number.replace(/\D/g, ""))}`, { timeoutMs: 30_000 });
  if (!r.ok) return { ok: false, error: r.error };
  const code = (r.data?.pair_code || "").replace(/[^A-Za-z0-9]/g, "");
  return code ? { ok: true, code } : { ok: false, error: "no pairing code" };
}

export async function deleteEvolutionInstance(name: string): Promise<{ ok: boolean; error?: string }> {
  await api("POST", `/devices/${name}/logout`).catch(() => null);
  const r = await api("DELETE", `/devices/${name}`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** A file the server holds (QR image, downloaded media) as a data: URL — it sits behind our basic auth. */
export async function fetchAsDataUrl(path: string, fallbackMime = "application/octet-stream"): Promise<string | null> {
  if (!evolutionConfigured()) return null;
  try {
    const res = await fetch(`${BASE}/${path.replace(/^\/+/, "")}`, { headers: authHeader(), cache: "no-store", signal: AbortSignal.timeout(40_000) });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") || fallbackMime).split(";")[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

/** Health of the server itself (the cron alerts the owner when this fails). */
export async function evolutionServerOk(): Promise<{ ok: boolean; version?: string; error?: string }> {
  if (!evolutionConfigured()) return { ok: false, error: "wa_server_not_configured" };
  try {
    const res = await fetch(`${BASE}/health`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "network" }; }
}
