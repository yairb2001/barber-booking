import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { resolveBusinessId } from "@/lib/tenant";
import {
  generateSlots,
  timeToMinutes,
  getBusinessNow,
  addDaysISO,
  getDayOfWeekISO,
} from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/slots/upcoming-team
// Team-wide "all upcoming appointments" feed for the booking flow. Walks the next
// SCAN_DAYS days across ALL bookable barbers (each using their first offered
// visible service) and returns a mixed, time-ordered list that:
//   • spans at most SCAN_DAYS days ahead,
//   • is capped at MAX_RESULTS slots,
//   • alternates barbers so no single barber dominates the list,
//   • gives barbers with emptier calendars fair exposure (round-robin by earliest
//     remaining slot) without making any one of them look obviously empty,
//   • avoids repeating the same clock time too many times so the times look varied.
// Each slot: { staffId, staffName, staffAvatar, serviceId, serviceName, date, time, duration, price }.

// No fixed day cap — we walk forward only as far as the booking horizon lets us
// (each barber's own horizon, bounded so a pathological case can't scan forever),
// and simply stop once we've collected MAX_RESULTS slots.
const MAX_SCAN_DAYS = 120;    // hard bound on how far ahead we ever scan
const MAX_RESULTS = 25;       // no more than 25 slots total
const PER_BARBER_CAP = 8;     // keep variety — no barber floods the list
const MIN_GAP_MIN = 60;       // space a single barber's picks ≥60 min apart
const MAX_SAME_TIME = 2;      // the same HH:MM appears at most twice across the feed

type Candidate = {
  staffId: string;
  staffName: string;
  staffAvatar: string | null;
  date: string;
  time: string;
  timeMinutes: number; // absolute (dayOffset folded in) for global ordering
  serviceId: string;
  serviceName: string;
  price: number;
  duration: number;
};

