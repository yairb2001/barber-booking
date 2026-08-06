import { prisma } from "@/lib/prisma";
import { getBusinessNow } from "@/lib/utils";

/**
 * Resolves the minimum-hours-before-appointment cancellation/move threshold
 * that applies to a given staff member's appointment. When the business's
 * cancellationPolicyMode is "staff", a barber's own staff.settings value
 * wins; otherwise (or if they never set one) the business-wide default applies.
 * 0 = no restriction.
 */
export async function getEffectiveCancellationHours(businessId: string, staffId: string): Promise<number> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { cancellationPolicyMode: true, minCancellationHours: true },
  });
  if (!business) return 0;

  if (business.cancellationPolicyMode === "staff") {
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { settings: true } });
    try {
      const s = staff?.settings ? JSON.parse(staff.settings) : {};
      if (typeof s.minCancellationHours === "number") return s.minCancellationHours;
    } catch { /* ignore */ }
  }
  return business.minCancellationHours;
}

/** Hours between "now" (business timezone) and an appointment's date+startTime. Negative = already past. */
export function hoursUntilAppointment(apptDate: Date, startTime: string): number {
  const now = getBusinessNow();
  const aptDateStr = apptDate.toISOString().slice(0, 10);
  const [h, m] = startTime.split(":").map(Number);
  const daysDiff = (Date.parse(aptDateStr) - Date.parse(now.date)) / 86_400_000;
  return daysDiff * 24 + (h * 60 + m - now.minutes) / 60;
}

export const CANCELLATION_WINDOW_MESSAGE = (hours: number) =>
  `לא ניתן לבטל/להזיז תור בפחות מ-${hours} שעות לפני המועד. ביטול בטווח הזמן הזה מחויב במחיר מלא לפי המדיניות שלנו.`;
