import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { generateSlots, getDayOfWeekISO, timeToMinutes, getBusinessNow } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const staffId = searchParams.get("staffId");
  const serviceId = searchParams.get("serviceId");
  const dateStr = searchParams.get("date");

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

  // Get existing appointments for the day
  const appointments = await prisma.appointment.findMany({
    where: {
      staffId,
      date,
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

      let leadMinutes = 0;
      if (staffSettings.minBookingLeadMinutes !== undefined) {
        const parsed = Number(staffSettings.minBookingLeadMinutes);
        leadMinutes = isNaN(parsed) ? 0 : parsed;
      } else {
        const biz = await prisma.business.findFirst({ select: { minBookingLeadMinutes: true } });
        leadMinutes = biz?.minBookingLeadMinutes ?? 0;
      }
      slots = slots.filter(s => timeToMinutes(s) >= nowBiz.minutes + leadMinutes);
    }
  } catch (e) {
    console.error("getBusinessNow failed, skipping past-slot filter:", e);
  }

  return NextResponse.json({ slots });
}
