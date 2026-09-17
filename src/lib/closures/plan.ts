/**
 * Calendar closure — planning (read-only).
 * ─────────────────────────────────────────
 * A barber closes a day (or part of it) that already has appointments. Before we
 * touch ANYTHING we must know: which appointments fall in the closed window, and
 * whether there is somewhere to move every one of them. Spec: specs/calendar-closure.md
 *
 * Nothing here writes to the DB. `planClosure` is what the admin "preview" API and
 * the execute step both call, so the gate the barber saw is the gate we enforce.
 *
 * Decisions baked in (17.9.2026, with the owner):
 *   - Loyalty rule: a customer with ≥70% of past visits at the closing barber is
 *     offered that barber ONLY; a new customer or one under 70% may be offered any
 *     barber (the closing barber still ranks first).
 *   - Gate: every displaced customer has ≥1 option, and the number of DISTINCT
 *     free slots across all options is at least the number of displaced
 *     appointments ("מספר שווה"). Two options per customer is a goal, not a rule.
 */
import { prisma } from "@/lib/prisma";
import { getBusinessNow, timeToMinutes, addDaysISO, getDayOfWeekISO, generateSlots } from "@/lib/utils";

export const LOYALTY_THRESHOLD = 0.7;
/** How far around the closed date we look for alternatives (calendar days). */
const WINDOW_BEFORE_DAYS = 3;
const WINDOW_AFTER_DAYS = 4;
const ACTIVE = ["pending", "confirmed"] as const;

export type ClosureInput = {
  businessId: string;
  staffId: string;
  /** YYYY-MM-DD (business-local) */
  date: string;
  /** "HH:MM" — omit both for a full-day closure */
  fromTime?: string | null;
  toTime?: string | null;
};

export type SlotOption = {
  staffId: string;
  staffName: string;
  date: string;      // YYYY-MM-DD
  startTime: string; // "HH:MM"
  sameStaff: boolean;
};

export type DisplacedPlan = {
  appointmentId: string;
  startTime: string;
  endTime: string;
  customer: { id: string; name: string; phone: string };
  service: { id: string; name: string; durationMinutes: number };
  loyalty: { total: number; withStaff: number; share: number | null; anyStaffAllowed: boolean };
  options: SlotOption[]; // best first, at most 2
  /** true when the ONLY reason there is no option is the loyalty rule */
  blockedByLoyalty: boolean;
};

export type ClosurePlan = {
  input: ClosureInput;
  staffName: string;
  isToday: boolean;
  displaced: DisplacedPlan[];
  gate: {
    ok: boolean;
    needed: number;          // displaced appointments
    distinctSlots: number;   // distinct free slots across all options
    withoutOption: string[]; // appointmentIds with no option at all
  };
  suggestions: {
    allowOtherBarberFor: { appointmentId: string; customerName: string }[];
    closedDaysInWindow: string[]; // YYYY-MM-DD where others work but the closing barber has no availability
  };
};

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart);
}

/** Appointments of this barber, on this date, that fall inside the closed window. */
export async function findDisplaced(input: ClosureInput) {
  const dateObj = new Date(input.date + "T00:00:00.000Z");
  const rows = await prisma.appointment.findMany({
    where: {
      businessId: input.businessId,
      staffId: input.staffId,
      date: dateObj,
      status: { in: [...ACTIVE] },
    },
    orderBy: { startTime: "asc" },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      service: { select: { id: true, name: true, durationMinutes: true } },
    },
  });
  const fullDay = !input.fromTime || !input.toTime;
  // Only FUTURE appointments can be displaced. A closure of a past day (or of
  // earlier today) has nothing to reschedule — the wizard then falls back to the
  // plain override, exactly like before this feature existed.
  const now = getBusinessNow();
  const inFuture = (a: { startTime: string }) =>
    input.date > now.date || (input.date === now.date && timeToMinutes(a.startTime) > now.minutes);
  return rows.filter(a => inFuture(a) && (fullDay || overlaps(a.startTime, a.endTime, input.fromTime!, input.toTime!)));
}

