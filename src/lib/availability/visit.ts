/**
 * Visits: several treatments one after another (16.10.2026, Yair: "אם היא רוצה
 * לעשות כמה טיפולים הסוכן צריך למצוא לה מתי ואיך היא יכולה לקבוע הכל יחד אחד
 * אחרי השני"; "אם לקוחה קבעה רק לייזר, כשהיא מסיימת אפשר לשריין לה אצל
 * הנותנת שירות השניה לק").
 *
 * One day of a business in memory (schedules, bookings by their busy parts,
 * live holds, rooms), and a search: the first treatment at some time with
 * someone who does it, the next one when the customer is free again (up to
 * `maxGap` minutes later) with whoever does it, and so on. The same staff
 * member may do two of them if she is free; a room taken by an earlier
 * treatment counts for the later ones. Customer rules as everywhere: not past,
 * within the horizon, the lead time today.
 */
import { prisma } from "@/lib/prisma";
import { activeHolds } from "@/lib/slot-holds";
import { addDaysISO, getBusinessNow, getDayOfWeekISO, timeToMinutes } from "@/lib/utils";
import { fitsAt, shapeLength, staffBlocks, toHHMM, type Iv, type Shape } from "@/lib/availability/engine";
import { bookedBusy, gridOf, shapeOf } from "@/lib/availability/shape";
import { loadRoomCalendar, needsRoom, type RoomCalendar } from "@/lib/availability/rooms";

type Svc = { id: string; name: string; price: number; durationMinutes: number; segments: string | null; bufferAfterMin: number };
type StaffDay = {
  id: string; name: string; open: boolean; windows: Iv[]; busy: Iv[]; apptCount: number;
  lead: number; firstLead: number; horizonOk: boolean;
  services: Map<string, { svc: Svc; customDuration: number | null; customPrice: number | null }>;
};
export type DayContext = { dateISO: string; staff: StaffDay[]; rooms: RoomCalendar; step: number; nowMin: number | null };

export type VisitItem = {
  staffId: string; staffName: string; serviceId: string; serviceName: string;
  start: number; end: number; startTime: string; endTime: string; price: number;
  shape: Shape; roomId: string | null;
};
type Extra = { staff: Map<string, Iv[]>; rooms: Map<string, Iv[]> };

const parse = (s: string | null | undefined): { start: string; end: string }[] => { try { const v = s ? JSON.parse(s) : []; return Array.isArray(v) ? v : []; } catch { return []; } };
const iv = (x: { start: string; end: string }) => ({ s: timeToMinutes(x.start), e: timeToMinutes(x.end) });
const overlaps = (a: Iv, b: Iv) => a.s < b.e && a.e > b.s;

