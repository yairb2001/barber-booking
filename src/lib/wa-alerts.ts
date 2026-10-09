/**
 * WhatsApp connection alerts (Yair, 6.10.2026: "לגבי ההתראה שהוואטסאפ התנתק תבנה גם וגם").
 *
 * Three events, each reported to BOTH the business owner and Chator (Yair):
 *   down      — the number stopped being linked (logged out, blocked, phone removed us)
 *   recovered — it is linked again
 *   stuck     — the owner has been on the linking screen for minutes without success
 *               (Chator only: he can call before the owner gives up)
 *
 * The business's own number is the thing that is down, so the owner is reached
 * through the other doors: a push to his phone (the installed app) and a WhatsApp
 * from Chator's own number (the platform business). Chator gets the usual
 * notifyPlatformOwner line.
 *
 * Every alert leaves a MessageLog row on the business (customerPhone "-", a
 * kind of its own) which doubles as the dedupe ledger: one "down" per 2 hours,
 * one "recovered" per hour, one "stuck" per 2 hours — the cron and the /me probe
 * can both notice the same transition.
 */
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { pushToOwner } from "@/lib/native/push";
import { notifyPlatformOwner, SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";

type Kind = "wa_down_alert" | "wa_up_alert" | "wa_link_stuck";

const fmtIL = (d: Date) => d.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short", hour: "2-digit", minute: "2-digit" });

async function ownerOf(businessId: string) {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, slug: true, phone: true, whatsappNumber: true, settings: true } });
  if (!biz) return null;
  let s: { ownerLoginPhone?: unknown } = {};
  try { s = biz.settings ? JSON.parse(biz.settings) : {}; } catch { /* ignore */ }
  const raw = (typeof s.ownerLoginPhone === "string" && s.ownerLoginPhone) || biz.phone || null;
  return { ...biz, ownerPhone: raw ? normalizeIsraeliPhone(raw) : null };
}

async function recently(businessId: string, kind: Kind, withinMs: number): Promise<boolean> {
  const dup = await prisma.messageLog.findFirst({ where: { businessId, kind, createdAt: { gte: new Date(Date.now() - withinMs) } }, select: { id: true } });
  return !!dup;
}

async function tellOwner(biz: NonNullable<Awaited<ReturnType<typeof ownerOf>>>, kind: Kind, title: string, body: string): Promise<"sent" | "skipped"> {
  pushToOwner(biz.id, { title, body: body.split("\n")[0], data: { type: "whatsapp", kind } }).catch(() => {});
  // A WhatsApp from Chator's number — unless this IS Chator's number (then the push has to do).
  if (!biz.ownerPhone || biz.id === SUPER_ADMIN_BUSINESS_ID) return "skipped";
  try {
    await sendMessage({ businessId: SUPER_ADMIN_BUSINESS_ID, customerPhone: biz.ownerPhone, kind, body });
    return "sent";
  } catch (e) { console.error("[wa-alerts] owner message failed", e); return "skipped"; }
}

async function ledger(businessId: string, kind: Kind, body: string, status: "sent" | "skipped") {
  await prisma.messageLog.create({ data: { businessId, customerPhone: "-", kind, body, status } }).catch(() => {});
}

/** The number just went down (first sighting of a down state). */
export async function alertWhatsAppDown(businessId: string): Promise<void> {
  try {
    if (await recently(businessId, "wa_down_alert", 2 * 3600_000)) return;
    const biz = await ownerOf(businessId);
    if (!biz) return;
    const body = `🔴 הוואטסאפ של ${biz.name} התנתק מהמערכת. הלקוחות לא מקבלים מענה אוטומטי ותזכורות לא יוצאות.\nלחיבור מחדש: במערכת → הגדרות → וואטסאפ → "חבר את הטלפון" (סריקה אחת, פחות מדקה).`;
    const status = await tellOwner(biz, "wa_down_alert", "🔴 הוואטסאפ של העסק התנתק", body);
    await ledger(businessId, "wa_down_alert", body, status);
    notifyPlatformOwner(`🔴 וואטסאפ התנתק — ${biz.name} (${biz.slug}) · ${biz.whatsappNumber || biz.phone || "ללא מספר"}`, { kind: "whatsapp", businessId }).catch(() => {});
  } catch (e) { console.error("[wa-alerts] down", e); }
}

/** Linked again after a down episode. */
export async function alertWhatsAppRecovered(businessId: string, downSince: Date | null): Promise<void> {
  try {
    if (await recently(businessId, "wa_up_alert", 3600_000)) return;
    const biz = await ownerOf(businessId);
    if (!biz) return;
    const since = downSince ? ` (היה מנותק מ‑${fmtIL(downSince)})` : "";
    const body = `✅ הוואטסאפ של ${biz.name} חזר להתחבר${since}. הסוכן והתזכורות פועלים שוב.`;
    const status = await tellOwner(biz, "wa_up_alert", "✅ הוואטסאפ של העסק חזר", body);
    await ledger(businessId, "wa_up_alert", body, status);
    notifyPlatformOwner(`✅ וואטסאפ חזר — ${biz.name} (${biz.slug})${since}`, { kind: "whatsapp", businessId }).catch(() => {});
  } catch (e) { console.error("[wa-alerts] recovered", e); }
}

/** The owner has been trying to link for minutes without success — Chator gets a heads-up to step in. */
export async function alertLinkingStuck(businessId: string): Promise<void> {
  try {
    if (await recently(businessId, "wa_link_stuck", 2 * 3600_000)) return;
    const biz = await ownerOf(businessId);
    if (!biz) return;
    const body = `⚠️ ${biz.name} (${biz.slug}) מנסה לחבר וואטסאפ כבר כמה דקות ולא מצליח · ${biz.whatsappNumber || biz.phone || "ללא מספר"}. שווה להתקשר לפני שהוא מוותר.`;
    await ledger(businessId, "wa_link_stuck", body, "sent");
    notifyPlatformOwner(body, { kind: "whatsapp", businessId }).catch(() => {});
  } catch (e) { console.error("[wa-alerts] stuck", e); }
}