export async function GET(request: Request) {
  const resolvedBusinessId = (await resolveBusinessId(request)) ?? undefined;

  const biz = resolvedBusinessId
    ? await prisma.business.findUnique({ where: { id: resolvedBusinessId }, select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true, bookingHorizonDays: true } })
    : await prisma.business.findFirst({ select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true, bookingHorizonDays: true } });
  const leadMinutes = biz?.minBookingLeadMinutes ?? 0;
  const bizFirstLead = biz?.firstApptLeadMinutes ?? 0;
  const bizHorizon = biz?.bookingHorizonDays ?? 30;

  const bizScope = resolvedBusinessId ? { businessId: resolvedBusinessId } : {};

  // First visible service (by sortOrder) each barber offers → their default service.
  const visibleServices = await prisma.service.findMany({
    where: { isVisible: true, ...bizScope },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, price: true, durationMinutes: true },
  });
  if (visibleServices.length === 0) return NextResponse.json({ slots: [] });

  // Only barbers enabled for quick appointments (inQuickPool) appear in the
  // team-wide feed — same gate as the home-page quick slots, so a barber the
  // owner excluded from quick booking never shows up here.
  const poolStaff = await prisma.staff.findMany({
    where: { inQuickPool: true, isAvailable: true, ...bizScope },
    orderBy: { poolPriority: "asc" },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      settings: true,
      staffServices: { select: { serviceId: true, customPrice: true, customDuration: true } },
    },
  });

  const eligibleStaff = poolStaff
    .map(s => {
      const offered = new Set(s.staffServices.map(ss => ss.serviceId));
      const svc = visibleServices.find(v => offered.has(v.id));
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
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (eligibleStaff.length === 0) return NextResponse.json({ slots: [] });

  const nowBiz = getBusinessNow();
  const todayStr = nowBiz.date;
  const staffIds = eligibleStaff.map(s => s.id);
  // Scan only as far as the furthest open horizon, bounded by MAX_SCAN_DAYS.
  const scanDays = Math.min(MAX_SCAN_DAYS, Math.max(1, ...eligibleStaff.map(s => s.horizon)));
  const firstDate = new Date(todayStr + "T00:00:00.000Z");
  const lastDate = new Date(addDaysISO(todayStr, scanDays - 1) + "T00:00:00.000Z");

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

  // ── Build each barber's spaced candidate queue (chronological) ───────────────
  const queues = new Map<string, Candidate[]>();
  for (const staff of eligibleStaff) {
    const picked: Candidate[] = [];
    let lastTime = -999;

    for (let dayOffset = 0; dayOffset < scanDays; dayOffset++) {
      if (dayOffset >= staff.horizon) break; // past this barber's booking horizon
      const dateStr = addDaysISO(todayStr, dayOffset);
      const override = overrideByKey.get(`${staff.id}|${dateStr}`);
      if (override && !override.isWorking) continue;

      let scheduleSlots: { start: string; end: string }[] = [];
      let breaks: { start: string; end: string }[] | null = null;
      if (override && override.isWorking && override.slots) {
        scheduleSlots = safeArr(override.slots);
        breaks = override.breaks ? safeArr(override.breaks) : null;
      } else {
        const schedule = schedByKey.get(`${staff.id}|${getDayOfWeekISO(dateStr)}`);
        if (!schedule || !schedule.isWorking) continue;
        scheduleSlots = safeArr(schedule.slots);
        breaks = schedule.breaks ? safeArr(schedule.breaks) : null;
      }

      const appointments = apptsByKey.get(`${staff.id}|${dateStr}`) || [];
      let slots = generateSlots(scheduleSlots, breaks, staff.svc.durationMinutes, appointments);
      if (dayOffset === 0) {
        const effectiveLead = appointments.length === 0
          ? Math.max(staff.staffFirstLead, staff.staffLead)
          : staff.staffLead;
        slots = slots.filter(s => timeToMinutes(s) >= nowBiz.minutes + effectiveLead);
      }

      for (const time of slots) {
        const abs = timeToMinutes(time) + dayOffset * 24 * 60;
        if (abs - lastTime < MIN_GAP_MIN) continue; // space this barber's picks out
        lastTime = abs;
        picked.push({
          staffId: staff.id,
          staffName: staff.name,
          staffAvatar: staff.avatarUrl,
          date: dateStr,
          time,
          timeMinutes: abs,
          serviceId: staff.svc.id,
          serviceName: staff.svc.name,
          price: Number(staff.svc.price),
          duration: staff.svc.durationMinutes,
        });
        if (picked.length >= PER_BARBER_CAP) break;
      }
      if (picked.length >= PER_BARBER_CAP) break;
    }

    if (picked.length > 0) queues.set(staff.id, picked);
  }

  if (queues.size === 0) return NextResponse.json({ slots: [] });

  // ── Merge: repeatedly take the barber whose next slot is earliest. This keeps
  // the feed roughly chronological while alternating barbers, and since emptier
  // barbers contribute more candidates they get fair exposure (capped above so
  // none floods). Skip a slot when its clock time already appears MAX_SAME_TIME
  // times, so the displayed times stay varied. ──────────────────────────────
  const cursor = new Map<string, number>();
  const queueEntries = Array.from(queues.entries());
  for (const [id] of queueEntries) cursor.set(id, 0);
  const timeCount = new Map<string, number>();
  const result: Candidate[] = [];

  while (result.length < MAX_RESULTS) {
    let bestId: string | null = null;
    let bestAbs = Infinity;
    for (const [id, q] of queueEntries) {
      const idx = cursor.get(id)!;
      if (idx >= q.length) continue;
      if (q[idx].timeMinutes < bestAbs) { bestAbs = q[idx].timeMinutes; bestId = id; }
    }
    if (!bestId) break; // all queues exhausted

    const idx = cursor.get(bestId)!;
    const cand = queues.get(bestId)![idx];
    cursor.set(bestId, idx + 1);

    const seen = timeCount.get(cand.time) || 0;
    if (seen >= MAX_SAME_TIME) continue; // too many of this clock time already
    timeCount.set(cand.time, seen + 1);
    result.push(cand);
  }

  const slots = result.map(c => ({
    staffId: c.staffId,
    staffName: c.staffName,
    staffAvatar: c.staffAvatar,
    serviceId: c.serviceId,
    serviceName: c.serviceName,
    date: c.date,
    time: c.time,
    duration: c.duration,
    price: c.price,
  }));

  return NextResponse.json({ slots });
}

function safeArr(s: string): { start: string; end: string }[] {
  try { return JSON.parse(s); } catch { return []; }
}
