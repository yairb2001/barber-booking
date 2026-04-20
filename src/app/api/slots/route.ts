import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { generateSlots, getDayOfWeek } from "@/lib/utils";

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

  const date = new Date(dateStr + "T00:00:00");
  const dayOfWeek = getDayOfWeek(date);

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
    return NextResponse.json([]); // Day off
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
      return NextResponse.json([]);
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

  const slots = generateSlots(scheduleSlots, breaks, duration, appointments);

  return NextResponse.json(slots);
}
