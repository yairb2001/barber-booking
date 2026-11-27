/**
 * Click-to-WhatsApp ads (27.11.2026, the marketing manager: ads to WhatsApp were never measured). GOWA sends the ad on the
 * first message (payload.referral); the webhook keeps it on the conversation, and a booking from that chat carries it in
 * appointments.attribution, in the same shape as a booking from the site (attribution.ts), so one report reads both.
 */
import { prisma } from "@/lib/prisma";

export type GowaReferral = { source_id?: string; ctwa_clid?: string; source_url?: string; ad_title?: string; source_app?: string };
export type AdAttribution = { source: "meta"; medium: "ctwa"; content?: string; ctwa_clid?: string; headline?: string; ts: number };

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // as the site's last-visit attribution
const cut = (x: unknown, n = 120) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : undefined);

/** The JSON stored on the conversation; null when the message did not come from an ad. */
export function adReferralJson(r: GowaReferral | null | undefined, now = Date.now()): string | null {
  if (!r || typeof r !== "object") return null;
  const a: AdAttribution = { source: "meta", medium: "ctwa", content: cut(r.source_id), ctwa_clid: cut(r.ctwa_clid, 300), headline: cut(r.ad_title), ts: now };
  return a.content || a.ctwa_clid ? JSON.stringify(a) : null;
}

/** The ad this conversation started from, when it is no older than 30 days. */
export async function adOfConversation(conversationId: string): Promise<AdAttribution | null> {
  const c = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { adReferral: true } }).catch(() => null);
  if (!c?.adReferral) return null;
  try { const a = JSON.parse(c.adReferral) as AdAttribution; return Date.now() - a.ts <= TTL_MS ? a : null; } catch { return null; }
}

/** A customer with no source yet gets the ad as his first touch. */
export async function creditCustomer(customerId: string, ad: AdAttribution | null): Promise<void> {
  if (!ad) return;
  await prisma.customer.updateMany({ where: { id: customerId, utmSource: null }, data: { utmSource: ad.source, utmContent: ad.content ?? null } });
}
