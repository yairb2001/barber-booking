import { prisma } from "@/lib/prisma";
import { timeToMinutes } from "@/lib/utils";

function fmtTime(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

// Generate appointment occurrences for a recurring rule within [windowStart, windowEnd]
// (both UTC-midnight DateTimes, inclusive). Occurrences land on the rule's dayOfWeek
// every `frequencyWeeks` weeks, aligned to the rule's first occurrence on/after startDate.
//
// Idempotent: skips dates already materialised for this rule, and skips time-conflicts
// with the barber's existing pending/confirmed appointments. Safe to re-run (used by the
// create route AND by the weekly top-up cron that keeps "forever" rules rolling forward).
export async function generateOccurrences(
  ruleId: string,
  windowStart: Date,
  windowEnd: Date,
): Promise<{ created: number; skipped: number }> {
  const rule = await prisma.recurringAppointment.findUnique({
    where: { id: ruleId },
    include: { service: true },
  });
  if (!rule || !rule.active) return { created: 0, skipped: 0 };

  const freq = [1, 2, 4].includes(rule.frequencyWeeks) ? rule.frequencyWeeks : 1;
  const duration = rule.service.durationMinutes;
  const [sh, sm] = rule.startTime.split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = startMins + duration;
  const endTime = fmtTime(endMins);

  // First occurrence = first dayOfWeek match on/after the rule's startDate.
  const first = new Date(rule.startDate);
  while (first.getUTCDay() !== rule.dayOfWeek) first.setUTCDate(first.getUTCDate() + 1);

  // Never generate past the rule's own endDate (for finite series).
  const hardEnd = rule.endDate && rule.endDate < windowEnd ? rule.endDate : windowEnd;

  // Advance to the first valid occurrence >= windowStart, preserving freq alignment.
  const cursor = new Date(first);
  while (cursor < windowStart) cursor.setUTCDate(cursor.getUTCDate() + 7 * freq);

  let created = 0;
  let skipped = 0;
  while (cursor <= hardEnd) {
    const dayUTC = new Date(cursor.toISOString().split("T")[0] + "T00:00:00.000Z");

    // Already materialised for this rule on this date? (idempotency)
    const dup = await prisma.appointment.findFirst({
      where: { recurringId: rule.id, date: dayUTC },
      select: { id: true },
    });
    if (dup) {
      cursor.setUTCDate(cursor.getUTCDate() + 7 * freq);
      continue;
    }

    // Conflict with another appointment in this barber's calendar?
    const existing = await prisma.appointment.findMany({
      where: { staffId: rule.staffId, date: dayUTC, status: { in: ["pending", "confirmed"] } },
      select: { startTime: true, endTime: true },
    });
    const conflict = existing.some((apt) => {
      const aStart = timeToMinutes(apt.startTime);
      const aEnd = timeToMinutes(apt.endTime);
      return startMins < aEnd && endMins > aStart;
    });
    if (conflict) {
      skipped++;
      cursor.setUTCDate(cursor.getUTCDate() + 7 * freq);
      continue;
    }

    await prisma.appointment.create({
      data: {
        businessId: rule.businessId,
        customerId: rule.customerId,
        staffId: rule.staffId,
        serviceId: rule.serviceId,
        date: dayUTC,
        startTime: rule.startTime,
        endTime,
        status: "confirmed",
        price: rule.price ?? rule.service.price,
        note: rule.note || null,
        recurringId: rule.id,
        source: "recurring", // standing appt set by staff — don't notify
      },
    });
    created++;
    cursor.setUTCDate(cursor.getUTCDate() + 7 * freq);
  }

  return { created, skipped };
}

// Rolling horizon (in weeks) kept ahead for "forever" rules (endDate == null).
export const FOREVER_HORIZON_WEEKS = 52;