/** Share of the customer's PAST visits (not cancelled / no-show) held by `staffId`. */
export async function loyaltyShare(businessId: string, customerId: string, staffId: string, beforeDate?: string) {
  // Visits strictly before min(today, closure date): the appointments being
  // displaced must never count as "loyalty" to the barber cancelling them.
  const cutoff = [getBusinessNow().date, beforeDate].filter(Boolean).sort()[0] as string;
  const cutoffStart = new Date(cutoff + "T00:00:00.000Z");
  const groups = await prisma.appointment.groupBy({
    by: ["staffId"],
    where: {
      businessId, customerId,
      date: { lt: cutoffStart },
      status: { in: ["confirmed", "completed"] },
    },
    _count: { _all: true },
  });
  const total = groups.reduce((s, g) => s + g._count._all, 0);
  const withStaff = groups.find(g => g.staffId === staffId)?._count._all ?? 0;
  const share = total ? withStaff / total : null;
  const anyStaffAllowed = total === 0 || (share as number) < LOYALTY_THRESHOLD;
  return { total, withStaff, share, anyStaffAllowed };
}


/** Availability for the WHOLE search window, loaded in one round of queries.
 *  The first version asked computeDayAvailability() per (date, service) — fine on
 *  a toy business, but on DOMINANT (5 barbers × 8 days × 4 services × ~6 queries
 *  each) that was ~1,000 sequential round-trips to Neon and a 35–75s preview.
 *  Here: 7 queries total, then everything is computed in memory with the same
 *  generateSlots() the booking flow uses. Semantics mirror computeDayAvailability
 *  with { ignoreLimits: true, allStaff: true }: every available barber, no
 *  horizon / lead-time, day overrides win over the weekly schedule, bookings and
 *  unexpired holds block, and on today only the past is off-limits. */
type DayAvail = { staffId: string; name: string; slots: string[] }[];
type Busy = { startTime: string; endTime: string };
class WindowAvail {
  private loaded: Promise<void> | null = null;
  private staff: { id: string; name: string }[] = [];
  private staffServices: { staffId: string; serviceId: string; customDuration: number | null; service: { name: string; durationMinutes: number } }[] = [];
  private services = new Map<string, { name: string; durationMinutes: number }>();
  private overrides = new Map<string, { isWorking: boolean; slots: string | null; breaks: string | null }>(); // staffId|date
  private schedules = new Map<string, { isWorking: boolean; slots: string; breaks: string | null }>();        // staffId|dow
  private busy = new Map<string, Busy[]>();                                                                   // staffId|date
  private memo = new Map<string, DayAvail>();
  constructor(private businessId: string, private from: string, private to: string) {}

  private load(): Promise<void> {
    if (this.loaded) return this.loaded;
    this.loaded = (async () => {
      const fromD = new Date(this.from + "T00:00:00.000Z");
      const toD = new Date(addDaysISO(this.to, 1) + "T00:00:00.000Z");
      const inWindow = { gte: fromD, lt: toD };
      const [staff, staffServices, services, overrides, schedules, appts, holds] = await Promise.all([
        prisma.staff.findMany({ where: { businessId: this.businessId, isAvailable: true }, select: { id: true, name: true } }),
        prisma.staffService.findMany({
          where: { staff: { businessId: this.businessId } },
          select: { staffId: true, serviceId: true, customDuration: true, service: { select: { name: true, durationMinutes: true } } },
        }),
        prisma.service.findMany({ where: { businessId: this.businessId }, select: { id: true, name: true, durationMinutes: true } }),
        prisma.staffScheduleOverride.findMany({
          where: { staff: { businessId: this.businessId }, date: inWindow },
          select: { staffId: true, date: true, isWorking: true, slots: true, breaks: true },
        }),
        prisma.staffSchedule.findMany({
          where: { staff: { businessId: this.businessId } },
          select: { staffId: true, dayOfWeek: true, isWorking: true, slots: true, breaks: true },
        }),
        prisma.appointment.findMany({
          where: { businessId: this.businessId, date: inWindow, status: { in: [...ACTIVE] } },
          select: { staffId: true, date: true, startTime: true, endTime: true },
        }),
        prisma.slotHold.findMany({
          where: { businessId: this.businessId, date: inWindow, expiresAt: { gt: new Date() } },
          select: { staffId: true, date: true, startTime: true, endTime: true },
        }),
      ]);
      this.staff = staff;
      this.staffServices = staffServices;
      for (const sv of services) this.services.set(sv.id, { name: sv.name, durationMinutes: sv.durationMinutes });
      for (const o of overrides) this.overrides.set(`${o.staffId}|${o.date.toISOString().slice(0, 10)}`, o);
      for (const sc of schedules) this.schedules.set(`${sc.staffId}|${sc.dayOfWeek}`, sc);
      for (const b of [...appts, ...holds]) {
        const k = `${b.staffId}|${b.date.toISOString().slice(0, 10)}`;
        (this.busy.get(k) ?? this.busy.set(k, []).get(k)!).push({ startTime: b.startTime, endTime: b.endTime });
      }
    })();
    return this.loaded;
  }

