/**
 * New customers & second-visit retention — strict, visit-based.
 *
 * Owner's rule (20.9.2026): "new customer" data must count ONLY people who
 * actually had an appointment. A Customer row is also created when someone
 * just writes to the WhatsApp agent or joins a waitlist, so `Customer.createdAt`
 * over-counts. Definitions used here (and by the customers list "חדשים" filter):
 *
 *   visit         an appointment with status confirmed/completed whose END time
 *                 has already passed. Cancelled, no-show, pending and future
 *                 appointments are not visits.
 *   new (N days)  the customer's FIRST visit ever (with this barber, when a
 *                 staff filter is set) happened in the last N days, and the
 *                 owner didn't mark them "known before the system".
 *   returned      a second visit on a later day than the first has already
 *                 happened (two appointments on the same day — father + son on
 *                 one phone — are one visit).
 *   futureBooked  not returned yet, but holds a pending/confirmed appointment
 *                 that is still ahead — "on the way back".
 *   newSince      first visits before this date are NOT new: when a shop goes
 *                 live its whole existing clientele shows up as "first visit"
 *                 over the next ~6 weeks (DOMINANT: 115+146+89 "new" in the
 *                 first three weeks). The owner can set the date
 *                 (Business.settings.newCustomersSince); otherwise it is the
 *                 first busy week + 6 weeks.
 */
import { prisma } from "@/lib/prisma";
import { appointmentInstant } from "@/lib/utils";

export const RETENTION_WINDOWS = [30, 60, 90] as const;

export type RetentionCustomer = {
  id: string; name: string; phone: string;
  firstVisit: string;            // YYYY-MM-DD
  secondVisit: string | null;    // YYYY-MM-DD when returned
  futureBooking: string | null;  // YYYY-MM-DD when not returned but booked ahead
  visits: number;                // distinct visit days so far
};
export type RetentionWindow = {
  days: number;
  from: string;                  // YYYY-MM-DD — effective start (window start, or newSince when that is later)
  newCustomers: number;
  returned: number;
  rate: number;                  // % of newCustomers who returned (0 when none)
  futureBooked: number;          // of the not-yet-returned, how many have a future appointment
  customers: RetentionCustomer[];
};
export type RetentionResult = {
  asOf: string; staffId: string | null;
  newSince: string | null;                 // YYYY-MM-DD floor actually applied (null = none)
  newSinceSource: "manual" | "auto" | "none";
  windows: RetentionWindow[];
};

const VISIT_STATUSES = ["confirmed", "completed"] as const;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const LAUNCH_MIN_WEEKLY_VISITS = 30;
const LAUNCH_SETTLE_DAYS = 42;

/** The date from which a first visit counts as a NEW customer (see header). */
export async function resolveNewSince(businessId: string): Promise<{ date: string | null; source: "manual" | "auto" | "none" }> {
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } });
  try {
    const s = biz?.settings ? JSON.parse(biz.settings) : {};
    if (typeof s.newCustomersSince === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.newCustomersSince)) return { date: s.newCustomersSince, source: "manual" };
  } catch { /* ignore malformed settings */ }
  const weeks: { wk: Date; n: number }[] = await prisma.$queryRaw`
    SELECT date_trunc('week', date) AS wk, COUNT(*)::int AS n
    FROM appointments
    WHERE business_id = ${businessId} AND status IN ('confirmed', 'completed') AND date < NOW()
    GROUP BY 1 ORDER BY 1`;
  const launch = weeks.find(w => w.n >= LAUNCH_MIN_WEEKLY_VISITS);
  if (!launch) return { date: null, source: "none" };
  const floor = new Date(new Date(launch.wk).getTime() + LAUNCH_SETTLE_DAYS * 86_400_000);
  return { date: iso(floor), source: "auto" };
}

