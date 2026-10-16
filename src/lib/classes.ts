/**
 * Group classes (16.10.2026, Yair: "אם זה חדרי כושר זה קבוצות בטח"). A class
 * type (פילאטיס, 12 spots, 50 minutes), its weekly schedule ("שלישי 18:00 אצל
 * דנה"), the dated sessions made from it, and the spots: booked, or waiting.
 *
 * - Sessions are made ahead (CLASS_HORIZON_DAYS) when the schedule changes, by
 *   the weekly top-up cron and on demand when someone looks; idempotent.
 * - A session blocks its trainer like any booking: a slot hold with holder
 *   "class:<sessionId>" that every free-time list and the write guard respect.
 *   Its room is blocked through the room calendar (rooms.ts).
 * - A spot is taken under a lock on the session, so two people never get the
 *   last one; a full session puts her on the waitlist, and a cancelled spot
 *   goes to the first in line.
 */
import { prisma } from "@/lib/prisma";
import { addDaysISO, getBusinessNow, getDayOfWeekISO, minutesToTime, timeToMinutes } from "@/lib/utils";

export const CLASS_HORIZON_DAYS = 56;
/** Does the business run any class (the agent gets the class tools only then). */
export async function hasActiveClasses(businessId: string): Promise<boolean> {
  return (await prisma.classType.count({ where: { businessId, isActive: true } })) > 0;
}

export const classHolderKey = (sessionId: string) => `class:${sessionId}`;
const ACTIVE = ["booked", "waitlist"];
/** A spot that is taken: booked, or already marked as came / didn't come. */
export const TAKEN = ["booked", "attended", "no_show"];

/** Make the sessions of every active weekly slot from `fromISO` for `days` days. Returns how many were made. */
export async function materializeSessions(businessId: string, fromISO = getBusinessNow().date, days = CLASS_HORIZON_DAYS): Promise<number> {
  const types = await prisma.classType.findMany({ where: { businessId, isActive: true }, include: { schedules: { where: { isActive: true } } } });
  if (!types.some(t => t.schedules.length)) return 0;
  const toISO = addDaysISO(fromISO, days - 1);
  const from = new Date(fromISO + "T00:00:00.000Z"), to = new Date(toISO + "T00:00:00.000Z");
  const existing = await prisma.classSession.findMany({ where: { businessId, date: { gte: from, lte: to }, scheduleId: { not: null } }, select: { scheduleId: true, date: true } });
  const have = new Set(existing.map(e => `${e.scheduleId}|${e.date.toISOString().slice(0, 10)}`));
  let made = 0;
  for (let i = 0; i < days; i++) {
    const d = addDaysISO(fromISO, i), dow = getDayOfWeekISO(d);
    for (const t of types) {
      for (const s of t.schedules.filter(x => x.dayOfWeek === dow)) {
        if (have.has(`${s.id}|${d}`)) continue;
        const date = new Date(d + "T00:00:00.000Z");
        const endTime = minutesToTime(timeToMinutes(s.startTime) + t.durationMinutes);
        const staffId = s.staffId ?? t.staffId;
        try {
          const session = await prisma.classSession.create({
            data: { businessId, classTypeId: t.id, scheduleId: s.id, date, startTime: s.startTime, endTime, staffId, roomId: t.roomId, capacity: t.capacity },
          });
          if (staffId) await holdTrainer(businessId, session.id, staffId, d, s.startTime, endTime);
          made++;
        } catch { /* made in parallel by another call — the unique (schedule, date) keeps one */ }
      }
    }
  }
  return made;
}

/** The trainer is busy for the session, on every booking surface. */
async function holdTrainer(businessId: string, sessionId: string, staffId: string, dateISO: string, startTime: string, endTime: string) {
  await prisma.slotHold.create({
    data: { businessId, staffId, date: new Date(dateISO + "T00:00:00.000Z"), startTime, endTime, holderKey: classHolderKey(sessionId), expiresAt: new Date(new Date(dateISO + "T00:00:00.000Z").getTime() + 2 * 86_400_000) },
  });
}

/** Future sessions of a schedule slot that changed are remade (those without spots); taken ones stay. */
export async function resyncSchedule(businessId: string, classTypeId: string) {
  const today = new Date(getBusinessNow().date + "T00:00:00.000Z");
  const empty = await prisma.classSession.findMany({
    where: { classTypeId, date: { gte: today }, status: "scheduled", bookings: { none: { status: { in: ACTIVE } } } },
    select: { id: true },
  });
  if (empty.length) {
    await prisma.slotHold.deleteMany({ where: { holderKey: { in: empty.map(e => classHolderKey(e.id)) } } });
    await prisma.classSession.deleteMany({ where: { id: { in: empty.map(e => e.id) } } });
  }
  await materializeSessions(businessId);
}

export type SessionRow = {
  id: string; classTypeId: string; name: string; description: string | null; price: number;
  date: string; startTime: string; endTime: string; staffId: string | null; staffName: string | null;
  capacity: number; booked: number; waiting: number; status: string;
};

