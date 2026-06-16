import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { resolveBusinessId, fallbackBusiness } from "@/lib/tenant";
import {
  generateSlots,
  timeToMinutes,
  getBusinessNow,
  addDaysISO,
  getDayOfWeekISO,
} from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// How far ahead we are willing to scan when a barber is fully booked in the near
// term. Bounded so a pathological "booked solid" barber can't make us scan
// forever; the per-barber booking horizon caps it further per barber.
const MAX_SCAN_DAYS = 120;
// Once a barber has this many of their EARLIEST raw slots collected we stop
// scanning further days for them — plenty to pick a few well-spaced options,
// while keeping the in-memory slot generation cheap even at a long horizon.
const RAW_PER_STAFF = 40;

// Friendly Hebrew label for a slot's date. For anything a week or more out we
// include the actual date (weekday names alone repeat and would read as "soon").
function dayLabelFor(dateStr: string, dayOffset: number): string {
  if (dayOffset === 0) return "היום";
  if (dayOffset === 1) return "מחר";
  const date = new Date(dateStr + "T00:00:00.000Z");
  if (dayOffset < 7) {
    return date.toLocaleDateString("he-IL", { weekday: "long", timeZone: "Asia/Jerusalem" });
  }
  return date.toLocaleDateString("he-IL", { day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const staffIdFilter = searchParams.get("staffId"); // optional: for specific barber

  // Resolve businessId from ?slug= / ?businessId= (backward-compat: → findFirst)
  const resolvedBusinessId = (await resolveBusinessId(request)) ?? undefined;

  // Business-wide booking defaults: min lead time + how far ahead bookings open.
  const biz = resolvedBusinessId
    ? await prisma.business.findUnique({ where: { id: resolvedBusinessId }, select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true, bookingHorizonDays: true } })
    : await fallbackBusiness({ select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true, bookingHorizonDays: true } });
  const leadMinutes = biz?.minBookingLeadMinutes ?? 0;
  const bizFirstLead = biz?.firstApptLeadMinutes ?? 0;
  const bizHorizon = biz?.bookingHorizonDays ?? 30;

  // Get staff members in the quick pool
  const bizScope = resolvedBusinessId ? { businessId: resolvedBusinessId } : {};
  const staffWhere = staffIdFilter
    ? { id: staffIdFilter, isAvailable: true, ...bizScope }
    : { inQuickPool: true, isAvailable: true, ...bizScope };

  // All visible services, ordered — used to pick a per-staff default service.
  // We can't filter every barber against a single global "first service":
  // barbers who don't offer that exact service would silently produce no slots.
  // Instead each barber uses the first visible service THEY actually offer.
  const visibleServices = await prisma.service.findMany({
    where: { isVisible: true, ...bizScope },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, price: true, durationMinutes: true },
  });

  if (visibleServices.length === 0) {
    return NextResponse.json([]);
  }

  const poolStaff = await prisma.staff.findMany({
    where: staffWhere,
    orderBy: { poolPriority: "asc" },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      poolPriority: true,
      settings: true,
      // All of the staff's service assignments (incl. per-barber price/duration overrides)
      staffServices: { select: { serviceId: true, customPrice: true, customDuration: true } },
    },
  });

  // Resolve each barber's effective service: the first visible service (by sortOrder)
  // they offer, with any per-barber price/duration overrides applied. Also resolve
  // their lead-time + booking-horizon overrides up front (parse settings once).
  const eligiblePoolStaff = poolStaff
    .map(s => {
      const offered = new Set(s.staffServices.map(ss => ss.serviceId));
      const svc = visibleServices.find(v => offered.has(v.id));
      if (!svc) return null;
      const ss = s.staffServices.find(x => x.serviceId === svc.id);

      // Per-barber overrides (fall back to business defaults).
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
      } catch { /* malformed settings — keep business defaults */ }

      return {
        id: s.id,
        name: s.name,
        avatarUrl: s.avatarUrl,
        poolPriority: s.poolPriority,
        staffLead,
        staffFirstLead,
        // Cap the per-barber horizon so we never scan more than MAX_SCAN_DAYS.
        horizon: Math.min(horizon, MAX_SCAN_DAYS),
        svc: {
          id: svc.id,
          name: svc.name,
          price: ss?.customPrice || svc.price,
          durationMinutes: ss?.customDuration || svc.durationMinutes,
        },
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (eligiblePoolStaff.length === 0) {
    return NextResponse.json([]);
  }

  // Israel-aware "now" — avoids bugs when server is UTC and client is in Israel
  const nowBiz = getBusinessNow();
  const todayStr = nowBiz.date;

  // The furthest day any eligible barber lets us scan to.
  const maxHorizon = Math.max(...eligiblePoolStaff.map(s => s.horizon));
  const staffIds = eligiblePoolStaff.map(s => s.id);
  const firstDate = new Date(todayStr + "T00:00:00.000Z");
  const lastDate = new Date(addDaysISO(todayStr, Math.max(0, maxHorizon - 1)) + "T00:00:00.000Z");

  // ── Bulk-fetch everything we need for the whole window in 3 queries ──────────
  // (The old version issued an override + schedule + appointments query PER day
  //  PER barber; extending the window to weeks made that explode. Fetch once.)
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

  // Collect each barber's EARLIEST available slots, scanning day-by-day until they
  // have enough (RAW_PER_STAFF) or we reach their horizon. A barber free tomorrow
  // stops almost immediately; one booked solid for 3 weeks keeps scanning so we
  // still surface their first real opening instead of showing nothing.
  type Candidate = {
    staffId: string;
    staffName: string;
    staffAvatar: string | null;
    date: string;
    dayLabel: string;
    time: string;
    timeMinutes: number;
    serviceId: string;
    serviceName: string;
    price: number;
    duration: number;
  };
  const allCandidates: Candidate[] = [];
  const countByStaff = new Map<string, number>();
  const doneStaff = new Set<string>();

  for (let dayOffset = 0; dayOffset < maxHorizon; dayOffset++) {
    if (doneStaff.size === eligiblePoolStaff.length) break; // everyone has enough

    const dateStr = addDaysISO(todayStr, dayOffset);
    const dayOfWeek = getDayOfWeekISO(dateStr);
    const dayLabel = dayLabelFor(dateStr, dayOffset);

    for (const staff of eligiblePoolStaff) {
      if (doneStaff.has(staff.id)) continue;
      if (dayOffset >= staff.horizon) { doneStaff.add(staff.id); continue; }

      const override = overrideByKey.get(`${staff.id}|${dateStr}`);
      if (override && !override.isWorking) continue;

      let scheduleSlots: { start: string; end: string }[] = [];
      let breaks: { start: string; end: string }[] | null = null;

      if (override && override.isWorking && override.slots) {
        scheduleSlots = JSON.parse(override.slots);
        breaks = override.breaks ? JSON.parse(override.breaks) : null;
      } else {
        const schedule = schedByKey.get(`${staff.id}|${dayOfWeek}`);
        if (!schedule || !schedule.isWorking) continue;
        scheduleSlots = JSON.parse(schedule.slots);
        breaks = schedule.breaks ? JSON.parse(schedule.breaks) : null;
      }

      const duration = staff.svc.durationMinutes;
      const price = staff.svc.price;
      const appointments = apptsByKey.get(`${staff.id}|${dateStr}`) || [];

      const slots = generateSlots(scheduleSlots, breaks, duration, appointments);

      // When no appointments yet today, the next slot is the first of the day.
      const effectiveLead = appointments.length === 0
        ? Math.max(staff.staffFirstLead, staff.staffLead)
        : staff.staffLead;

      // Filter out slots whose time has already passed (for today) OR
      // slots that fall within the configured minimum lead time from now.
      const available = dayOffset === 0
        ? slots.filter((s) => timeToMinutes(s) >= nowBiz.minutes + effectiveLead)
        : slots;

      for (const time of available) {
        allCandidates.push({
          staffId: staff.id,
          staffName: staff.name,
          staffAvatar: staff.avatarUrl,
          date: dateStr,
          dayLabel,
          time,
          timeMinutes: timeToMinutes(time) + dayOffset * 24 * 60,
          serviceId: staff.svc.id,
          serviceName: staff.svc.name,
          price: Number(price),
          duration,
        });
      }

      const c = (countByStaff.get(staff.id) || 0) + available.length;
      countByStaff.set(staff.id, c);
      if (c >= RAW_PER_STAFF) doneStaff.add(staff.id);
    }
  }

  if (allCandidates.length === 0) return NextResponse.json([]);

  // Sort by absolute time
  allCandidates.sort((a, b) => a.timeMinutes - b.timeMinutes);

  // For specific staff: return first 6 diverse slots (spaced at least 60 min apart)
  if (staffIdFilter) {
    const selected = [];
    let lastTime = -999;
    for (const c of allCandidates) {
      if (c.timeMinutes - lastTime >= 60) {
        selected.push(c);
        lastTime = c.timeMinutes;
        if (selected.length >= 6) break;
      }
    }
    return NextResponse.json(selected);
  }

  // For the home carousel: up to 5 slots per barber (spaced ≥60 min apart), sorted by time
  const perBarberSlots = new Map<string, number[]>(); // staffId → list of picked timeMinutes
  const selected: typeof allCandidates = [];

  for (const c of allCandidates) {
    const picked = perBarberSlots.get(c.staffId) || [];
    if (picked.length >= 5) continue;
    const tooClose = picked.some((t) => Math.abs(c.timeMinutes - t) < 60);
    if (tooClose) continue;
    picked.push(c.timeMinutes);
    perBarberSlots.set(c.staffId, picked);
    selected.push(c);
  }

  selected.sort((a, b) => a.timeMinutes - b.timeMinutes);

  return NextResponse.json(selected);
}
