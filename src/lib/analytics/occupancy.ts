/**
 * Occupancy calculation: % of available staff hours that were booked.
 *
 * Available = sum of (slots − breaks) from StaffSchedule, with StaffScheduleOverride
 *             taking precedence on the override date.
 * Used      = sum of (endTime − startTime) for active appointments (not cancelled).
 *
 * Dates are treated as UTC midnight (matching the rest of the codebase).
 */

import { prisma } from "@/lib/prisma";

const CANCELLED = ["cancelled_by_customer", "cancelled_by_staff"];

type Slot = { start: string; end: string };

function parseSlots(json: string | null | undefined): Slot[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** "HH:MM" → minutes since midnight */
function hmToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Sum of minutes covered by `slots`, minus minutes of any `breaks` that overlap. */
function netMinutes(slots: Slot[], breaks: Slot[]): number {
  const slotMin = slots.reduce((s, x) => s + Math.max(0, hmToMin(x.end) - hmToMin(x.start)), 0);
  const breakMin = breaks.reduce((s, x) => s + Math.max(0, hmToMin(x.end) - hmToMin(x.start)), 0);
  return Math.max(0, slotMin - breakMin);
}

export async function computeOccupancy(opts: {
  businessId: string;
  from: Date;
  to: Date;
  staffId?: string | null;
}): Promise<{ usedMinutes: number; availableMinutes: number; pct: number }> {
  const { businessId, from, to, staffId } = opts;

  // Load staff (filter to one if requested) along with schedules + overrides in range
  const staffRows = await prisma.staff.findMany({
    where: {
      businessId,
      isAvailable: true,
      ...(staffId ? { id: staffId } : {}),
    },
    select: {
      id: true,
      schedules: true,
      overrides: {
        where: { date: { gte: from, lte: to } },
        select: { date: true, isWorking: true, slots: true, breaks: true },
      },
    },
  });

  // Build lookup: per staff → schedules by dayOfWeek + overrides by ISO date
  type StaffMaps = {
    weekly: Map<number, { isWorking: boolean; slots: Slot[]; breaks: Slot[] }>;
    overrides: Map<string, { isWorking: boolean; slots: Slot[]; breaks: Slot[] }>;
  };
  const byStaff = new Map<string, StaffMaps>();

  for (const s of staffRows) {
    const weekly = new Map<number, { isWorking: boolean; slots: Slot[]; breaks: Slot[] }>();
    for (const sch of s.schedules) {
      weekly.set(sch.dayOfWeek, {
        isWorking: sch.isWorking,
        slots: parseSlots(sch.slots),
        breaks: parseSlots(sch.breaks),
      });
    }
    const overrides = new Map<string, { isWorking: boolean; slots: Slot[]; breaks: Slot[] }>();
    for (const o of s.overrides) {
      const key = new Date(o.date).toISOString().slice(0, 10);
      overrides.set(key, {
        isWorking: o.isWorking,
        slots: parseSlots(o.slots),
        breaks: parseSlots(o.breaks),
      });
    }
    byStaff.set(s.id, { weekly, overrides });
  }

  // Sum available minutes day-by-day across the range
  let availableMinutes = 0;
  const dayMs = 24 * 60 * 60 * 1000;
  const startMs = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const endMs   = Date.UTC(to.getUTCFullYear(),   to.getUTCMonth(),   to.getUTCDate());

  for (let t = startMs; t <= endMs; t += dayMs) {
    const d = new Date(t);
    const isoDate = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getUTCDay();

    for (const maps of Array.from(byStaff.values())) {
      const override = maps.overrides.get(isoDate);
      if (override) {
        if (override.isWorking) availableMinutes += netMinutes(override.slots, override.breaks);
        continue; // override fully replaces weekly schedule for that day
      }
      const weekly = maps.weekly.get(dayOfWeek);
      if (weekly?.isWorking) availableMinutes += netMinutes(weekly.slots, weekly.breaks);
    }
  }

  // Sum used minutes from active appointments
  const appts = await prisma.appointment.findMany({
    where: {
      businessId,
      date: { gte: from, lte: to },
      status: { notIn: CANCELLED },
      ...(staffId ? { staffId } : {}),
    },
    select: { startTime: true, endTime: true },
  });

  const usedMinutes = appts.reduce(
    (s, a) => s + Math.max(0, hmToMin(a.endTime) - hmToMin(a.startTime)),
    0
  );

  const pct = availableMinutes > 0 ? Math.round((usedMinutes / availableMinutes) * 100) : 0;

  return { usedMinutes, availableMinutes, pct };
}
