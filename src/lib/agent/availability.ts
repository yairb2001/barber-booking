/**
 * Availability helpers shared by the customer agent and the agent-driven
 * appointment move/swap flow. Kept in their own module so both can import the
 * SAME slot logic without a circular dependency between customer-agent.ts and
 * appointment-swap.ts.
 *
 * `computeDayAvailability` is the single source of truth for "what is free":
 * it applies the weekly schedule, per-date overrides, the per-barber booking
 * horizon, lead-time gating and existing bookings — mirroring /api/slots so the
 * agent offers EXACTLY what the website would.
 */

import { prisma } from "@/lib/prisma";
import {
  generateSlots,
  getDayOfWeekISO,
  timeToMinutes,
  getBusinessNow,
  addDaysISO,
} from "@/lib/utils";

export async function computeDayAvailability(
  bizId: string,
  date: string,
  inputStaffId?: string,
  inputServiceId?: string,
): Promise<{ staffId: string; name: string; slots: string[]; load: number }[]> {
  const dateObj = new Date(date + "T00:00:00.000Z");
  const dayOfWeek = getDayOfWeekISO(date); // UTC-safe — immune to server timezone
  const nowBiz = getBusinessNow();

  const staffList = await prisma.staff.findMany({
    where: { businessId: bizId, isAvailable: true, ...(inputStaffId ? { id: inputStaffId } : {}) },
    select: { id: true, name: true, settings: true },
  });
  if (!staffList.length) return [];

  const biz = await prisma.business.findUnique({
    where: { id: bizId },
    select: { bookingHorizonDays: true, minBookingLeadMinutes: true, firstApptLeadMinutes: true },
  });
  const defaultHorizon = biz?.bookingHorizonDays ?? 30;

  const reqService = inputServiceId
    ? await prisma.service.findUnique({
        where: { id: inputServiceId },
        select: { name: true, durationMinutes: true },
      })
    : null;

  const byStaff: { staffId: string; name: string; slots: string[]; load: number }[] = [];

  for (const staff of staffList) {
    let cfg: Record<string, unknown> = {};
    if (staff.settings) {
      try { cfg = JSON.parse(staff.settings) as Record<string, unknown>; }
      catch { /* malformed settings — fall back to business defaults */ }
    }
    const numFromCfg = (key: string): number | undefined => {
      if (cfg[key] === undefined) return undefined;
      const n = Number(cfg[key]);
      return isNaN(n) ? undefined : n;
    };

    const horizonCfg = numFromCfg("bookingHorizonDays");
    const horizonDays = horizonCfg !== undefined && horizonCfg > 0 ? horizonCfg : defaultHorizon;
    const lastBookableDate = addDaysISO(nowBiz.date, Math.max(0, horizonDays - 1));
    if (date > lastBookableDate) continue; // beyond this barber's horizon → not bookable

    let duration = 30;
    if (inputServiceId) {
      const ss = await prisma.staffService.findUnique({
        where: { staffId_serviceId: { staffId: staff.id, serviceId: inputServiceId } },
        include: { service: true },
      });
      if (ss) {
        duration = ss.customDuration ?? ss.service.durationMinutes;
      } else if (reqService) {
        const alt =
          (await prisma.staffService.findFirst({
            where: { staffId: staff.id, service: { name: reqService.name } },
            include: { service: true },
          })) ??
          (await prisma.staffService.findFirst({
            where: { staffId: staff.id, service: { durationMinutes: reqService.durationMinutes } },
            include: { service: true },
          }));
        if (!alt) continue;
        duration = alt.customDuration ?? alt.service.durationMinutes;
      } else {
        continue; // unknown service id
      }
    } else {
      const firstSvc = await prisma.staffService.findFirst({
        where: { staffId: staff.id },
        include: { service: true },
        orderBy: { service: { durationMinutes: "asc" } },
      });
      duration = firstSvc?.customDuration ?? firstSvc?.service.durationMinutes ?? 30;
    }

    const override = await prisma.staffScheduleOverride.findUnique({
      where: { staffId_date: { staffId: staff.id, date: dateObj } },
    });
    if (override && !override.isWorking) continue; // day off

    let scheduleSlots: { start: string; end: string }[] = [];
    let breaks: { start: string; end: string }[] | null = null;

    if (override?.isWorking && override.slots) {
      scheduleSlots = JSON.parse(override.slots);
      breaks = override.breaks ? JSON.parse(override.breaks) : null;
    } else {
      const schedule = await prisma.staffSchedule.findUnique({
        where: { staffId_dayOfWeek: { staffId: staff.id, dayOfWeek } },
      });
      if (!schedule?.isWorking) continue;
      scheduleSlots = JSON.parse(schedule.slots);
      breaks = schedule.breaks ? JSON.parse(schedule.breaks) : null;
    }

    const dayStart = dateObj;
    const dayEnd   = new Date(dateObj.getTime() + 24 * 60 * 60 * 1000);
    const booked = await prisma.appointment.findMany({
      where: { staffId: staff.id, date: { gte: dayStart, lt: dayEnd }, status: { in: ["pending", "confirmed"] } },
      select: { startTime: true, endTime: true },
    });

    let slots = generateSlots(scheduleSlots, breaks, duration, booked);

    if (nowBiz.date === date) {
      const leadMinutes =
        numFromCfg("minBookingLeadMinutes") ?? biz?.minBookingLeadMinutes ?? 0;
      const firstLeadMinutes =
        numFromCfg("firstApptLeadMinutes") ?? biz?.firstApptLeadMinutes ?? 0;
      const effectiveLead = booked.length === 0
        ? Math.max(firstLeadMinutes, leadMinutes)
        : leadMinutes;
      slots = slots.filter(s => timeToMinutes(s) >= nowBiz.minutes + effectiveLead);
    }

    if (slots.length) byStaff.push({ staffId: staff.id, name: staff.name, slots, load: booked.length });
  }

  if (!inputStaffId) byStaff.sort((a, b) => a.load - b.load);
  return byStaff;
}

/**
 * Resolve a barber's EFFECTIVE duration & price for a requested service,
 * honoring per-barber StaffService overrides and tolerating the duplicate
 * catalog problem (falls back to same-name, then same-duration service the
 * barber actually offers; base values only as a last resort).
 */
export async function resolveStaffService(
  staffId: string,
  serviceId: string,
  reqName: string,
  reqDuration: number,
  reqPrice: number,
): Promise<{ duration: number; price: number }> {
  const ss =
    (await prisma.staffService.findUnique({
      where: { staffId_serviceId: { staffId, serviceId } },
      include: { service: true },
    })) ??
    (await prisma.staffService.findFirst({
      where: { staffId, service: { name: reqName } },
      include: { service: true },
    })) ??
    (await prisma.staffService.findFirst({
      where: { staffId, service: { durationMinutes: reqDuration } },
      include: { service: true },
    }));
  if (!ss) return { duration: reqDuration, price: reqPrice };
  return {
    duration: ss.customDuration ?? ss.service.durationMinutes,
    price:    ss.customPrice ?? ss.service.price,
  };
}
