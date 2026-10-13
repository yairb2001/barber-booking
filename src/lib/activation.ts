/**
 * The free month counts from activation, not from signup (13.10.2026, Yair:
 * "לפעמים לוקח זמן לערוך את כל המערכת... ברגע שהוא לחץ על הכפתור הפעל זה סופר
 * חודש, והוא יכול לתת ללקוחות לקבוע דרך האתר").
 *
 * A new shop has activatedAt = null and trialEndsAt = null while it sets up
 * (nothing is blocked: the access block needs an end date). It activates when
 * the owner presses "הפעל" (setup wizard or the banner), when the agent is
 * turned on, or, as a safety net, on the third booking by customers (the
 * daily scan), whichever comes first. Shops that existed before this rule were
 * back-filled as activated.
 */
import { prisma } from "@/lib/prisma";
import { FREE_FIRST_MONTH_DAYS } from "@/lib/leads";
import { recordCrmNotification } from "@/lib/crm/notify";

export type ActivationReason = "button" | "agent" | "first_booking";
const WHY: Record<ActivationReason, string> = { button: "לחץ הפעל", agent: "הפעיל את הסוכן", first_booking: "לקוחות כבר קובעים תורים" };

/** Idempotent. Returns the free month's end (null for a paying shop). */
export async function activateBusiness(businessId: string, reason: ActivationReason, at = new Date()): Promise<{ activated: boolean; trialEndsAt: Date | null }> {
  const b = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, activatedAt: true, paidAt: true, trialEndsAt: true } });
  if (!b || b.activatedAt) return { activated: false, trialEndsAt: b?.trialEndsAt ?? null };
  const trialEndsAt = b.paidAt ? b.trialEndsAt : new Date(at.getTime() + FREE_FIRST_MONTH_DAYS * 86400_000);
  const done = await prisma.business.updateMany({ where: { id: businessId, activatedAt: null }, data: { activatedAt: at, ...(b.paidAt ? {} : { trialEndsAt }) } });
  if (!done.count) return { activated: false, trialEndsAt: b.trialEndsAt };
  const until = trialEndsAt ? trialEndsAt.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }) : null;
  await recordCrmNotification(`${b.name} הפעיל את המערכת (${WHY[reason]})${until ? `\nהחודש החינמי עד ${until}` : ""}`, { kind: "customer", businessId, push: false }).catch(() => {});
  return { activated: true, trialEndsAt };
}

/** Safety net, daily: a shop that never pressed "הפעל" but already has customers booking. */
export async function scanUnactivatedWithBookings(): Promise<number> {
  const pending = await prisma.business.findMany({ where: { activatedAt: null }, select: { id: true } });
  let n = 0;
  for (const b of pending) {
    // Three bookings by customers (site or agent), so an owner trying his own page does not start the clock.
    const firsts = await prisma.appointment.findMany({ where: { businessId: b.id, source: { in: ["customer", "agent"] } }, orderBy: { createdAt: "asc" }, take: 3, select: { createdAt: true } });
    if (firsts.length === 3) { await activateBusiness(b.id, "first_booking", firsts[2].createdAt); n++; }
  }
  return n;
}
