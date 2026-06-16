import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { resolveBusinessId, fallbackBusiness } from "@/lib/tenant";
import { generateSlots, getDayOfWeekISO, timeToMinutes, getBusinessNow, addDaysISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET /api/slots/upcoming?staffId=&serviceId=&limit=20
// Walks forward from today and returns the next `limit` bookable slots in
// chronological order: { slots: [{ date: "YYYY-MM-DD", time: "HH:MM" }, ...] }.
// Powers the "all upcoming appointments" quick list in the booking flow.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const staffId = searchParams.get("staffId");
  const serviceId = searchParams.get("serviceId");
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 20, 1), 50);
  const businessId = await resolveBusinessId(request);

  if (!staffId || !serviceId) {
    return NextResponse.json({ error: "staffId and serviceId are required" }, { status: 400 });
  }

  const staffService = await prisma.staffService.findUnique({
    where: { staffId_serviceId: { staffId, serviceId } },
    include: { service: true },
  });
  if (!staffService) {
    return NextResponse.json({ error: "Service not available for this staff" }, { status: 404 });
  }
  const duration = staffService.customDuration || staffService.service.durationMinutes;

  const SCAN_DAYS = 120; // how far ahead we're willing to look for `limit` slots
  const nowBiz = getBusinessNow();
  const startStr = nowBiz.date;
  const endStr = addDaysISO(startStr, SCAN_DAYS - 1);
  const rangeStart = new Date(startStr + "T00:00:00.000Z");
  const rangeEnd = new Date(endStr + "T00:00:00.000Z");

  const [weekly, overrides, appts, staffRecord] = await Promise.all([
    prisma.staffSchedule.findMany({ where: { staffId } }),
    prisma.staffScheduleOverride.findMany({ where: { staffId, date: { gte: rangeStart, lte: rangeEnd } } }),
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

  // Lead time (per-barber override → business default)
  let staffSettings: Record<string, unknown> = {};
  try { if (staffRecord?.settings) staffSettings = JSON.parse(staffRecord.settings); } catch { /* ignore */ }
  // Always fetch the business: we need bookingHorizonDays regardless of whether
  // the staff overrides lead times, so this list respects the booking window
  // exactly like the calendar's green dots (no slots past the horizon).
  const biz = businessId
    ? await prisma.business.findUnique({ where: { id: businessId }, select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true, bookingHorizonDays: true } })
    : await fallbackBusiness({ select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true, bookingHorizonDays: true } });
  const leadMinutes = staffSettings.minBookingLeadMinutes !== undefined
    ? (isNaN(Number(staffSettings.minBookingLeadMinutes)) ? 0 : Number(staffSettings.minBookingLeadMinutes))
    : (biz?.minBookingLeadMinutes ?? 0);
  const firstLeadMinutes = staffSettings.firstApptLeadMinutes !== undefined
    ? (isNaN(Number(staffSettings.firstApptLeadMinutes)) ? 0 : Number(staffSettings.firstApptLeadMinutes))
    : (biz?.firstApptLeadMinutes ?? 0);

  // Booking horizon (per-barber override → business default → 30). Days beyond
  // it are NOT yet open for booking, so they must not appear in this list.
  let horizonDays = biz?.bookingHorizonDays ?? 30;
  if (staffSettings.bookingHorizonDays !== undefined) {
    const h = Number(staffSettings.bookingHorizonDays);
    if (!isNaN(h) && h > 0) horizonDays = h;
  }
  const lastBookableDate = addDaysISO(nowBiz.date, Math.max(0, horizonDays - 1));

  const result: { date: string; time: string }[] = [];
  let dateStr = startStr;
  for (let i = 0; i < SCAN_DAYS && result.length < limit; i++, dateStr = addDaysISO(dateStr, 1)) {
    if (dateStr > lastBookableDate) break; // past the booking horizon — stop
    const override = overrideByDate.get(dateStr);
    let scheduleSlots: { start: string; end: string }[] = [];
    let breaks: { start: string; end: string }[] | null = null;

    if (override && !override.isWorking) continue;
    if (override && override.isWorking && override.slots) {
      scheduleSlots = safeArr(override.slots);
      breaks = override.breaks ? safeArr(override.breaks) : null;
    } else {
      const sched = weeklyByDow.get(getDayOfWeekISO(dateStr));
      if (!sched || !sched.isWorking) continue;
      scheduleSlots = safeArr(sched.slots);
      breaks = sched.breaks ? safeArr(sched.breaks) : null;
    }

    let slots = generateSlots(scheduleSlots, breaks, duration, apptsByDate.get(dateStr) || []);

    if (dateStr === nowBiz.date) {
      const dayAppts = apptsByDate.get(dateStr) || [];
      const effectiveLead = dayAppts.length === 0 ? Math.max(firstLeadMinutes, leadMinutes) : leadMinutes;
      slots = slots.filter(s => timeToMinutes(s) >= nowBiz.minutes + effectiveLead);
    }

    for (const t of slots) {
      result.push({ date: dateStr, time: t });
      if (result.length >= limit) break;
    }
  }

  return NextResponse.json({ slots: result });
}

function safeArr(s: string): { start: string; end: string }[] {
  try { return JSON.parse(s); } catch { return []; }
}
