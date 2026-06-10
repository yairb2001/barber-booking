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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const staffIdFilter = searchParams.get("staffId"); // optional: for specific barber

  // Resolve businessId from ?slug= / ?businessId= (backward-compat: → findFirst)
  const resolvedBusinessId = (await resolveBusinessId(request)) ?? undefined;

  // Get business-wide min lead time for bookings
  const biz = resolvedBusinessId
    ? await prisma.business.findUnique({ where: { id: resolvedBusinessId }, select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true } })
    : await prisma.business.findFirst({ select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true } });
  const leadMinutes = biz?.minBookingLeadMinutes ?? 0;
  const bizFirstLead = biz?.firstApptLeadMinutes ?? 0;

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
  // they offer, with any per-barber price/duration overrides applied.
  const eligiblePoolStaff = poolStaff
    .map(s => {
      const offered = new Set(s.staffServices.map(ss => ss.serviceId));
      const svc = visibleServices.find(v => offered.has(v.id));
      if (!svc) return null;
      const ss = s.staffServices.find(x => x.serviceId === svc.id);
      return {
        id: s.id,
        name: s.name,
        avatarUrl: s.avatarUrl,
        poolPriority: s.poolPriority,
        settings: s.settings,
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

  // Collect ALL available slots across all pool staff for next 7 days
  const allCandidates: {
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
  }[] = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const dateStr   = addDaysISO(todayStr, dayOffset);
    const date      = new Date(dateStr + "T00:00:00.000Z"); // UTC midnight
    const dayOfWeek = getDayOfWeekISO(dateStr);
    const dayLabel =
      dayOffset === 0 ? "היום" : dayOffset === 1 ? "מחר"
        : date.toLocaleDateString("he-IL", { weekday: "long", timeZone: "Asia/Jerusalem" });

    for (const staff of eligiblePoolStaff) {
      const override = await prisma.staffScheduleOverride.findUnique({
        where: { staffId_date: { staffId: staff.id, date } },
      });
      if (override && !override.isWorking) continue;

      let scheduleSlots: { start: string; end: string }[] = [];
      let breaks: { start: string; end: string }[] | null = null;

      if (override && override.isWorking && override.slots) {
        scheduleSlots = JSON.parse(override.slots);
        breaks = override.breaks ? JSON.parse(override.breaks) : null;
      } else {
        const schedule = await prisma.staffSchedule.findUnique({
          where: { staffId_dayOfWeek: { staffId: staff.id, dayOfWeek } },
        });
        if (!schedule || !schedule.isWorking) continue;
        scheduleSlots = JSON.parse(schedule.slots);
        breaks = schedule.breaks ? JSON.parse(schedule.breaks) : null;
      }

      const duration = staff.svc.durationMinutes;
      const price = staff.svc.price;

      const appointments = await prisma.appointment.findMany({
        where: { staffId: staff.id, date, status: { in: ["pending", "confirmed"] } },
        select: { startTime: true, endTime: true },
      });

      const slots = generateSlots(scheduleSlots, breaks, duration, appointments);

      // Resolve per-staff lead-time overrides (fall back to business defaults).
      let staffLead = leadMinutes;
      let staffFirstLead = bizFirstLead;
      try {
        if (staff.settings) {
          const ss = JSON.parse(staff.settings) as Record<string, unknown>;
          if (ss.minBookingLeadMinutes !== undefined) {
            const p = Number(ss.minBookingLeadMinutes);
            if (!isNaN(p)) staffLead = p;
          }
          if (ss.firstApptLeadMinutes !== undefined) {
            const p = Number(ss.firstApptLeadMinutes);
            if (!isNaN(p)) staffFirstLead = p;
          }
        }
      } catch { /* malformed settings — keep business defaults */ }

      // When no appointments yet today, the next slot is the first of the day.
      const effectiveLead = appointments.length === 0
        ? Math.max(staffFirstLead, staffLead)
        : staffLead;

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

  // For the home carousel: up to 3 slots per barber (spaced ≥60 min apart), sorted by time
  const perBarberSlots = new Map<string, number[]>(); // staffId → list of picked timeMinutes
  const selected: typeof allCandidates = [];

  for (const c of allCandidates) {
    const picked = perBarberSlots.get(c.staffId) || [];
    if (picked.length >= 3) continue;
    const tooClose = picked.some((t) => Math.abs(c.timeMinutes - t) < 60);
    if (tooClose) continue;
    picked.push(c.timeMinutes);
    perBarberSlots.set(c.staffId, picked);
    selected.push(c);
  }

  selected.sort((a, b) => a.timeMinutes - b.timeMinutes);

  return NextResponse.json(selected);
}
