/**
 * The write-time guard (stage B, step 3, 16.10.2026). Every path that books or
 * moves an appointment re-checks the time here, under a lock on that staff
 * member's day, right before it writes.
 *
 * Why: the only database guard is the partial unique index on (staff, date,
 * start) — two bookings at the same start time. 10:00–10:45 and 10:15–11:00
 * were both writable, and with cleaning buffers and processing gaps nearly
 * every clash starts at a different minute. The check is by intervals: the new
 * treatment's busy parts against every booking's recorded busy parts, holds,
 * and, for customers, working hours, breaks, the horizon and the lead time.
 *
 * withSlotLock takes a transaction-level advisory lock per staff-day (released
 * at commit), so two writers for the same day run one after the other and the
 * second sees the first's row.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { activeHolds } from "@/lib/slot-holds";
import { getBusinessNow, getDayOfWeekISO, timeToMinutes, addDaysISO } from "@/lib/utils";
import { fitsAt, staffBlocks, shapeLength, type Iv, type Shape } from "@/lib/availability/engine";
import { bookedBusy } from "@/lib/availability/shape";
import { loadRoomCalendar, pickRoom } from "@/lib/availability/rooms";

type Db = Prisma.TransactionClient | typeof prisma;

export type SlotCheck = {
  staffId: string;
  dateISO: string;
  startTime: string;
  /** What the new booking occupies (its treatment's shape for this staff member). */
  shape: Shape;
  /** A move: its own current booking doesn't block it. */
  ignoreAppointmentIds?: string[];
  /** Live holds block the slot, except the caller's own. Admin writes pass false. */
  holds?: false | { exemptCustomerId?: string | null; exemptHolderKeys?: (string | null | undefined)[] };
  /** Customer-facing: inside working hours, off breaks, not past, within the
   *  horizon and the lead time (minus `leadGraceMinutes`, for a customer who
   *  took a few minutes on the confirm screen). Admin writes leave it off. */
  customer?: { leadGraceMinutes?: number };
  /** Rooms (16.10.2026): when the treatment needs a room, one of its rooms must
   *  be free too; the verdict says which, and the writer stores it. */
  room?: { businessId: string; serviceId: string | null | undefined; ignoreAppointmentIds?: string[] };
};

export type SlotVerdict =
  | { ok: true; roomId?: string | null }
  | { ok: false; reason: "past" | "closed" | "outside" | "busy" | "hold" | "horizon" | "lead" | "room" };

const overlaps = (a: Iv, b: Iv) => a.s < b.e && a.e > b.s;
const parse = (s: string | null | undefined): { start: string; end: string }[] => { try { const v = s ? JSON.parse(s) : []; return Array.isArray(v) ? v : []; } catch { return []; } };

/** The staff member's working windows and breaks that day; null = not working. */
async function dayWindows(db: Db, staffId: string, dateISO: string): Promise<{ windows: Iv[]; breaks: Iv[] } | null> {
  const date = new Date(dateISO + "T00:00:00.000Z");
  const ov = await db.staffScheduleOverride.findUnique({ where: { staffId_date: { staffId, date } } });
  let work: { start: string; end: string }[], brk: { start: string; end: string }[];
  if (ov && !ov.isWorking) return null;
  if (ov?.isWorking && ov.slots) { work = parse(ov.slots); brk = parse(ov.breaks); }
  else {
    const sc = await db.staffSchedule.findUnique({ where: { staffId_dayOfWeek: { staffId, dayOfWeek: getDayOfWeekISO(dateISO) } } });
    if (!sc?.isWorking) return null;
    work = parse(sc.slots); brk = parse(sc.breaks);
  }
  const iv = (x: { start: string; end: string }) => ({ s: timeToMinutes(x.start), e: timeToMinutes(x.end) });
  return { windows: work.map(iv), breaks: brk.map(iv) };
}

