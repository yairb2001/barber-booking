/**
 * Web Push (browser / iOS-PWA) sender + subscription storage.
 *
 * Complements the native APNs sender (push.ts). This path needs NO Apple
 * Developer account: it uses the standard Web Push protocol (VAPID), which
 * Apple routes to installed home-screen PWAs on iOS 16.4+, plus Android/desktop.
 *
 * The VAPID public key is hardcoded below (safe to expose — the browser needs
 * it to subscribe). The private key is read from the business settings
 * (seeded once) or the VAPID_PRIVATE_KEY env, so nothing secret sits in git.
 * Every subscriber (owner AND each barber) shares the one business-level
 * VAPID key pair — only the list of subscribed devices differs per person.
 *
 * Owner subscriptions live in Business.settings.ownerWebPushSubs[].
 * Barber subscriptions live in Staff.settings.webPushSubs[] — mirrors the
 * pushTokens[] pattern already used for native APNs in push.ts.
 * Per-type toggles (default ON): notifyOnAppointments, notifyOnEscalation —
 * same field names on both Business.settings and Staff.settings.
 */
import webpush from "web-push";
import { prisma } from "@/lib/prisma";

/** Public VAPID key — safe to expose to the browser. */
export const VAPID_PUBLIC_KEY =
  "BALFgMY0H30c5JqnYgWD7KtZrdgiHpAZKtqmzmFTVYAUUQMmMigPjy7STwMyjdCJmKNPtDk53Nk-un3YvNljU9M";

export type WebPushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
export type NotifyType = "appointment" | "escalation";

function parseSettings(raw: string | null): Record<string, unknown> {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function subsOf(s: Record<string, unknown>, field: string): WebPushSub[] {
  return Array.isArray(s[field]) ? (s[field] as WebPushSub[]) : [];
}

/** Save (or refresh) a browser push subscription for the business owner. */
export async function saveWebPushSub(businessId: string, sub: WebPushSub): Promise<void> {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } });
  if (!biz) return;
  const s = parseSettings(biz.settings);
  const deduped = subsOf(s, "ownerWebPushSubs").filter(x => x.endpoint !== sub.endpoint);
  deduped.push(sub);
  s.ownerWebPushSubs = deduped.slice(-10); // keep the last ~10 devices
  await prisma.business.update({ where: { id: businessId }, data: { settings: JSON.stringify(s) } });
}

/** Remove a subscription (e.g. the user turned notifications off on a device). */
export async function removeWebPushSub(businessId: string, endpoint: string): Promise<void> {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } });
  if (!biz) return;
  const s = parseSettings(biz.settings);
  s.ownerWebPushSubs = subsOf(s, "ownerWebPushSubs").filter(x => x.endpoint !== endpoint);
  await prisma.business.update({ where: { id: businessId }, data: { settings: JSON.stringify(s) } });
}

/** Save (or refresh) a browser push subscription for a specific barber. */
export async function saveStaffWebPushSub(staffId: string, sub: WebPushSub): Promise<void> {
  const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { settings: true } });
  if (!staff) return;
  const s = parseSettings(staff.settings);
  const deduped = subsOf(s, "webPushSubs").filter(x => x.endpoint !== sub.endpoint);
  deduped.push(sub);
  s.webPushSubs = deduped.slice(-10);
  await prisma.staff.update({ where: { id: staffId }, data: { settings: JSON.stringify(s) } });
}

/** Remove a barber's subscription (e.g. they turned notifications off on a device). */
export async function removeStaffWebPushSub(staffId: string, endpoint: string): Promise<void> {
  const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { settings: true } });
  if (!staff) return;
  const s = parseSettings(staff.settings);
  s.webPushSubs = subsOf(s, "webPushSubs").filter(x => x.endpoint !== endpoint);
  await prisma.staff.update({ where: { id: staffId }, data: { settings: JSON.stringify(s) } });
}

/**
 * Low-level: sign once and fan out to every subscription. Returns the
 * endpoints the push service reported as permanently gone (404/410) so the
 * caller can prune them. Never throws — a bad subscription just gets skipped.
 */
async function sendToSubs(
  subs: WebPushSub[],
  privateKey: string,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<string[]> {
  // NOTE: the VAPID "subject" must be a real, non-reserved contact — Apple's
  // web push gateway (web.push.apple.com) hard-rejects a placeholder/reserved
  // domain (e.g. the RFC 2606 ".example" TLD) with 403 BadJwtToken, silently
  // dropping every notification. Confirmed by testing directly against Apple.
  webpush.setVapidDetails("mailto:yair9051@gmail.com", VAPID_PUBLIC_KEY, privateKey);
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/admin",
    tag: payload.tag,
  });

  const dead: string[] = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub as webpush.PushSubscription, body);
    } catch (e: unknown) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.push(sub.endpoint);
    }
  }));
  return dead;
}

/**
 * Send a push to the owner's subscribed browsers, honoring the per-type toggle
 * (default ON). Silently no-ops when the type is disabled, there are no subs, or
 * no VAPID private key is available. Dead subscriptions (404/410) are pruned.
 */
export async function notifyOwnerWeb(
  businessId: string,
  type: NotifyType,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<void> {
  try {
    const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } });
    if (!biz) return;
    const s = parseSettings(biz.settings);

    const toggleKey = type === "appointment" ? "notifyOnAppointments" : "notifyOnEscalation";
    if (s[toggleKey] === false) return;

    const subs = subsOf(s, "ownerWebPushSubs");
    if (subs.length === 0) return;

    const privateKey = typeof s.vapidPrivateKey === "string" && s.vapidPrivateKey
      ? s.vapidPrivateKey
      : process.env.VAPID_PRIVATE_KEY;
    if (!privateKey) return;

    const dead = await sendToSubs(subs, privateKey, payload);
    if (dead.length) {
      s.ownerWebPushSubs = subs.filter(x => !dead.includes(x.endpoint));
      await prisma.business.update({ where: { id: businessId }, data: { settings: JSON.stringify(s) } });
    }
  } catch {
    /* never let a notification failure break the caller */
  }
}

/**
 * Send a push to a specific barber's subscribed browsers, honoring THEIR
 * OWN per-type toggle (default ON, independent from the owner's and from
 * other staff). Same no-op/prune behavior as notifyOwnerWeb. The VAPID
 * private key is still business-level (one key pair per business, shared by
 * every subscriber), so this does one extra lookup to fetch it.
 */
export async function notifyStaffWeb(
  staffId: string,
  type: NotifyType,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<void> {
  try {
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { businessId: true, settings: true } });
    if (!staff) return;
    const s = parseSettings(staff.settings);

    const toggleKey = type === "appointment" ? "notifyOnAppointments" : "notifyOnEscalation";
    if (s[toggleKey] === false) return;

    const subs = subsOf(s, "webPushSubs");
    if (subs.length === 0) return;

    const biz = await prisma.business.findUnique({ where: { id: staff.businessId }, select: { settings: true } });
    const bizSettings = parseSettings(biz?.settings ?? null);
    const privateKey = typeof bizSettings.vapidPrivateKey === "string" && bizSettings.vapidPrivateKey
      ? bizSettings.vapidPrivateKey
      : process.env.VAPID_PRIVATE_KEY;
    if (!privateKey) return;

    const dead = await sendToSubs(subs, privateKey, payload);
    if (dead.length) {
      s.webPushSubs = subs.filter(x => !dead.includes(x.endpoint));
      await prisma.staff.update({ where: { id: staffId }, data: { settings: JSON.stringify(s) } });
    }
  } catch {
    /* never let a notification failure break the caller */
  }
}
