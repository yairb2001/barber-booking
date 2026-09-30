/**
 * Our own WhatsApp server (Evolution API on the OpenClaw box) — the unofficial
 * channel without Green's per-number fee (docs/PLAN-MASTER.md, "ערוצי וואטסאפ
 * ומדידה" §2). One Evolution instance per business, named after the business
 * slug; the server keeps no message history (only session keys) and pushes
 * every event to /api/webhook/evolution, which translates it into the shape the
 * Green webhook already understands.
 *
 * Env (Vercel): EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_SECRET.
 * Server files: /opt/chator-wa on manceo-server (docker compose).
 */
import type { MessagingProvider, ProviderConfig, SendResult } from "./types";
import { normalizeIsraeliPhone } from "./phone";

const BASE = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
const KEY = process.env.EVOLUTION_API_KEY || "";

export function evolutionConfigured(): boolean { return !!BASE && !!KEY; }

async function api<T = unknown>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, timeoutMs = 20_000): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  if (!evolutionConfigured()) return { ok: false, status: 0, data: null, error: "evolution_not_configured" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers: { apikey: KEY, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal, cache: "no-store" });
    const text = await res.text();
    let data: T | null = null;
    try { data = text ? JSON.parse(text) as T : null; } catch { data = null; }
    if (!res.ok) return { ok: false, status: res.status, data, error: `Evolution HTTP ${res.status}: ${text.slice(0, 200)}` };
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : "network" };
  } finally { clearTimeout(t); }
}

/** Evolution's connection states → the labels the app already uses for Green. */
function mapState(s: string | undefined): string {
  switch (s) {
    case "open": return "authorized";
    case "connecting": return "starting";
    case "close": return "notAuthorized";
    default: return s || "unknown";
  }
}

export class EvolutionProvider implements MessagingProvider {
  private instance: string | null;
  constructor(config: ProviderConfig) { this.instance = config.evolutionInstance ?? null; }

  isConfigured(): boolean { return evolutionConfigured() && !!this.instance; }

  async sendText(phone: string, body: string): Promise<SendResult> {
    if (!this.isConfigured()) return { ok: false, error: "provider_not_configured" };
    const r = await api<{ key?: { id?: string } }>("POST", `/message/sendText/${this.instance}`, { number: normalizeIsraeliPhone(phone), text: body });
    return r.ok ? { ok: true, providerId: r.data?.key?.id } : { ok: false, error: r.error };
  }

  /** .ogg → a real voice note (sendWhatsAppAudio); anything else → media by URL. */
  async sendFileByUrl(phone: string, file: { urlFile: string; fileName: string; caption?: string }): Promise<SendResult> {
    if (!this.isConfigured()) return { ok: false, error: "provider_not_configured" };
    const number = normalizeIsraeliPhone(phone);
    const ext = (file.fileName.split(".").pop() || "").toLowerCase();
    const r = ext === "ogg" || ext === "opus"
      ? await api<{ key?: { id?: string } }>("POST", `/message/sendWhatsAppAudio/${this.instance}`, { number, audio: file.urlFile })
      : await api<{ key?: { id?: string } }>("POST", `/message/sendMedia/${this.instance}`, {
          number, mediatype: /^(jpe?g|png|gif|webp)$/.test(ext) ? "image" : /^(mp4|mov|3gp)$/.test(ext) ? "video" : "document",
          media: file.urlFile, fileName: file.fileName, caption: file.caption ?? "",
        });
    return r.ok ? { ok: true, providerId: r.data?.key?.id } : { ok: false, error: r.error };
  }

  async getState(): Promise<{ ok: boolean; state?: string; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "provider_not_configured" };
    const r = await api<{ instance?: { state?: string } }>("GET", `/instance/connectionState/${this.instance}`);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, state: mapState(r.data?.instance?.state) };
  }

  async reboot(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "provider_not_configured" };
    const r = await api("PUT", `/instance/restart/${this.instance}`);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  /** Linking QR (data URL) or, when already linked, connected=true through getState. */
  async getQr(): Promise<{ ok: boolean; type?: string; qr?: string; message?: string; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: "provider_not_configured" };
    const r = await api<{ base64?: string; code?: string; pairingCode?: string; instance?: { state?: string }; count?: number }>("GET", `/instance/connect/${this.instance}`);
    if (!r.ok) return { ok: false, error: r.error };
    if (r.data?.base64) return { ok: true, type: "qrCode", qr: r.data.base64 };
    if (r.data?.instance?.state === "open") return { ok: true, type: "alreadyLogged", message: "connected" };
    return { ok: true, type: "pending", message: "no qr yet" };
  }

  /** Unlink the number (the instance stays; a new QR relinks). */
  async logout(): Promise<{ ok: boolean; error?: string }> {
    const r = await api("DELETE", `/instance/logout/${this.instance}`);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
}

// ─── Instance lifecycle (super-admin) ───────────────────────────────────────

const WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"];

export function evolutionWebhookUrl(): string {
  const app = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
  return `${app}/api/webhook/evolution?key=${encodeURIComponent(process.env.EVOLUTION_WEBHOOK_SECRET || "")}`;
}

/** Create (or re-point the webhook of) the instance for a business. Idempotent. */
export async function ensureEvolutionInstance(name: string): Promise<{ ok: boolean; created: boolean; error?: string }> {
  if (!evolutionConfigured()) return { ok: false, created: false, error: "evolution_not_configured" };
  const existing = await api<{ instance?: { instanceName?: string } }[] | { instance?: { instanceName?: string } }>("GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`);
  const found = existing.ok && (Array.isArray(existing.data) ? existing.data.length > 0 : !!existing.data);
  if (!found) {
    const r = await api("POST", "/instance/create", {
      instanceName: name, qrcode: true, integration: "WHATSAPP-BAILEYS",
      webhook: { url: evolutionWebhookUrl(), byEvents: false, base64: false, events: WEBHOOK_EVENTS },
      // Behaviour of the number, same as Green's defaults for a shop
      rejectCall: false, groupsIgnore: true, alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: false,
    });
    if (!r.ok) return { ok: false, created: false, error: r.error };
    return { ok: true, created: true };
  }
  const w = await api("POST", `/webhook/set/${name}`, { webhook: { enabled: true, url: evolutionWebhookUrl(), byEvents: false, base64: false, events: WEBHOOK_EVENTS } });
  return { ok: w.ok, created: false, error: w.error };
}

export async function deleteEvolutionInstance(name: string): Promise<{ ok: boolean; error?: string }> {
  await api("DELETE", `/instance/logout/${name}`).catch(() => null);
  const r = await api("DELETE", `/instance/delete/${name}`);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Media of an incoming message as a data: URL (the server keeps no files). */
export async function evolutionMediaDataUrl(instance: string, key: { id: string; remoteJid: string; fromMe: boolean }): Promise<string | null> {
  const r = await api<{ base64?: string; mimetype?: string }>("POST", `/chat/getBase64FromMediaMessage/${instance}`, { message: { key }, convertToMp4: false }, 40_000);
  if (!r.ok || !r.data?.base64) return null;
  return `data:${r.data.mimetype || "application/octet-stream"};base64,${r.data.base64}`;
}

/** Health of the server itself (the cron alerts the owner when this fails). */
export async function evolutionServerOk(): Promise<{ ok: boolean; version?: string; error?: string }> {
  const r = await api<{ version?: string }>("GET", "/", undefined, 10_000);
  return r.ok ? { ok: true, version: r.data?.version } : { ok: false, error: r.error };
}
