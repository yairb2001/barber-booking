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
 *
 * Owner subscriptions live in Business.settings.ownerWebPushSubs[].
 * Per-type toggles (default ON): notifyOnAppointments, notifyOnEscalation.
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
function subsOf(s: Record<string, unknown>): WebPushSub[] {
  return Array.isArray(s.ownerWebPushSubs) ? (s.ownerWebPushSubs as WebPushSub[]) : [];
}

/** Save (or refresh) a browser push subscription for the business owner. */
export async function saveWebPushSub(businessId: string, sub: WebPushSub): Promise<void> {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } });
  if (!biz) return;
  const s = parseSettings(biz.settings);
  const deduped = subsOf(s).filter(x => x.endpoint !== sub.endpoint);
  deduped.push(sub);
  s.ownerWebPushSubs = deduped.slice(-10); // keep the last ~10 devices
  await prisma.business.update({ where: { id: businessId }, data: { settings: JSON.stringify(s) } });
}

/** Remove a subscription (e.g. the user turned notifications off on a device). */
export async function removeWebPushSub(businessId: string, endpoint: string): Promise<void> {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } });
  if (!biz) return;
  const s = parseSettings(biz.settings);
  s.ownerWebPushSubs = subsOf(s).filter(x => x.endpoint !== endpoint);
  await prisma.business.update({ where: { id: businessId }, data: { settings: JSON.stringify(s) } });
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

    // Per-type toggle — default ON when unset.
    const toggleKey = type === "appointment" ? "notifyOnAppointments" : "notifyOnEscalation";
    if (s[toggleKey] === false) return;

    const subs = subsOf(s);
    if (subs.length === 0) return;

    const privateKey = typeof s.vapidPrivateKey === "string" && s.vapidPrivateKey
      ? s.vapidPrivateKey
      : process.env.VAPID_PRIVATE_KEY;
    if (!privateKey) return;

    webpush.setVapidDetails("mailto:noreply@dominant-app.example", VAPID_PUBLIC_KEY, privateKey);
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

    if (dead.length) {
      s.ownerWebPushSubs = subs.filter(x => !dead.includes(x.endpoint));
      await prisma.business.update({ where: { id: businessId }, data: { settings: JSON.stringify(s) } });
    }
  } catch {
    /* never let a notification failure break the caller */
  }
}