/** One read of the business's day. Exempt: the customer's own holds don't block her. */
export async function loadDayContext(businessId: string, dateISO: string, exempt: { customerId?: string | null; holderKeys?: (string | null | undefined)[] } = {}): Promise<DayContext> {
  const now = getBusinessNow();
  const date = new Date(dateISO + "T00:00:00.000Z"), dayEnd = new Date(date.getTime() + 86_400_000);
  const empty: DayContext = { dateISO, staff: [], rooms: { none: true, serviceRooms: new Map(), busy: new Map() }, step: 15, nowMin: null };
  if (dateISO < now.date) return empty;
  const [biz, staffRows] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { bookingHorizonDays: true, minBookingLeadMinutes: true, firstApptLeadMinutes: true, businessType: true, settings: true } }),
    prisma.staff.findMany({
      where: { businessId, isAvailable: true },
      select: { id: true, name: true, settings: true, staffServices: { select: { serviceId: true, customDuration: true, customPrice: true, service: { select: { id: true, name: true, price: true, durationMinutes: true, segments: true, bufferAfterMin: true } } } } },
    }),
  ]);
  const ids = staffRows.map(s => s.id);
  const [schedules, overrides, appts, holds, rooms] = await Promise.all([
    prisma.staffSchedule.findMany({ where: { staffId: { in: ids }, dayOfWeek: getDayOfWeekISO(dateISO) } }),
    prisma.staffScheduleOverride.findMany({ where: { staffId: { in: ids }, date } }),
    prisma.appointment.findMany({ where: { staffId: { in: ids }, date: { gte: date, lt: dayEnd }, status: { in: ["pending", "confirmed"] } }, select: { staffId: true, startTime: true, endTime: true, busySegments: true, bufferAfterMin: true } }),
    activeHolds({ staffIds: ids, from: date, to: date, exemptCustomerId: exempt.customerId ?? null, exemptHolderKeys: exempt.holderKeys ?? [] }).catch(() => []),
    loadRoomCalendar(prisma, businessId, dateISO, dateISO),
  ]);
  const grid = gridOf(biz);
  const staff: StaffDay[] = staffRows.map(s => {
    let cfg: Record<string, unknown> = {};
    try { cfg = s.settings ? JSON.parse(s.settings) : {}; } catch { /* business defaults */ }
    const num = (k: string) => { const n = Number(cfg[k]); return cfg[k] === undefined || isNaN(n) ? undefined : n; };
    const h = num("bookingHorizonDays");
    const horizon = h !== undefined && h > 0 ? h : (biz?.bookingHorizonDays ?? 30);
    const ov = overrides.find(o => o.staffId === s.id);
    const sc = schedules.find(x => x.staffId === s.id);
    let open = true, work: { start: string; end: string }[] = [], brk: { start: string; end: string }[] = [];
    if (ov && !ov.isWorking) open = false;
    else if (ov?.isWorking && ov.slots) { work = parse(ov.slots); brk = parse(ov.breaks); }
    else if (!sc?.isWorking) open = false;
    else { work = parse(sc.slots); brk = parse(sc.breaks); }
    const mine = appts.filter(a => a.staffId === s.id);
    const busy = [...brk.map(iv), ...mine.flatMap(bookedBusy), ...holds.filter(x => x.staffId === s.id).map(x => ({ s: timeToMinutes(x.startTime), e: timeToMinutes(x.endTime) }))];
    return {
      id: s.id, name: s.name, open, windows: work.map(iv), busy, apptCount: mine.length,
      lead: num("minBookingLeadMinutes") ?? biz?.minBookingLeadMinutes ?? 0,
      firstLead: num("firstApptLeadMinutes") ?? biz?.firstApptLeadMinutes ?? 0,
      horizonOk: dateISO <= addDaysISO(now.date, Math.max(0, horizon - 1)),
      services: new Map(s.staffServices.map(x => [x.serviceId, { svc: x.service, customDuration: x.customDuration, customPrice: x.customPrice }])),
    };
  });
  return { dateISO, staff, rooms, step: grid.mode === "fixed" ? grid.step : 15, nowMin: dateISO === now.date ? now.minutes : null };
}

/** The free room for an occupancy, counting rooms taken earlier in the same visit. */
function freeRoom(ctx: DayContext, serviceId: string, occ: Iv, extra: Extra): string | null | false {
  if (!needsRoom(ctx.rooms, serviceId)) return null;
  for (const r of ctx.rooms.serviceRooms.get(serviceId)!) {
    const taken = [...(ctx.rooms.busy.get(`${r}|${ctx.dateISO}`) ?? []).map(x => x.iv), ...(extra.rooms.get(r) ?? [])];
    if (!taken.some(t => overlaps(t, occ))) return r;
  }
  return false;
}

/** Can this staff member do this treatment at `start`, given what the visit already took? */
export function fitStep(ctx: DayContext, staffId: string, serviceId: string, start: number, extra: Extra = { staff: new Map(), rooms: new Map() }): VisitItem | null {
  const st = ctx.staff.find(s => s.id === staffId);
  const own = st?.services.get(serviceId);
  if (!st || !st.open || !st.horizonOk || !own) return null;
  if (ctx.nowMin !== null && start < ctx.nowMin + (st.apptCount === 0 ? Math.max(st.firstLead, st.lead) : st.lead)) return null;
  const shape = shapeOf(own.svc, own.customDuration ?? own.svc.durationMinutes);
  if (!fitsAt(st.windows, [...st.busy, ...(extra.staff.get(staffId) ?? [])], shape, start)) return null;
  const len = shapeLength(shape);
  const roomId = freeRoom(ctx, serviceId, { s: start, e: start + len + shape.bufferAfter }, extra);
  if (roomId === false) return null;
  return { staffId, staffName: st.name, serviceId, serviceName: own.svc.name, start, end: start + len, startTime: toHHMM(start), endTime: toHHMM(start + len), price: own.customPrice ?? own.svc.price, shape, roomId };
}

function withItem(extra: Extra, it: VisitItem): Extra {
  const staff = new Map(extra.staff), rooms = new Map(extra.rooms);
  staff.set(it.staffId, [...(staff.get(it.staffId) ?? []), ...staffBlocks(it.shape, it.start)]);
  if (it.roomId) rooms.set(it.roomId, [...(rooms.get(it.roomId) ?? []), { s: it.start, e: it.end + it.shape.bufferAfter }]);
  return { staff, rooms };
}

export type VisitStep = { serviceId: string; staffId?: string | null };