/** Customers whose first real visit was within `maxDays`, with everything needed for every smaller window. */
export async function computeRetention(opts: { businessId: string; staffId?: string | null; now?: Date; windows?: readonly number[] }): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const windows = [...(opts.windows ?? RETENTION_WINDOWS)].sort((a, b) => a - b);
  const maxDays = windows[windows.length - 1];
  const sf = opts.staffId ? { staffId: opts.staffId } : {};
  // Appointment dates are UTC-midnight of the ISRAEL calendar day, so "today"
  // must be the business day, not the UTC day (they differ from 21:00 UTC).
  const todayIL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const todayStart = new Date(todayIL + "T00:00:00.000Z");
  const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
  const since = await resolveNewSince(opts.businessId);
  const windowCutoff = new Date(todayStart.getTime() - maxDays * 86_400_000);
  const cutoff = since.date && new Date(since.date + "T00:00:00.000Z") > windowCutoff ? new Date(since.date + "T00:00:00.000Z") : windowCutoff;

  // 1) First visit per customer, all time (days strictly before today are certain;
  //    today's rows are checked one by one against their end time).
  const [groups, todayRows, knownBefore] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["customerId"],
      where: { businessId: opts.businessId, status: { in: [...VISIT_STATUSES] }, date: { lt: todayStart }, ...sf },
      _min: { date: true },
    }),
    prisma.appointment.findMany({
      where: { businessId: opts.businessId, status: { in: [...VISIT_STATUSES] }, date: { gte: todayStart, lt: tomorrowStart }, ...sf },
      select: { customerId: true, date: true, endTime: true },
    }),
    prisma.customer.findMany({ where: { businessId: opts.businessId, knownBefore: true }, select: { id: true } }),
  ]);
  const known = new Set(knownBefore.map(c => c.id));
  const firstVisit = new Map<string, Date>();
  for (const g of groups) if (g._min.date) firstVisit.set(g.customerId, g._min.date);
  for (const r of todayRows) {
    if (appointmentInstant(r.date, r.endTime) > now) continue; // not happened yet
    if (!firstVisit.has(r.customerId)) firstVisit.set(r.customerId, r.date);
  }

  // 2) Candidates: first visit inside the widest window, not "known before".
  const candidateIds = Array.from(firstVisit.entries()).filter(([id, d]) => d >= cutoff && !known.has(id)).map(([id]) => id);
  if (!candidateIds.length) {
    return { asOf: now.toISOString(), staffId: opts.staffId ?? null, newSince: since.date, newSinceSource: since.source,
      windows: windows.map(days => ({ days, from: iso(new Date(Math.max(cutoff.getTime(), todayStart.getTime() - days * 86_400_000))), newCustomers: 0, returned: 0, rate: 0, futureBooked: 0, customers: [] })) };
  }

  // 3) Their full visit history (distinct days) + any future booking.
  const [visits, future, people] = await Promise.all([
    prisma.appointment.findMany({
      where: { businessId: opts.businessId, customerId: { in: candidateIds }, status: { in: [...VISIT_STATUSES] }, date: { lt: tomorrowStart }, ...sf },
      select: { customerId: true, date: true, endTime: true },
      orderBy: { date: "asc" },
    }),
    prisma.appointment.findMany({
      where: { businessId: opts.businessId, customerId: { in: candidateIds }, status: { in: ["pending", "confirmed"] }, date: { gte: todayStart }, ...sf },
      select: { customerId: true, date: true, startTime: true },
      orderBy: { date: "asc" },
    }),
    prisma.customer.findMany({ where: { id: { in: candidateIds } }, select: { id: true, name: true, phone: true } }),
  ]);
  const days = new Map<string, Set<string>>();
  for (const v of visits) {
    if (appointmentInstant(v.date, v.endTime) > now) continue;
    (days.get(v.customerId) ?? days.set(v.customerId, new Set()).get(v.customerId)!).add(iso(v.date));
  }
  const nextBooking = new Map<string, string>();
  for (const f of future) {
    if (appointmentInstant(f.date, f.startTime) <= now) continue; // today, already started → counted as a visit above
    if (!nextBooking.has(f.customerId)) nextBooking.set(f.customerId, iso(f.date));
  }
  const nameOf = new Map(people.map(p => [p.id, p]));

  const rows: RetentionCustomer[] = candidateIds.map(id => {
    const ds = Array.from(days.get(id) ?? []).sort();
    const first = ds[0] ?? iso(firstVisit.get(id)!);
    const second = ds[1] ?? null;
    return {
      id, name: nameOf.get(id)?.name ?? "", phone: nameOf.get(id)?.phone ?? "",
      firstVisit: first, secondVisit: second, futureBooking: second ? null : (nextBooking.get(id) ?? null), visits: ds.length,
    };
  }).sort((a, b) => b.firstVisit.localeCompare(a.firstVisit));

  const out: RetentionWindow[] = windows.map(d => {
    const from = iso(new Date(Math.max(cutoff.getTime(), todayStart.getTime() - d * 86_400_000)));
    const customers = rows.filter(r => r.firstVisit >= from);
    const returned = customers.filter(r => r.secondVisit).length;
    return {
      days: d, from, newCustomers: customers.length, returned,
      rate: customers.length ? Math.round((returned / customers.length) * 100) : 0,
      futureBooked: customers.filter(r => !r.secondVisit && r.futureBooking).length,
      customers,
    };
  });
  return { asOf: now.toISOString(), staffId: opts.staffId ?? null, newSince: since.date, newSinceSource: since.source, windows: out };
}