/** The sessions between two dates, with their spots. Makes missing ones first. */
export async function sessionsBetween(businessId: string, fromISO: string, toISO: string, o: { includeCancelled?: boolean } = {}): Promise<SessionRow[]> {
  await materializeSessions(businessId, getBusinessNow().date);
  const rows = await prisma.classSession.findMany({
    where: { businessId, date: { gte: new Date(fromISO + "T00:00:00.000Z"), lte: new Date(toISO + "T00:00:00.000Z") }, ...(o.includeCancelled ? {} : { status: "scheduled" }) },
    include: { classType: { select: { name: true, description: true, price: true } }, bookings: { where: { status: { in: [...ACTIVE, "attended", "no_show"] } }, select: { status: true } } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  const staffIds = Array.from(new Set(rows.map(r => r.staffId).filter((x): x is string => !!x)));
  const staff = staffIds.length ? await prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(staff.map(s => [s.id, s.name]));
  return rows.map(r => ({
    id: r.id, classTypeId: r.classTypeId, name: r.classType.name, description: r.classType.description, price: r.classType.price,
    date: r.date.toISOString().slice(0, 10), startTime: r.startTime, endTime: r.endTime,
    staffId: r.staffId, staffName: r.staffId ? nameOf.get(r.staffId) ?? null : null,
    capacity: r.capacity, booked: r.bookings.filter(b => TAKEN.includes(b.status)).length, waiting: r.bookings.filter(b => b.status === "waitlist").length, status: r.status,
  }));
}

export type SpotResult =
  | { ok: true; status: "booked" | "waitlist"; position?: number; bookingId: string }
  | { ok: false; reason: "not_found" | "past" | "cancelled" | "already"; status?: string };

/** Take a spot (or a place in line), under a lock on the session. */
export async function bookSpot(sessionId: string, customerId: string): Promise<SpotResult> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"class:" + sessionId}))::text AS ok`;
    const s = await tx.classSession.findUnique({ where: { id: sessionId }, select: { status: true, date: true, startTime: true, capacity: true } });
    if (!s) return { ok: false, reason: "not_found" } as const;
    if (s.status !== "scheduled") return { ok: false, reason: "cancelled" } as const;
    const now = getBusinessNow(), d = s.date.toISOString().slice(0, 10);
    if (d < now.date || (d === now.date && timeToMinutes(s.startTime) <= now.minutes)) return { ok: false, reason: "past" } as const;
    const mine = await tx.classBooking.findFirst({ where: { sessionId, customerId, status: { in: [...ACTIVE, "attended", "no_show"] } }, select: { status: true } });
    if (mine) return { ok: false, reason: "already", status: mine.status } as const;
    const booked = await tx.classBooking.count({ where: { sessionId, status: { in: TAKEN } } });
    if (booked < s.capacity) {
      const b = await tx.classBooking.create({ data: { sessionId, customerId, status: "booked" } });
      return { ok: true, status: "booked", bookingId: b.id } as const;
    }
    const waiting = await tx.classBooking.count({ where: { sessionId, status: "waitlist" } });
    const b = await tx.classBooking.create({ data: { sessionId, customerId, status: "waitlist" } });
    return { ok: true, status: "waitlist", position: waiting + 1, bookingId: b.id } as const;
  }, { timeout: 20_000, maxWait: 10_000 });
}

/** Give a spot up; a booked spot goes to the first in line. Returns who moved up (to notify). */
export async function cancelSpot(bookingId: string): Promise<{ ok: boolean; promoted?: { bookingId: string; customerId: string } }> {
  const b = await prisma.classBooking.findUnique({ where: { id: bookingId }, select: { sessionId: true, status: true } });
  if (!b || !ACTIVE.includes(b.status)) return { ok: false };
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"class:" + b.sessionId}))::text AS ok`;
    await tx.classBooking.update({ where: { id: bookingId }, data: { status: "cancelled", cancelledAt: new Date() } });
    if (b.status !== "booked") return { ok: true };
    const next = await tx.classBooking.findFirst({ where: { sessionId: b.sessionId, status: "waitlist" }, orderBy: { createdAt: "asc" }, select: { id: true, customerId: true } });
    if (!next) return { ok: true };
    await tx.classBooking.update({ where: { id: next.id }, data: { status: "booked", promotedAt: new Date() } });
    return { ok: true, promoted: { bookingId: next.id, customerId: next.customerId } };
  }, { timeout: 20_000, maxWait: 10_000 });
}

/** Cancel a whole session: frees the trainer and the room. Returns who had a spot or a place in line. */
export async function cancelSession(sessionId: string): Promise<{ customerIds: string[] }> {
  const active = await prisma.classBooking.findMany({ where: { sessionId, status: { in: ACTIVE } }, select: { customerId: true } });
  await prisma.$transaction([
    prisma.classSession.update({ where: { id: sessionId }, data: { status: "cancelled" } }),
    prisma.classBooking.updateMany({ where: { sessionId, status: { in: ACTIVE } }, data: { status: "cancelled", cancelledAt: new Date() } }),
    prisma.slotHold.deleteMany({ where: { holderKey: classHolderKey(sessionId) } }),
  ]);
  return { customerIds: active.map(a => a.customerId) };
}

/** Until when a spot can still be cancelled by the customer herself. */
export function canCancelUntil(dateISO: string, startTime: string, cancelHours: number): boolean {
  const now = getBusinessNow();
  const minutesAway = (new Date(dateISO + "T00:00:00Z").getTime() - new Date(now.date + "T00:00:00Z").getTime()) / 60_000 + timeToMinutes(startTime) - now.minutes;
  return minutesAway >= cancelHours * 60;
}
