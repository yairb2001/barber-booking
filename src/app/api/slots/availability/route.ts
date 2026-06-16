import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { resolveBusinessId, fallbackBusiness } from "@/lib/tenant";
import { generateSlots, getDayOfWeekISO, timeToMinutes, getBusinessNow, addDaysISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET /api/slots/availability?staffId=&serviceId=&from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns { days: { "YYYY-MM-DD": true|false } } where true = at least one
// bookable slot exists that day. Powers the green dots in the booking calendar.
// Range is capped at 70 days to keep the single query cheap.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const staffId = searchParams.get("staffId");
  const serviceId = searchParams.get("serviceId");
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  const businessId = await resolveBusinessId(request);

  if (!staffId || !serviceId || !fromStr || !toStr) {
    return NextResponse.json({ error: "staffId, serviceId, from, to are required" }, { status: 400 });
  }

  // Service duration (with per-barber custom override)
  const staffService = await prisma.staffService.findUnique({
    where: { staffId_serviceId: { staffId, serviceId } },
    include: { service: true },
  });
  if (!staffService) {
    return NextResponse.json({ error: "Service not available for this staff" }, { status: 404 });
  }
  const duration = staffService.customDuration || staffService.service.durationMinutes;

  // Build the (capped) list of dates in [from, to]
  const dates: string[] = [];
  let cur = fromStr;
  for (let i = 0; i < 70 && cur <= toStr; i++) {
    dates.push(cur);
    cur = addDaysISO(cur, 1);
  }
  if (dates.length === 0) return NextResponse.json({ days: {} });

  const rangeStart = new Date(dates[0] + "T00:00:00.000Z");
  const rangeEnd = new Date(dates[dates.length - 1] + "T00:00:00.000Z");

  // Weekly schedule (≤7 rows), overrides in range, appointments in range — all up-front.
  const [weekly, overrides, appts, staffRecord] = await Promise.all([
    prisma.staffSchedule.findMany({ where: { staffId } }),
    prisma.staffScheduleOverride.findMany({
      where: { staffId, date: { gte: rangeStart, lte: rangeEnd } },
    }),
    prisma.appointment.findMany({
      where: { staffId, date: { gte: rangeStart, lte: rangeEnd }, status: { in: ["pending", "confirmed"] } },
      select: { date: true, startTime: true, endTime: true },
    }),
    prisma.staff.findUnique({ where: { id: staffId }, select: { settings: true } }),
  ]);

  const weeklyByDow = new Map(weekly.map(w => [w.dayOfWeek, w]));
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const overrideByDate = new Map(overrides.map(o => [fmt(o.date), o]));
  const apptsByDate = new Map<string, { startTime: string; endTime: string }[]>();
  for (const a of appts) {
    const k = fmt(a.date);
    if (!apptsByDate.has(k)) apptsByDate.set(k, []);
    apptsByDate.get(k)!.push({ startTime: a.startTime, endTime: a.endTime });
  }

  // Lead-time for "today" (per-barber override → business default)
  const nowBiz = getBusinessNow();
  let staffSettings: Record<string, unknown> = {};
  try { if (staffRecord?.settings) staffSettings = JSON.parse(staffRecord.settings); } catch { /* ignore */ }
  let leadMinutes = 0, firstLeadMinutes = 0;
  // Always fetch the business: we need bookingHorizonDays regardless of whether
  // the staff overrides lead times, so the green dots respect the booking window.
  const biz = businessId
    ? await prisma.business.findUnique({ where: { id: businessId }, select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true, bookingHorizonDays: true } })
    : await fallbackBusiness({ select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true, bookingHorizonDays: true } });
  leadMinutes = staffSettings.minBookingLeadMinutes !== undefined
    ? (isNaN(Number(staffSettings.minBookingLeadMinutes)) ? 0 : Number(staffSettings.minBookingLeadMinutes))
    : (biz?.minBookingLeadMinutes ?? 0);
  firstLeadMinutes = staffSettings.firstApptLeadMinutes !== undefined
    ? (isNaN(Number(staffSettings.firstApptLeadMinutes)) ? 0 : Number(staffSettings.firstApptLeadMinutes))
    : (biz?.firstApptLeadMinutes ?? 0);

  // Booking horizon (per-barber override → business default → 30). Days beyond
  // the horizon are NOT yet open for booking — they must show no availability
  // (no green dot), even though the customer can still browse/waitlist them.
  let horizonDays = biz?.bookingHorizonDays ?? 30;
  if (staffSettings.bookingHorizonDays !== undefined) {
    const h = Number(staffSettings.bookingHorizonDays);
    if (!isNaN(h) && h > 0) horizonDays = h;
  }
  const lastBookableDate = addDaysISO(nowBiz.date, Math.max(0, horizonDays - 1));

  const days: Record<string, boolean> = {};

  for (const dateStr of dates) {
    // Past days are never open
    if (dateStr < nowBiz.date) { days[dateStr] = false; continue; }
    // Beyond the booking horizon → not open yet (no green dot)
    if (dateStr > lastBookableDate) { days[dateStr] = false; continue; }

    const override = overrideByDate.get(dateStr);
    let scheduleSlots: { start: string; end: string }[] = [];
    let breaks: { start: string; end: string }[] | null = null;

    if (override && !override.isWorking) { days[dateStr] = false; continue; }
    if (override && override.isWorking && override.slots) {
      try { scheduleSlots = JSON.parse(override.slots); } catch { scheduleSlots = []; }
      breaks = override.breaks ? safeParse(override.breaks) : null;
    } else {
      const sched = weeklyByDow.get(getDayOfWeekISO(dateStr));
      if (!sched || !sched.isWorking) { days[dateStr] = false; continue; }
      try { scheduleSlots = JSON.parse(sched.slots); } catch { scheduleSlots = []; }
      breaks = sched.breaks ? safeParse(sched.breaks) : null;
    }

    let slots = generateSlots(scheduleSlots, breaks, duration, apptsByDate.get(dateStr) || []);

    // Past/lead filter only applies to today
    if (dateStr === nowBiz.date) {
      const dayAppts = apptsByDate.get(dateStr) || [];
      const effectiveLead = dayAppts.length === 0 ? Math.max(firstLeadMinutes, leadMinutes) : leadMinutes;
      slots = slots.filter(s => timeToMinutes(s) >= nowBiz.minutes + effectiveLead);
    }

    days[dateStr] = slots.length > 0;
  }

  return NextResponse.json({ days });
}

function safeParse(s: string): { start: string; end: string }[] | null {
  try { return JSON.parse(s); } catch { return null; }
}
