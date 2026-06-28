import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { resolveBusinessId, fallbackBusiness } from "@/lib/tenant";
import { getPreferredServiceId } from "@/lib/preferred-service";
import {
  generateSlots,
  timeToMinutes,
  getBusinessNow,
  addDaysISO,
  getDayOfWeekISO,
} from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/slots/team-by-date
//   • ?from=YYYY-MM-DD&to=YYYY-MM-DD  → { days: { "YYYY-MM-DD": true } }
//       calendar dots: a day is "open" if ANY quick-pool barber has a free slot.
//   • ?date=YYYY-MM-DD                → { barbers: [...] }
//       for the chosen date, every quick-pool barber that has availability, with
//       their earliest few times — so the customer picks a barber for that day.
//
// Only barbers enabled for quick appointments (inQuickPool) are considered, so
// this stays consistent with the home-page quick slots and the team feed.

const MAX_RANGE_DAYS = 70;     // cap the calendar range query

type EligibleStaff = {
  id: string;
  name: string;
  avatarUrl: string | null;
  poolPriority: number;
  staffLead: number;
  staffFirstLead: number;
  horizon: number;
  svc: { id: string; name: string; price: number; durationMinutes: number };
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");

  const resolvedBusinessId = (await resolveBusinessId(request)) ?? undefined;

  // Returning customer? Offer the service they usually book (per barber, if offered).
  const preferredServiceId = await getPreferredServiceId(request, resolvedBusinessId);

  const biz = resolvedBusinessId
    ? await prisma.business.findUnique({ where: { id: resolvedBusinessId }, select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true, bookingHorizonDays: true } })
    : await fallbackBusiness({ select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true, bookingHorizonDays: true } });
  const leadMinutes = biz?.minBookingLeadMinutes ?? 0;
  const bizFirstLead = biz?.firstApptLeadMinutes ?? 0;
  const bizHorizon = biz?.bookingHorizonDays ?? 30;

  const bizScope = resolvedBusinessId ? { businessId: resolvedBusinessId } : {};

  const visibleServices = await prisma.service.findMany({
    where: { isVisible: true, ...bizScope },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, price: true, durationMinutes: true },
  });
  if (visibleServices.length === 0) {
    return NextResponse.json(dateParam ? { barbers: [] } : { days: {} });
  }

  const poolStaff = await prisma.staff.findMany({
    where: { inQuickPool: true, isAvailable: true, ...bizScope },
    orderBy: { poolPriority: "asc" },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      poolPriority: true,
      settings: true,
      staffServices: { select: { serviceId: true, customPrice: true, customDuration: true } },
    },
  });

  const eligibleStaff: EligibleStaff[] = poolStaff
    .map(s => {
      const offered = new Set(s.staffServices.map(ss => ss.serviceId));
      // Prefer the returning customer's usual service if this barber offers it.
      const svc =
        (preferredServiceId && visibleServices.find(v => v.id === preferredServiceId && offered.has(v.id)))
        || visibleServices.find(v => offered.has(v.id));
      if (!svc) return null;
      const ss = s.staffServices.find(x => x.serviceId === svc.id);

      let staffLead = leadMinutes;
      let staffFirstLead = bizFirstLead;
      let horizon = bizHorizon;
      try {
        if (s.settings) {
          const cfg = JSON.parse(s.settings) as Record<string, unknown>;
          if (cfg.minBookingLeadMinutes !== undefined) {
            const p = Number(cfg.minBookingLeadMinutes);
            if (!isNaN(p)) staffLead = p;
          }
          if (cfg.firstApptLeadMinutes !== undefined) {
            const p = Number(cfg.firstApptLeadMinutes);
            if (!isNaN(p)) staffFirstLead = p;
          }
          if (cfg.bookingHorizonDays !== undefined) {
            const p = Number(cfg.bookingHorizonDays);
            if (!isNaN(p) && p > 0) horizon = p;
          }
        }
      } catch { /* keep business defaults */ }

      return {
        id: s.id,
        name: s.name,
        avatarUrl: s.avatarUrl,
        poolPriority: s.poolPriority,
        staffLead,
        staffFirstLead,
        horizon,
        svc: {
          id: svc.id,
          name: svc.name,
          price: ss?.customPrice || svc.price,
          durationMinutes: ss?.customDuration || svc.durationMinutes,
        },
      };
    })
    .filter((s): s is EligibleStaff => s !== null);

  if (eligibleStaff.length === 0) {
    return NextResponse.json(dateParam ? { barbers: [] } : { days: {} });
  }

  const nowBiz = getBusinessNow();
  const todayStr = nowBiz.date;
  const staffIds = eligibleStaff.map(s => s.id);

  // Date window we need data for.
  const windowDates: string[] = [];
  if (dateParam) {
    windowDates.push(dateParam);
  } else if (fromStr && toStr) {
    let cur = fromStr;
    for (let i = 0; i < MAX_RANGE_DAYS && cur <= toStr; i++) {
      windowDates.push(cur);
      cur = addDaysISO(cur, 1);
    }
  }
  if (windowDates.length === 0) {
    return NextResponse.json(dateParam ? { barbers: [] } : { days: {} });
  }

  const firstDate = new Date(windowDates[0] + "T00:00:00.000Z");
  const lastDate = new Date(windowDates[windowDates.length - 1] + "T00:00:00.000Z");

  const [schedules, overrides, appts] = await Promise.all([
    prisma.staffSchedule.findMany({
      where: { staffId: { in: staffIds } },
      select: { staffId: true, dayOfWeek: true, isWorking: true, slots: true, breaks: true },
    }),
    prisma.staffScheduleOverride.findMany({
      where: { staffId: { in: staffIds }, date: { gte: firstDate, lte: lastDate } },
      select: { staffId: true, date: true, isWorking: true, slots: true, breaks: true },
    }),
    prisma.appointment.findMany({
      where: { staffId: { in: staffIds }, date: { gte: firstDate, lte: lastDate }, status: { in: ["pending", "confirmed"] } },
      select: { staffId: true, date: true, startTime: true, endTime: true },
    }),
  ]);

  const schedByKey = new Map<string, { isWorking: boolean; slots: string; breaks: string | null }>();
  for (const sc of schedules) schedByKey.set(`${sc.staffId}|${sc.dayOfWeek}`, sc);
  const overrideByKey = new Map<string, { isWorking: boolean; slots: string | null; breaks: string | null }>();
  for (const ov of overrides) overrideByKey.set(`${ov.staffId}|${ov.date.toISOString().slice(0, 10)}`, ov);
  const apptsByKey = new Map<string, { startTime: string; endTime: string }[]>();
  for (const a of appts) {
    const key = `${a.staffId}|${a.date.toISOString().slice(0, 10)}`;
    const list = apptsByKey.get(key) || [];
    list.push({ startTime: a.startTime, endTime: a.endTime });
    apptsByKey.set(key, list);
  }

  // Free slot times for a single (staff, date), respecting horizon + today's lead.
  function slotsFor(staff: EligibleStaff, dateStr: string): string[] {
    if (dateStr < todayStr) return [];
    const dayOffset = Math.round((new Date(dateStr + "T00:00:00.000Z").getTime() - new Date(todayStr + "T00:00:00.000Z").getTime()) / 86400000);
    if (dayOffset >= staff.horizon) return []; // beyond this barber's booking horizon

    const override = overrideByKey.get(`${staff.id}|${dateStr}`);
    let scheduleSlots: { start: string; end: string }[] = [];
    let breaks: { start: string; end: string }[] | null = null;
    if (override && !override.isWorking) return [];
    if (override && override.isWorking && override.slots) {
      scheduleSlots = safeArr(override.slots);
      breaks = override.breaks ? safeArr(override.breaks) : null;
    } else {
      const schedule = schedByKey.get(`${staff.id}|${getDayOfWeekISO(dateStr)}`);
      if (!schedule || !schedule.isWorking) return [];
      scheduleSlots = safeArr(schedule.slots);
      breaks = schedule.breaks ? safeArr(schedule.breaks) : null;
    }

    const appointments = apptsByKey.get(`${staff.id}|${dateStr}`) || [];
    let slots = generateSlots(scheduleSlots, breaks, staff.svc.durationMinutes, appointments);
    if (dateStr === todayStr) {
      const effectiveLead = appointments.length === 0
        ? Math.max(staff.staffFirstLead, staff.staffLead)
        : staff.staffLead;
      slots = slots.filter(s => timeToMinutes(s) >= nowBiz.minutes + effectiveLead);
    }
    return slots;
  }

  // ── Calendar-dots mode ───────────────────────────────────────────────────────
  if (!dateParam) {
    const days: Record<string, boolean> = {};
    for (const dateStr of windowDates) {
      let open = false;
      for (const staff of eligibleStaff) {
        if (slotsFor(staff, dateStr).length > 0) { open = true; break; }
      }
      days[dateStr] = open;
    }
    return NextResponse.json({ days });
  }

  // ── Per-date time-slot mode ────────────────────────────────────────────────────
  // A single, deduplicated, time-ordered list (like the standard time page), where
  // each clock time is assigned to ONE quick-pool barber. We rotate the assignment
  // across barbers (load-balanced) so the day's times are spread between barbers —
  // not always the same one — giving emptier calendars fair exposure too.
  const dateStr = dateParam;

  // time → barbers available at that time (kept in poolPriority order)
  const byTime = new Map<string, EligibleStaff[]>();
  for (const staff of eligibleStaff) {
    for (const t of slotsFor(staff, dateStr)) {
      const list = byTime.get(t) || [];
      list.push(staff);
      byTime.set(t, list);
    }
  }

  const distinctTimes = Array.from(byTime.keys()).sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

  // Smart load-balancing: seed each barber's counter with how many appointments
  // they ALREADY have that day, so the day's offered times go first to the
  // emptier barbers. A packed barber gets fewer of the day's slots → we actively
  // spread demand across the team instead of a blind round-robin from zero.
  const assignCount = new Map<string, number>(); // staffId → load (existing + assigned)
  for (const staff of eligibleStaff) {
    assignCount.set(staff.id, (apptsByKey.get(`${staff.id}|${dateStr}`) || []).length);
  }

  const slots = distinctTimes.map(time => {
    const candidates = byTime.get(time)!;
    // Pick the available barber who has the fewest assignments so far (tiebreak by
    // poolPriority, then name) → balanced rotation across the day.
    let best = candidates[0];
    let bestCount = assignCount.get(best.id) ?? 0;
    for (const c of candidates) {
      const n = assignCount.get(c.id) ?? 0;
      if (n < bestCount || (n === bestCount && (c.poolPriority < best.poolPriority || (c.poolPriority === best.poolPriority && c.name < best.name)))) {
        best = c;
        bestCount = n;
      }
    }
    assignCount.set(best.id, bestCount + 1);
    return {
      time,
      staffId: best.id,
      staffName: best.name,
      staffAvatar: best.avatarUrl,
      serviceId: best.svc.id,
      serviceName: best.svc.name,
      price: Number(best.svc.price),
      duration: best.svc.durationMinutes,
    };
  });

  return NextResponse.json({ slots });
}

function safeArr(s: string): { start: string; end: string }[] {
  try { return JSON.parse(s); } catch { return []; }
}
