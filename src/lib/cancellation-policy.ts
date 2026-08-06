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

function toBusinessDateTime(d: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Hours between an arbitrary instant (business timezone) and an appointment's date+startTime. Negative = already past. */
export function hoursBetween(from: Date, apptDate: Date, startTime: string): number {
  const { date: fromDate, minutes: fromMinutes } = toBusinessDateTime(from);
  const aptDateStr = apptDate.toISOString().slice(0, 10);
  const [h, m] = startTime.split(":").map(Number);
  const daysDiff = (Date.parse(aptDateStr) - Date.parse(fromDate)) / 86_400_000;
  return daysDiff * 24 + (h * 60 + m - fromMinutes) / 60;
}

/** Hours between "now" (business timezone) and an appointment's date+startTime. Negative = already past. */
export function hoursUntilAppointment(apptDate: Date, startTime: string): number {
  const now = getBusinessNow();
  const aptDateStr = apptDate.toISOString().slice(0, 10);
  const [h, m] = startTime.split(":").map(Number);
  const daysDiff = (Date.parse(aptDateStr) - Date.parse(now.date)) / 86_400_000;
  return daysDiff * 24 + (h * 60 + m - now.minutes) / 60;
}

/**
 * Full policy check for one appointment: resolves the effective threshold and
 * decides whether cancelling/moving it right now should be blocked.
 *
 * Exception: if the appointment was originally BOOKED with less notice than
 * the policy requires (e.g. booked 1 hour before a 3-hour-minimum slot), the
 * customer never had a chance to give the required notice — cancelling it is
 * always allowed regardless of how close it now is.
 */
export async function checkCancellationWindow(opts: {
  businessId: string;
  staffId: string;
  apptDate: Date;
  startTime: string;
  bookedAt: Date;
}): Promise<{ blocked: boolean; minHours: number }> {
  const minHours = await getEffectiveCancellationHours(opts.businessId, opts.staffId);
  if (minHours <= 0) return { blocked: false, minHours };

  const hoursLeft = hoursUntilAppointment(opts.apptDate, opts.startTime);
  if (hoursLeft >= minHours) return { blocked: false, minHours };

  const hoursAtBooking = hoursBetween(opts.bookedAt, opts.apptDate, opts.startTime);
  const wasBookedLastMinute = hoursAtBooking < minHours;
  return { blocked: !wasBookedLastMinute, minHours };
}

export const CANCELLATION_WINDOW_MESSAGE = (hours: number) =>
  `לא ניתן לבטל/להזיז תור בפחות מ-${hours} שעות לפני המועד. ביטול בטווח הזמן הזה מחויב במחיר מלא לפי המדיניות שלנו.`;

/** Customer-facing policy note shown on booking/my-appointments screens. null = nothing to show (no restriction). */
export function formatCancellationPolicyMessage(hours: number, customText: string | null | undefined): string | null {
  if (customText && customText.trim()) return customText.trim();
  if (hours <= 0) return null;
  return `מינימום לביטול: ${hours} שעות מראש. ביטול בפחות מהזמן הזה יחויב במחיר המלא.`;
}
