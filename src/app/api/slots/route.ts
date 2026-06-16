import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { resolveBusinessId, fallbackBusiness } from "@/lib/tenant";
import { generateSlots, getDayOfWeekISO, timeToMinutes, getBusinessNow, addDaysISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const staffId = searchParams.get("staffId");
  const serviceId = searchParams.get("serviceId");
  const dateStr = searchParams.get("date");
  // Resolve businessId from ?slug= / ?businessId= (used only for business-wide
  // lead-time defaults; the actual schedule derives from the tenant-safe staffId).
  const businessId = await resolveBusinessId(request);

  if (!staffId || !serviceId || !dateStr) {
    return NextResponse.json(
      { error: "staffId, serviceId, and date are required" },
      { status: 400 }
    );
  }

  const date = new Date(dateStr + "T00:00:00.000Z"); // UTC midnight
  const dayOfWeek = getDayOfWeekISO(dateStr);       // always UTC – immune to server TZ

  // Get service duration (check for custom duration)
  const staffService = await prisma.staffService.findUnique({
    where: { staffId_serviceId: { staffId, serviceId } },
    include: { service: true },
  });

  if (!staffService) {
    return NextResponse.json({ error: "Service not available for this staff" }, { status: 404 });
  }

  const duration = staffService.customDuration || staffService.service.durationMinutes;

  // ── Booking horizon gate ─────────────────────────────────────────────────
  // Days beyond the barber's booking horizon are not open for booking yet. The
  // customer can still browse/waitlist them, but we must not offer slots — so
  // the calendar shows no green dot and no bookable times there.
  {
    const [staffForHorizon, bizForHorizon] = await Promise.all([
      prisma.staff.findUnique({ where: { id: staffId }, select: { settings: true } }),
      businessId
        ? prisma.business.findUnique({ where: { id: businessId }, select: { bookingHorizonDays: true } })
        : fallbackBusiness({ select: { bookingHorizonDays: true } }),
    ]);
    let horizonDays = bizForHorizon?.bookingHorizonDays ?? 30;
    try {
      if (staffForHorizon?.settings) {
        const cfg = JSON.parse(staffForHorizon.settings) as Record<string, unknown>;
        if (cfg.bookingHorizonDays !== undefined) {
          const h = Number(cfg.bookingHorizonDays);
          if (!isNaN(h) && h > 0) horizonDays = h;
        }
      }
    } catch { /* malformed settings — keep business default */ }
    const nowBiz = getBusinessNow();
    const lastBookableDate = addDaysISO(nowBiz.date, Math.max(0, horizonDays - 1));
    if (dateStr > lastBookableDate) {
      return NextResponse.json({ slots: [], beyondHorizon: true });
    }
  }

  // Check for override first
  const override = await prisma.staffScheduleOverride.findUnique({
    where: {
      staffId_date: {
        staffId,
        date,
      },
    },
  });

  if (override && !override.isWorking) {
    return NextResponse.json({ slots: [], closed: true }); // Day off override
  }

  // Get schedule
  let scheduleSlots: { start: string; end: string }[] = [];
  let breaks: { start: string; end: string }[] | null = null;

  if (override && override.isWorking && override.slots) {
    scheduleSlots = JSON.parse(override.slots);
    breaks = override.breaks ? JSON.parse(override.breaks) : null;
  } else {
    const schedule = await prisma.staffSchedule.findUnique({
      where: { staffId_dayOfWeek: { staffId, dayOfWeek } },
    });

    if (!schedule || !schedule.isWorking) {
      return NextResponse.json({ slots: [], closed: true }); // No schedule or day off
    }

    scheduleSlots = JSON.parse(schedule.slots);
    breaks = schedule.breaks ? JSON.parse(schedule.breaks) : null;
  }

  // Get existing appointments for the day.
  // ⚠️ Query the whole UTC day as a RANGE (not an exact-midnight equality):
  // historically some appointments were stored with the start time baked into
  // `date` (e.g. 2026-07-01T10:30:00Z). An exact `date: midnight` match would
  // miss those rows and present a taken slot as free → double-booking.
  const dayStart = date;
  const dayEnd = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const appointments = await prisma.appointment.findMany({
    where: {
      staffId,
      date: { gte: dayStart, lt: dayEnd },
      status: { in: ["pending", "confirmed"] },
    },
    select: { startTime: true, endTime: true },
  });

  let slots = generateSlots(scheduleSlots, breaks, duration, appointments);

  // Filter out past slots + honor min-lead-time when the requested date is today.
  // ⚠️  The JSON.parse for staff settings lives in its own try/catch so that a
  //     malformed settings string does NOT cause the outer catch to swallow the
  //     entire filter block (which would leave past slots visible).
  try {
    const nowBiz = getBusinessNow();
    if (nowBiz.date === dateStr) {
      // Per-barber override takes priority over business-level setting
      const staffRecord = await prisma.staff.findUnique({
        where: { id: staffId },
        select: { settings: true },
      });

      let staffSettings: Record<string, unknown> = {};
      try {
        if (staffRecord?.settings) staffSettings = JSON.parse(staffRecord.settings);
      } catch { /* ignore malformed settings JSON — fall through to business default */ }

      // Resolve regular lead time (per-barber override → business default).
      let leadMinutes = 0;
      // Resolve "first appointment of the day" lead time the same way.
      let firstLeadMinutes = 0;
      const needBizDefaults =
        staffSettings.minBookingLeadMinutes === undefined ||
        staffSettings.firstApptLeadMinutes === undefined;
      const biz = needBizDefaults
        ? (businessId
            ? await prisma.business.findUnique({ where: { id: businessId }, select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true } })
            : await fallbackBusiness({ select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true } }))
        : null;

      if (staffSettings.minBookingLeadMinutes !== undefined) {
        const parsed = Number(staffSettings.minBookingLeadMinutes);
        leadMinutes = isNaN(parsed) ? 0 : parsed;
      } else {
        leadMinutes = biz?.minBookingLeadMinutes ?? 0;
      }

      if (staffSettings.firstApptLeadMinutes !== undefined) {
        const parsed = Number(staffSettings.firstApptLeadMinutes);
        firstLeadMinutes = isNaN(parsed) ? 0 : parsed;
      } else {
        firstLeadMinutes = biz?.firstApptLeadMinutes ?? 0;
      }

      // When there are no appointments yet today, the next booking IS the first
      // of the day — apply the larger of the two lead times.
      const effectiveLead = appointments.length === 0
        ? Math.max(firstLeadMinutes, leadMinutes)
        : leadMinutes;
      slots = slots.filter(s => timeToMinutes(s) >= nowBiz.minutes + effectiveLead);
    }
  } catch (e) {
    console.error("getBusinessNow failed, skipping past-slot filter:", e);
  }

  return NextResponse.json({ slots });
}