/** Is this time still bookable? Reads inside the caller's transaction when given one. */
export async function checkSlot(db: Db, c: SlotCheck): Promise<SlotVerdict> {
  const start = timeToMinutes(c.startTime);
  const date = new Date(c.dateISO + "T00:00:00.000Z");
  const dayEnd = new Date(date.getTime() + 86_400_000);
  const mine = staffBlocks(c.shape, start);

  const rows = await db.appointment.findMany({
    where: {
      staffId: c.staffId, date: { gte: date, lt: dayEnd }, status: { in: ["pending", "confirmed"] },
      ...(c.ignoreAppointmentIds?.length ? { id: { notIn: c.ignoreAppointmentIds } } : {}),
    },
    select: { startTime: true, endTime: true, busySegments: true, bufferAfterMin: true },
  });

  if (c.customer) {
    const now = getBusinessNow();
    if (c.dateISO < now.date || (c.dateISO === now.date && start < now.minutes)) return { ok: false, reason: "past" };
    const staff = await db.staff.findUnique({ where: { id: c.staffId }, select: { settings: true, business: { select: { bookingHorizonDays: true, minBookingLeadMinutes: true, firstApptLeadMinutes: true } } } });
    let cfg: Record<string, unknown> = {};
    try { cfg = staff?.settings ? JSON.parse(staff.settings) : {}; } catch { /* business defaults */ }
    const num = (k: string) => { if (cfg[k] === undefined) return undefined; const n = Number(cfg[k]); return isNaN(n) ? undefined : n; };
    const b = staff?.business;
    const h = num("bookingHorizonDays");
    const horizon = h !== undefined && h > 0 ? h : (b?.bookingHorizonDays ?? 30);
    if (c.dateISO > addDaysISO(now.date, Math.max(0, horizon - 1))) return { ok: false, reason: "horizon" };
    if (c.dateISO === now.date) {
      const lead = num("minBookingLeadMinutes") ?? b?.minBookingLeadMinutes ?? 0;
      const first = num("firstApptLeadMinutes") ?? b?.firstApptLeadMinutes ?? 0;
      const need = (rows.length === 0 ? Math.max(first, lead) : lead) - (c.customer.leadGraceMinutes ?? 0);
      if (start < now.minutes + Math.max(0, need)) return { ok: false, reason: "lead" };
    }
    const day = await dayWindows(db, c.staffId, c.dateISO);
    if (!day) return { ok: false, reason: "closed" };
    // Inside a window (the buffer may run past closing), clear of breaks.
    if (!fitsAt(day.windows, day.breaks, c.shape, start)) return { ok: false, reason: day.windows.some(w => start >= w.s && start + shapeLength(c.shape) <= w.e) ? "busy" : "outside" };
  }

  const taken = rows.flatMap(bookedBusy);
  if (mine.some(m => taken.some(t => overlaps(m, t)))) return { ok: false, reason: "busy" };

  if (c.holds !== false) {
    const held = await activeHolds({ staffIds: [c.staffId], from: date, to: date, exemptCustomerId: c.holds?.exemptCustomerId ?? null, exemptHolderKeys: c.holds?.exemptHolderKeys ?? [] });
    const hv = held.map(x => ({ s: timeToMinutes(x.startTime), e: timeToMinutes(x.endTime) }));
    if (mine.some(m => hv.some(t => overlaps(m, t)))) return { ok: false, reason: "hold" };
  }
  if (c.room) {
    const cal = await loadRoomCalendar(db, c.room.businessId, c.dateISO, c.dateISO);
    const roomId = pickRoom(cal, c.room.serviceId, c.dateISO, start, c.shape, c.room.ignoreAppointmentIds ?? c.ignoreAppointmentIds ?? []);
    if (roomId === false) return { ok: false, reason: "room" };
    return { ok: true, roomId };
  }
  return { ok: true };
}

/**
 * Run `fn` holding the lock of every staff-day in `keys` (sorted, so two moves
 * between the same two days can't deadlock). Everything `fn` reads and writes
 * through `tx` is one transaction; the locks go at commit.
 */
export async function withSlotLock<T>(keys: { staffId: string; dateISO: string }[], fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const uniq = Array.from(new Set(keys.map(k => `${k.staffId}:${k.dateISO}`))).sort();
  return prisma.$transaction(async tx => {
    for (const k of uniq) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${k}))::text AS ok`;
    return fn(tx);
  }, { timeout: 20_000, maxWait: 10_000 });
}

/** The time is no longer bookable (thrown by writeChecked). */
export class SlotRefused extends Error {
  constructor(public verdict: Exclude<SlotVerdict, { ok: true }>) { super(`slot refused: ${verdict.reason}`); }
}

/**
 * The writer's one call: lock the staff-days, check each slot again, write.
 * Throws SlotRefused when a check fails or the database's active-slot index
 * says another booking got there first.
 */
export async function writeChecked<T>(checks: SlotCheck[], write: (tx: Prisma.TransactionClient, rooms: (string | null)[]) => Promise<T>): Promise<T> {
  // Rooms are shared by the whole team: a check that may take one also locks the business's day.
  const keys = checks.flatMap(c => [{ staffId: c.staffId, dateISO: c.dateISO }, ...(c.room ? [{ staffId: `rooms:${c.room.businessId}`, dateISO: c.dateISO }] : [])]);
  try {
    return await withSlotLock(keys, async tx => {
      const rooms: (string | null)[] = [];
      for (const c of checks) {
        const v = await checkSlot(tx, c);
        if (!v.ok) throw new SlotRefused(v);
        rooms.push(v.roomId ?? null);
      }
      return write(tx, rooms);
    });
  } catch (e) {
    if (isSlotTaken(e)) throw new SlotRefused({ ok: false, reason: "busy" });
    throw e;
  }
}

/** A duplicate-key error on the active-slot index: another booking got there first. */
export function isSlotTaken(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/** The customer's sentence for a refusal (the public site and the agent share it). */
export function verdictText(v: SlotVerdict): string {
  if (v.ok) return "";
  return v.reason === "past" ? "השעה הזו כבר עברה, בחרו שעה אחרת"
    : v.reason === "closed" || v.reason === "outside" ? "בשעה הזו אין קבלה, בחרו שעה אחרת"
    : v.reason === "horizon" ? "היום הזה עוד לא פתוח לקביעה"
    : v.reason === "lead" ? "השעה הזו קרובה מדי, בחרו שעה מאוחרת יותר"
    : "הסלוט כבר תפוס, נסה שעה אחרת";
}

/** A new booking's record of its shape: endTime and the busy parts it keeps
 *  (null for a plain treatment, exactly as every booking so far). */
export { bookingRecord } from "@/lib/availability/shape";
