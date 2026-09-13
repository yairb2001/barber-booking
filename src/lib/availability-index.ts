/**
 * In-memory availability for a whole business over a short window — built
 * with a handful of bulk queries, then answered from memory. For batch jobs
 * (rhythm nudge) that would otherwise call computeDayAvailability hundreds of
 * times (each one = several round-trips to the DB).
 *
 * Mirrors the customer-facing truth: weekly schedule, per-day overrides,
 * breaks, live bookings, per-barber service duration, today's lead time.
 * Per-customer barber blocks are the caller's job (pass blockedStaffIds).
 */
import { prisma } from "@/lib/prisma";
import { generateSlots, getDayOfWeekISO, timeToMinutes, getBusinessNow, addDaysISO } from "@/lib/utils";

export type StaffRow = { id: string; name: string; isAvailable: boolean; leadMinutes: number; firstLeadMinutes: number };
export type AvailabilityIndex = {
  fromISO: string; toISO: string;
  staff: StaffRow[];
  /** Free start times for one barber on one day for a given service (customer-facing rules). */
  slots(staffId: string, dateISO: string, serviceId: string | null): string[];
  /** Least-loaded barbers first for a day. */
  staffByLoad(dateISO: string): StaffRow[];
};

export async function buildAvailabilityIndex(businessId: string, fromISO: string, days: number): Promise<AvailabilityIndex> {
  const toISO = addDaysISO(fromISO, Math.max(0, days - 1));
  const first = new Date(fromISO + "T00:00:00.000Z"), last = new Date(toISO + "T00:00:00.000Z");
  const [biz, staffRows, services] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { minBookingLeadMinutes: true, firstApptLeadMinutes: true } }),
    prisma.staff.findMany({ where: { businessId, isAvailable: true }, select: { id: true, name: true, isAvailable: true, settings: true, staffServices: { select: { serviceId: true, customDuration: true } } } }),
    prisma.service.findMany({ where: { businessId }, select: { id: true, durationMinutes: true } }),
  ]);
  const staffIds = staffRows.map(s => s.id);
  const [schedules, overrides, appts] = await Promise.all([
    prisma.staffSchedule.findMany({ where: { staffId: { in: staffIds } }, select: { staffId: true, dayOfWeek: true, isWorking: true, slots: true, breaks: true } }),
    prisma.staffScheduleOverride.findMany({ where: { staffId: { in: staffIds }, date: { gte: first, lte: last } }, select: { staffId: true, date: true, isWorking: true, slots: true, breaks: true } }),
    prisma.appointment.findMany({ where: { staffId: { in: staffIds }, date: { gte: first, lte: last }, status: { in: ["pending", "confirmed"] } }, select: { staffId: true, date: true, startTime: true, endTime: true } }),
  ]);
  const numFrom = (raw: string | null, key: string, d: number) => { try { const v = raw ? Number(JSON.parse(raw)[key]) : NaN; return isNaN(v) ? d : v; } catch { return d; } };
  const staff: StaffRow[] = staffRows.map(s => ({
    id: s.id, name: s.name, isAvailable: s.isAvailable,
    leadMinutes: numFrom(s.settings, "minBookingLeadMinutes", biz?.minBookingLeadMinutes ?? 0),
    firstLeadMinutes: numFrom(s.settings, "firstApptLeadMinutes", biz?.firstApptLeadMinutes ?? 0),
  }));
  const svcDuration = new Map(services.map(s => [s.id, s.durationMinutes]));
  const staffDuration = new Map<string, number>(); // `${staffId}|${serviceId}` → minutes
  for (const s of staffRows) for (const ss of s.staffServices) staffDuration.set(`${s.id}|${ss.serviceId}`, ss.customDuration ?? svcDuration.get(ss.serviceId) ?? 30);
  const sched = new Map(schedules.map(sc => [`${sc.staffId}|${sc.dayOfWeek}`, sc]));
  const over = new Map(overrides.map(ov => [`${ov.staffId}|${ov.date.toISOString().slice(0, 10)}`, ov]));
  const booked = new Map<string, { startTime: string; endTime: string }[]>();
  for (const a of appts) { const k = `${a.staffId}|${a.date.toISOString().slice(0, 10)}`; booked.set(k, [...(booked.get(k) || []), { startTime: a.startTime, endTime: a.endTime }]); }
  const nowBiz = getBusinessNow();
  const cache = new Map<string, string[]>();

  const slots = (staffId: string, dateISO: string, serviceId: string | null): string[] => {
    const key = `${staffId}|${dateISO}|${serviceId ?? ""}`;
    const hit = cache.get(key); if (hit) return hit;
    const st = staff.find(s => s.id === staffId);
    if (!st || dateISO < fromISO || dateISO > toISO) { cache.set(key, []); return []; }
    const duration = serviceId ? (staffDuration.get(`${staffId}|${serviceId}`) ?? svcDuration.get(serviceId) ?? 30) : 30;
    const ov = over.get(`${staffId}|${dateISO}`);
    let work: { start: string; end: string }[] = [], breaks: { start: string; end: string }[] | null = null;
    if (ov) {
      if (!ov.isWorking) { cache.set(key, []); return []; }
      work = ov.slots ? JSON.parse(ov.slots) : []; breaks = ov.breaks ? JSON.parse(ov.breaks) : null;
    } else {
      const sc = sched.get(`${staffId}|${getDayOfWeekISO(dateISO)}`);
      if (!sc || !sc.isWorking) { cache.set(key, []); return []; }
      work = JSON.parse(sc.slots); breaks = sc.breaks ? JSON.parse(sc.breaks) : null;
    }
    const taken = booked.get(`${staffId}|${dateISO}`) || [];
    let out = generateSlots(work, breaks, duration, taken);
    if (dateISO === nowBiz.date) {
      const lead = taken.length === 0 ? Math.max(st.firstLeadMinutes, st.leadMinutes) : st.leadMinutes;
      out = out.filter(t => timeToMinutes(t) >= nowBiz.minutes + lead);
    }
    cache.set(key, out); return out;
  };
  const staffByLoad = (dateISO: string) => [...staff].sort((a, b) => (booked.get(`${a.id}|${dateISO}`)?.length || 0) - (booked.get(`${b.id}|${dateISO}`)?.length || 0));
  return { fromISO, toISO, staff, slots, staffByLoad };
}
