import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { generateSlots, getDayOfWeek, formatDate, timeToMinutes } from "@/lib/utils";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const staffIdFilter = searchParams.get("staffId"); // optional: for specific barber

  // Get staff members in the quick pool
  const staffWhere = staffIdFilter
    ? { id: staffIdFilter, isAvailable: true }
    : { inQuickPool: true, isAvailable: true };

  const poolStaff = await prisma.staff.findMany({
    where: staffWhere,
    orderBy: { poolPriority: "asc" },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      poolPriority: true,
    },
  });

  if (poolStaff.length === 0) {
    return NextResponse.json([]);
  }

  // Get the default service (first service)
  const defaultService = await prisma.service.findFirst({
    where: { isVisible: true },
    orderBy: { sortOrder: "asc" },
  });

  if (!defaultService) {
    return NextResponse.json([]);
  }

  const now = new Date();

  // Collect ALL available slots across all pool staff for next 3 days
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

  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    const date = new Date(now);
    date.setDate(date.getDate() + dayOffset);
    const dateStr = formatDate(date);
    const dayOfWeek = getDayOfWeek(date);
    const dayLabel =
      dayOffset === 0 ? "היום" : dayOffset === 1 ? "מחר"
        : date.toLocaleDateString("he-IL", { weekday: "long" });

    for (const staff of poolStaff) {
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

      const staffService = await prisma.staffService.findUnique({
        where: { staffId_serviceId: { staffId: staff.id, serviceId: defaultService.id } },
      });

      const duration = staffService?.customDuration || defaultService.durationMinutes;
      const price = staffService?.customPrice || defaultService.price;

      const appointments = await prisma.appointment.findMany({
        where: { staffId: staff.id, date, status: { in: ["pending", "confirmed"] } },
        select: { startTime: true, endTime: true },
      });

      const slots = generateSlots(scheduleSlots, breaks, duration, appointments);

      const available = dayOffset === 0
        ? slots.filter((s) => {
            const [h, m] = s.split(":").map(Number);
            const slotTime = new Date(date);
            slotTime.setHours(h, m, 0, 0);
            return slotTime > now;
          })
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
          serviceId: defaultService.id,
          serviceName: defaultService.name,
          price: Number(price),
          duration,
        });
      }
    }
  }

  if (allCandidates.length === 0) return NextResponse.json([]);

  // Sort by absolute time
  allCandidates.sort((a, b) => a.timeMinutes - b.timeMinutes);

  // For specific staff: return first 3 diverse slots (spaced at least 60 min apart)
  if (staffIdFilter) {
    const selected = [];
    let lastTime = -999;
    for (const c of allCandidates) {
      if (c.timeMinutes - lastTime >= 60) {
        selected.push(c);
        lastTime = c.timeMinutes;
        if (selected.length >= 3) break;
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