  /** Same fallback ladder as computeDayAvailability: the barber's own row for the
   *  service → a same-name service they offer → same duration → the service's own
   *  duration → their shortest service → 30. */
  private duration(staffId: string, serviceId?: string): number {
    const mine = this.staffServices.filter(r => r.staffId === staffId);
    if (serviceId) {
      const own = mine.find(r => r.serviceId === serviceId);
      if (own) return own.customDuration ?? own.service.durationMinutes;
      const req = this.services.get(serviceId);
      if (req) {
        const alt = mine.find(r => r.service.name === req.name) ?? mine.find(r => r.service.durationMinutes === req.durationMinutes);
        if (alt) return alt.customDuration ?? alt.service.durationMinutes;
        return req.durationMinutes;
      }
    }
    const shortest = [...mine].sort((a, b) => (a.customDuration ?? a.service.durationMinutes) - (b.customDuration ?? b.service.durationMinutes))[0];
    return shortest ? (shortest.customDuration ?? shortest.service.durationMinutes) : 30;
  }

  async get(date: string, serviceId?: string): Promise<DayAvail> {
    await this.load();
    const k = `${date}|${serviceId ?? ""}`;
    const hit = this.memo.get(k);
    if (hit) return hit;
    const nowBiz = getBusinessNow();
    const dow = getDayOfWeekISO(date);
    const out: DayAvail = [];
    for (const st of this.staff) {
      const ov = this.overrides.get(`${st.id}|${date}`);
      let scheduleSlots: { start: string; end: string }[] = [];
      let breaks: { start: string; end: string }[] | null = null;
      if (ov && !ov.isWorking) continue; // day off
      if (ov?.isWorking && ov.slots) {
        scheduleSlots = JSON.parse(ov.slots);
        breaks = ov.breaks ? JSON.parse(ov.breaks) : null;
      } else {
        const sc = this.schedules.get(`${st.id}|${dow}`);
        if (!sc?.isWorking) continue;
        scheduleSlots = JSON.parse(sc.slots);
        breaks = sc.breaks ? JSON.parse(sc.breaks) : null;
      }
      let slots = generateSlots(scheduleSlots, breaks, this.duration(st.id, serviceId), this.busy.get(`${st.id}|${date}`) ?? []);
      if (nowBiz.date === date) slots = slots.filter(s => timeToMinutes(s) >= nowBiz.minutes);
      if (slots.length) out.push({ staffId: st.id, name: st.name, slots });
    }
    this.memo.set(k, out);
    return out;
  }
}
type AvailCache = WindowAvail;

/** Free slots (as SlotOption) in the search window, honoring the loyalty rule and
 *  never inside the closed window / in the past. */
async function collectOptions(
  cache: AvailCache,
  input: ClosureInput,
  appt: { startTime: string; service: { id: string; durationMinutes: number } },
  anyStaffAllowed: boolean,
  isToday: boolean,
): Promise<SlotOption[]> {
  const now = getBusinessNow();
  const start = isToday ? input.date : addDaysISO(input.date, -WINDOW_BEFORE_DAYS);
  const out: SlotOption[] = [];
  for (let d = 0; d <= WINDOW_BEFORE_DAYS + WINDOW_AFTER_DAYS; d++) {
    const ds = addDaysISO(start, d);
    if (ds < now.date) continue;
    const byStaff = (await cache.get(ds, appt.service.id)).filter(r => anyStaffAllowed || r.staffId === input.staffId);
    for (const s of byStaff) {
      for (const t of s.slots) {
        // never offer a time inside the window we are closing, and never the past
        if (ds === input.date && s.staffId === input.staffId && input.fromTime && input.toTime &&
            overlaps(t, minutesToTimeSafe(timeToMinutes(t) + appt.service.durationMinutes), input.fromTime, input.toTime)) continue;
        if (ds === input.date && s.staffId === input.staffId && !(input.fromTime && input.toTime)) continue; // full-day: whole day is gone
        if (ds === now.date && timeToMinutes(t) <= now.minutes) continue;
        out.push({ staffId: s.staffId, staffName: s.name, date: ds, startTime: t, sameStaff: s.staffId === input.staffId });
      }
    }
  }
  return out;
}

