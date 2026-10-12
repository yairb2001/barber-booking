/**
 * Instagram DMs (spec: Claude Docs "תוכנית‑העל" › "ערוץ אינסטגרם", step 4:
 * the skeleton, no agent yet).
 *
 * A conversation whose key (the `phone` column) is `ig:<IGSID>` lives on
 * Instagram: deliverMessageLog routes it here instead of WhatsApp, so every
 * caller of sendMessage / sendProactiveMessage works unchanged. Text only.
 * Meta lets a business answer for 24 hours after the customer's last message;
 * outside that window the send is skipped with "instagram_window_closed"
 * (reminders and follow-ups stay on WhatsApp, by phone).
 *
 * The connected account sits in Business.settings.instagram =
 *   { igUserId, username, enabled }   (enabled=false → the webhook only logs)
 * Token: INSTAGRAM_ACCESS_TOKEN — one account for now (@chator.il); per-business
 * encrypted tokens come with the connect page (step 7).
 */
import { prisma } from "@/lib/prisma";
import type { SendResult } from "./types";

export const IG_PREFIX = "ig:";
export const isInstagramKey = (key: string | null | undefined): boolean => !!key && key.startsWith(IG_PREFIX);
export const igKey = (igsid: string): string => `${IG_PREFIX}${igsid}`;
export const igsidOf = (key: string): string => key.slice(IG_PREFIX.length);

const GRAPH = "https://graph.instagram.com/v23.0";
const MAX_BYTES = 1000;            // Meta's limit for one text message
export const INSTAGRAM_WINDOW_MS = 24 * 3600_000;

/**
 * enabled: DMs reach the inbox. agent: who the agent answers on Instagram:
 * "off" (nobody, the default), "test" (only the IGSIDs in testers), "on" (everyone).
 */
export type InstagramAccount = { igUserId: string; username: string | null; enabled: boolean; agent: "off" | "test" | "on"; testers: string[] };

export function instagramAccountOf(settings: string | null | undefined): InstagramAccount | null {
  try {
    const ig = (settings ? JSON.parse(settings) : {})?.instagram;
    if (!ig?.igUserId) return null;
    const agent = ig.agent === "on" || ig.agent === "test" ? ig.agent : "off";
    const testers = Array.isArray(ig.testers) ? ig.testers.map((t: unknown) => String(t)) : [];
    return { igUserId: String(ig.igUserId), username: ig.username ? String(ig.username) : null, enabled: ig.enabled === true, agent, testers };
  } catch {
    return null;
  }
}

/** Does the agent answer this sender on this account? */
export function instagramAgentAnswers(account: InstagramAccount, igsid: string): boolean {
  return account.enabled && (account.agent === "on" || (account.agent === "test" && account.testers.includes(igsid)));
}

/** The business whose settings.instagram.igUserId is this Instagram professional account. */
export async function businessForInstagramAccount(igUserId: string): Promise<{ id: string; name: string; account: InstagramAccount } | null> {
  const rows = await prisma.business.findMany({ where: { settings: { contains: igUserId } }, select: { id: true, name: true, settings: true } });
  for (const b of rows) {
    const account = instagramAccountOf(b.settings);
    if (account?.igUserId === igUserId) return { id: b.id, name: b.name, account };
  }
  return null;
}

function accessToken(): string | null {
  return process.env.INSTAGRAM_ACCESS_TOKEN?.trim() || null;
}

/** WhatsApp bold (*x*) means nothing on Instagram: drop the markers. */
export function plainForInstagram(text: string): string {
  return text.replace(/\*([^*\n]+)\*/g, "$1");
}

/** Pieces of at most 1000 UTF-8 bytes (about 500 Hebrew letters), cut on whitespace. */
export function splitForInstagram(text: string): string[] {
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");
  const out: string[] = [];
  let cur = "";
  for (const token of text.split(/(\s+)/)) {
    if (bytes(cur + token) <= MAX_BYTES) { cur += token; continue; }
    if (cur.trim()) out.push(cur.trim());
    cur = "";
    // A single word longer than the limit (a long link): cut it by characters.
    let word = token;
    while (bytes(word) > MAX_BYTES) {
      let n = word.length;
      while (bytes(word.slice(0, n)) > MAX_BYTES) n--;
      out.push(word.slice(0, n));
      word = word.slice(n);
    }
    cur = /^\s+$/.test(word) ? "" : word;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Send a text DM. providerId = every message id Meta returned, comma-joined (echo matching). */
export async function sendInstagramText(igsid: string, text: string): Promise<SendResult> {
  const token = accessToken();
  if (!token) return { ok: false, error: "instagram_not_configured" };
  const ids: string[] = [];
  for (const part of splitForInstagram(plainForInstagram(text))) {
    try {
      const res = await fetch(`${GRAPH}/me/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: igsid }, message: { text: part } }),
      });
      const j = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { code?: number; message?: string } };
      if (!res.ok || j.error) {
        return { ok: false, providerId: ids.join(",") || undefined, error: `instagram_${j.error?.code ?? res.status}: ${String(j.error?.message ?? "").slice(0, 160)}` };
      }
      if (j.message_id) ids.push(j.message_id);
    } catch {
      return { ok: false, providerId: ids.join(",") || undefined, error: "instagram_network" };
    }
  }
  return { ok: true, providerId: ids.join(",") || undefined };
}

/** Did the customer write within the last 24 hours (Meta's reply window)? */
export async function instagramWindowOpen(businessId: string, key: string): Promise<boolean> {
  const last = await prisma.conversationMessage.findFirst({
    where: { role: "user", conversation: { businessId, phone: key } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return !!last && Date.now() - last.createdAt.getTime() < INSTAGRAM_WINDOW_MS;
}

/** deliverMessageLog's Instagram branch: send an existing MessageLog row and record the result. */
export async function deliverInstagramLog(
  log: { id: string; customerPhone: string; body: string },
  businessId: string,
): Promise<SendResult> {
  // A template's "---" part breaks are WhatsApp bubbles; on Instagram they become paragraphs.
  const body = log.body.split(/\n\s*-{3,}\s*\n/).join("\n\n");
  const result: SendResult = (await instagramWindowOpen(businessId, log.customerPhone))
    ? await sendInstagramText(igsidOf(log.customerPhone), body)
    : { ok: false, error: "instagram_window_closed" };
  await prisma.messageLog.update({
    where: { id: log.id },
    data: {
      status: result.ok ? "sent" : "failed",
      providerId: result.providerId,
      error: result.error,
      sentAt: result.ok ? new Date() : null,
    },
  });
  return result;
}

/** The customer's Instagram name (or username) for the chat list; null when Meta won't say. */
export async function instagramProfileName(igsid: string): Promise<string | null> {
  const token = accessToken();
  if (!token) return null;
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(igsid)}?fields=name,username`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as { name?: string; username?: string };
    return (j.name || "").trim() || (j.username ? `@${j.username}` : null);
  } catch {
    return null;
  }
}

/** Hebrew line for a send that failed, for the person who pressed "send". */
export function instagramSendError(error: string | undefined): string {
  if (error === "instagram_window_closed") return "עברו 24 שעות מההודעה האחרונה שלו. אינסטגרם לא מאפשר לשלוח לו עד שיכתוב שוב.";
  if (error === "instagram_not_configured") return "אינסטגרם עוד לא מחובר במערכת (חסר טוקן).";
  return "ההודעה לא יצאה באינסטגרם. נסה שוב בעוד רגע.";
}