/**
 * The shortest chain from a first start, in this order: each next treatment as
 * early as it can start once she is free (up to `maxGap` later), trying every
 * staff member who does it; of all of them, the one that ends first.
 */
function chainFrom(ctx: DayContext, steps: VisitStep[], start: number, maxGap: number): VisitItem[] | null {
  let best: VisitItem[] | null = null;
  const go = (i: number, t: number, extra: Extra, acc: VisitItem[]) => {
    if (i === steps.length) { if (!best || acc[acc.length - 1].end < best[best.length - 1].end) best = acc; return; }
    if (best && t >= best[best.length - 1].end) return; // can't beat it
    const step = steps[i];
    const who = step.staffId ? [step.staffId] : ctx.staff.filter(s => s.services.has(step.serviceId)).map(s => s.id);
    for (const s of who) {
      // The earliest this one can start for her.
      for (let g = 0; g <= (i === 0 ? 0 : maxGap); g += 5) {
        const it = fitStep(ctx, s, step.serviceId, t + g, extra);
        if (it) { go(i + 1, it.end, withItem(extra, it), [...acc, it]); break; }
      }
    }
  };
  go(0, start, { staff: new Map(), rooms: new Map() }, []);
  return best;
}

/** Every order of the treatments (up to 4 of them: 24 orders). */
function orders<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest]));
}

/**
 * The best ways to do all of them in a row that day (16.10.2026, Yair: "מחפש
 * את כל הווריאציות האפשריות עם מינימום הזמן"): every order (unless the order is
 * fixed), every start, every staff member who does each; the shortest visits
 * first, then the earliest; options at least an hour apart. Empty when none fits.
 */
export function findVisitOptions(ctx: DayContext, steps: VisitStep[], o: { limit?: number; maxGap?: number; keepOrder?: boolean } = {}): VisitItem[][] {
  if (!steps.length || !ctx.staff.length) return [];
  const perms = o.keepOrder ? [steps] : orders(steps.slice(0, 4));
  const firsts = new Set(perms.map(p => p[0]));
  const cands = new Set<number>();
  for (const f of Array.from(firsts)) {
    for (const st of ctx.staff.filter(s => (f.staffId ? s.id === f.staffId : s.services.has(f.serviceId)) && s.open)) {
      for (const w of st.windows) {
        for (let t = w.s; t < w.e; t += ctx.step) cands.add(t);
        for (const b of st.busy) if (b.e >= w.s && b.e < w.e) cands.add(b.e);
      }
    }
  }
  const found: VisitItem[][] = [];
  for (const t of Array.from(cands).sort((a, b) => a - b)) {
    let best: VisitItem[] | null = null;
    for (const p of perms) {
      const c = chainFrom(ctx, p, t, o.maxGap ?? 15);
      if (c && (!best || c[c.length - 1].end < best[best.length - 1].end)) best = c;
    }
    if (best) found.push(best);
  }
  const span = (c: VisitItem[]) => c[c.length - 1].end - c[0].start;
  found.sort((a, b) => span(a) - span(b) || a[0].start - b[0].start);
  const out: VisitItem[][] = [];
  for (const c of found) {
    if (out.some(x => Math.abs(x[0].start - c[0].start) < 60)) continue;
    out.push(c);
    if (out.length >= (o.limit ?? 3)) break;
  }
  return out.sort((a, b) => a[0].start - b[0].start);
}

/** Exactly these treatments at these times — still bookable together? */
export function checkVisit(ctx: DayContext, items: { staffId: string; serviceId: string; startTime: string }[]): { ok: true; items: VisitItem[] } | { ok: false; index: number } {
  let extra: Extra = { staff: new Map(), rooms: new Map() };
  const out: VisitItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = fitStep(ctx, items[i].staffId, items[i].serviceId, timeToMinutes(items[i].startTime), extra);
    // She can't be in two chairs: each treatment starts once the one before it ended.
    if (!it || (i > 0 && it.start < out[i - 1].end)) return { ok: false, index: i };
    out.push(it);
    extra = withItem(extra, it);
  }
  return { ok: true, items: out };
}

/**
 * The extra treatment to offer right after a booking that ends at `afterEnd`:
 * the first of `serviceIds` someone can do within `maxGap` minutes of it.
 */
export function findUpsell(ctx: DayContext, serviceIds: string[], afterEnd: number, maxGap = 15): VisitItem | null {
  for (const sid of serviceIds) {
    for (let g = 0; g <= maxGap; g += 5) {
      for (const st of ctx.staff.filter(s => s.services.has(sid))) {
        const it = fitStep(ctx, st.id, sid, afterEnd + g);
        if (it) return it;
      }
    }
  }
  return null;
}