function minutesToTimeSafe(m: number): string {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Rank: same barber → same weekday as the original → closest start time → closest date. */
function rankOptions(opts: SlotOption[], input: ClosureInput, originalStart: string): SlotOption[] {
  const origDow = getDayOfWeekISO(input.date);
  const origMin = timeToMinutes(originalStart);
  const dayDist = (ds: string) => Math.abs((new Date(ds + "T00:00:00.000Z").getTime() - new Date(input.date + "T00:00:00.000Z").getTime()) / 86400000);
  return [...opts].sort((a, b) => {
    if (a.sameStaff !== b.sameStaff) return a.sameStaff ? -1 : 1;
    const aDow = getDayOfWeekISO(a.date) === origDow ? 0 : 1, bDow = getDayOfWeekISO(b.date) === origDow ? 0 : 1;
    if (aDow !== bDow) return aDow - bDow;
    const aT = Math.abs(timeToMinutes(a.startTime) - origMin), bT = Math.abs(timeToMinutes(b.startTime) - origMin);
    if (aT !== bT) return aT - bT;
    return dayDist(a.date) - dayDist(b.date);
  });
}

const slotKey = (o: SlotOption) => `${o.staffId}|${o.date}|${o.startTime}`;

export async function planClosure(input: ClosureInput): Promise<ClosurePlan> {
  const staff = await prisma.staff.findFirst({
    where: { id: input.staffId, businessId: input.businessId },
    select: { id: true, name: true },
  });
  if (!staff) throw new Error("staff_not_found");
  const isToday = input.date === getBusinessNow().date;
  const rows = await findDisplaced(input);
  const cache = new WindowAvail(input.businessId, addDaysISO(input.date, -WINDOW_BEFORE_DAYS), addDaysISO(input.date, WINDOW_AFTER_DAYS));
  // Loyalty is one groupBy per customer — fire them together, not one by one.
  const loyaltyByAppt = new Map(await Promise.all(rows.map(async a => [a.id, await loyaltyShare(input.businessId, a.customerId, input.staffId, input.date)] as const)));

  // Greedy distinct assignment: hand out the best slot per customer in order of
  // original time, so two customers don't both "own" the same alternative.
  const taken = new Set<string>();
  const displaced: DisplacedPlan[] = [];
  for (const a of rows) {
    const loyalty = loyaltyByAppt.get(a.id)!;
    const ranked = rankOptions(await collectOptions(cache, input, a, loyalty.anyStaffAllowed, isToday), input, a.startTime);
    const options: SlotOption[] = [];
    for (const o of ranked) {
      if (options.length === 2) break;
      if (taken.has(slotKey(o))) continue;
      options.push(o);
    }
    if (options[0]) taken.add(slotKey(options[0])); // the primary is reserved for this customer in the plan
    let blockedByLoyalty = false;
    if (!options.length && !loyalty.anyStaffAllowed) {
      const anyAtAll = await collectOptions(cache, input, a, true, isToday);
      blockedByLoyalty = anyAtAll.some(o => !taken.has(slotKey(o)));
    }
    displaced.push({
      appointmentId: a.id, startTime: a.startTime, endTime: a.endTime,
      customer: a.customer, service: a.service, loyalty, options, blockedByLoyalty,
    });
  }

  const distinct = new Set<string>();
  for (const d of displaced) for (const o of d.options) distinct.add(slotKey(o));
  const withoutOption = displaced.filter(d => !d.options.length).map(d => d.appointmentId);
  const gate = {
    ok: displaced.length === 0 || (withoutOption.length === 0 && distinct.size >= displaced.length),
    needed: displaced.length,
    distinctSlots: distinct.size,
    withoutOption,
  };

  // Closed days for the closing barber inside the window (candidates to reopen).
  const closedDaysInWindow: string[] = [];
  if (!gate.ok) {
    const now = getBusinessNow().date;
    for (let d = -WINDOW_BEFORE_DAYS; d <= WINDOW_AFTER_DAYS; d++) {
      const ds = addDaysISO(input.date, d);
      if (ds < now || ds === input.date) continue;
      const av = await cache.get(ds);
      // Suggest only days where the SHOP is open but this barber isn't — a Shabbat
      // or a holiday nobody works is not a day worth "opening".
      if (av.length && !av.some(r => r.staffId === input.staffId)) closedDaysInWindow.push(ds);
    }
  }

  return {
    input, staffName: staff.name, isToday, displaced, gate,
    suggestions: {
      allowOtherBarberFor: displaced.filter(d => d.blockedByLoyalty).map(d => ({ appointmentId: d.appointmentId, customerName: d.customer.name })),
      closedDaysInWindow,
    },
  };
}
