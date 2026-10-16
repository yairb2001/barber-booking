/**
 * Rooms (16.10.2026, Yair: "יש טיפולים שקורים בחדר מסויים, לדוגמא חדר שבו
 * מתבצע לייזר — פנימי פשוט, לא משהו חיצוני"). Internal only: a treatment may
 * need one of some rooms; a time is offered only when one of them is free; the
 * booking keeps the room the system picked. The customer never sees a room.
 *
 * A room is taken for the customer's whole visit (processing included: she is
 * still in the chair) plus the cleaning after it. A business with no active
 * rooms skips all of this: every check passes and nothing is assigned.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { shapeLength, toMin, type Iv, type Shape } from "@/lib/availability/engine";

type Db = Prisma.TransactionClient | typeof prisma;

export type RoomCalendar = {
  none: boolean;
  /** The active rooms each treatment may use, in the business's order. */
  serviceRooms: Map<string, string[]>;
  /** `${roomId}|${dateISO}` → the bookings occupying it (visit + cleaning). */
  busy: Map<string, { id: string; iv: Iv }[]>;
};

const NONE: RoomCalendar = { none: true, serviceRooms: new Map(), busy: new Map() };

/** One read for a business over [fromISO, toISO]. */
export async function loadRoomCalendar(db: Db, businessId: string | null | undefined, fromISO: string, toISO: string): Promise<RoomCalendar> {
  if (!businessId) return NONE;
  const rooms = await db.room.findMany({ where: { businessId, isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  if (!rooms.length) return NONE;
  const ids = rooms.map(r => r.id);
  const order = new Map(ids.map((id, i) => [id, i]));
  const from = new Date(fromISO + "T00:00:00.000Z"), to = new Date(toISO + "T00:00:00.000Z");
  const [links, appts] = await Promise.all([
    db.serviceRoom.findMany({ where: { roomId: { in: ids } }, select: { serviceId: true, roomId: true } }),
    db.appointment.findMany({
      where: { roomId: { in: ids }, date: { gte: from, lt: new Date(to.getTime() + 86_400_000) }, status: { in: ["pending", "confirmed"] } },
      select: { id: true, roomId: true, date: true, startTime: true, endTime: true, bufferAfterMin: true },
    }),
  ]);
  const serviceRooms = new Map<string, string[]>();
  for (const l of links) serviceRooms.set(l.serviceId, [...(serviceRooms.get(l.serviceId) ?? []), l.roomId]);
  serviceRooms.forEach(list => list.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  const busy = new Map<string, { id: string; iv: Iv }[]>();
  for (const a of appts) {
    const k = `${a.roomId}|${a.date.toISOString().slice(0, 10)}`;
    busy.set(k, [...(busy.get(k) ?? []), { id: a.id, iv: { s: toMin(a.startTime), e: toMin(a.endTime) + Math.max(0, a.bufferAfterMin ?? 0) } }]);
  }
  return { none: false, serviceRooms, busy };
}

/** Does this treatment need a room here at all? */
export function needsRoom(cal: RoomCalendar, serviceId: string | null | undefined): boolean {
  return !cal.none && !!serviceId && (cal.serviceRooms.get(serviceId)?.length ?? 0) > 0;
}

/**
 * The room a treatment would take at `start` (minutes): its id; null when it
 * needs no room; false when every room it may use is taken then.
 */
export function pickRoom(cal: RoomCalendar, serviceId: string | null | undefined, dateISO: string, start: number, shape: Shape, ignoreAppointmentIds: string[] = []): string | null | false {
  if (!needsRoom(cal, serviceId)) return null;
  const occ = { s: start, e: start + shapeLength(shape) + shape.bufferAfter };
  for (const r of cal.serviceRooms.get(serviceId!)!) {
    const taken = (cal.busy.get(`${r}|${dateISO}`) ?? []).some(x => !ignoreAppointmentIds.includes(x.id) && x.iv.s < occ.e && x.iv.e > occ.s);
    if (!taken) return r;
  }
  return false;
}

/** A filter for a list of "HH:MM" starts: only those a room is free for. */
export function roomFilter(cal: RoomCalendar, serviceId: string | null | undefined, dateISO: string, shape: Shape): (t: string) => boolean {
  if (!needsRoom(cal, serviceId)) return () => true;
  return t => pickRoom(cal, serviceId, dateISO, toMin(t), shape) !== false;
}

/** Set the rooms a treatment may use: only the business's own active rooms. */
export async function setServiceRooms(serviceId: string, businessId: string, roomIds: unknown) {
  if (!Array.isArray(roomIds)) return;
  const mine = await prisma.room.findMany({ where: { id: { in: roomIds.filter((x): x is string => typeof x === "string") }, businessId, isActive: true }, select: { id: true } });
  await prisma.$transaction([
    prisma.serviceRoom.deleteMany({ where: { serviceId } }),
    prisma.serviceRoom.createMany({ data: mine.map(r => ({ serviceId, roomId: r.id })) }),
  ]);
}
