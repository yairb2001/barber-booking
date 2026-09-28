// Soft holds on free slots (SlotHold) — today: the alternatives the calendar-
// closure wizard offers a displaced customer. While a hold is live, the slot is
// busy for everyone else on every booking surface (public booking pages, quick
// slots, the agent) and shows as a 🔒 block in the admin calendar.
import { prisma } from "@/lib/prisma";

/** How long a closure alternative stays locked for the customer it was offered to. */
export const CLOSURE_HOLD_MINUTES = 60;

export type HoldRow = { staffId: string; date: Date; startTime: string; endTime: string };

/** Unexpired holds for these barbers in [from, to] (UTC-midnight dates, inclusive). */
export async function activeHolds(scope: { staffIds: string[]; from: Date; to: Date; exemptCustomerId?: string | null }): Promise<HoldRow[]> {
  if (!scope.staffIds.length) return [];
  return prisma.slotHold.findMany({
    where: {
      staffId: { in: scope.staffIds },
      date: { gte: scope.from, lte: scope.to },
      expiresAt: { gt: new Date() },
      ...(scope.exemptCustomerId ? { NOT: { customerId: scope.exemptCustomerId } } : {}),
    },
    select: { staffId: true, date: true, startTime: true, endTime: true },
  });
}

/** Appointment rows + live holds, so slot generation treats a held slot as booked.
 *  Hold rows carry staffId/date/startTime/endTime — a superset of what the slot
 *  endpoints select — so they flow through the same grouping code. */
export async function withActiveHolds<T>(appts: Promise<T[]>, scope: { staffIds: string[]; from: Date; to: Date }): Promise<T[]> {
  const [a, h] = await Promise.all([appts, activeHolds(scope).catch(() => [] as HoldRow[])]);
  return h.length ? [...a, ...(h as unknown as T[])] : a;
}
