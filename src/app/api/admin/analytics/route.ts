/**
 * GET /api/admin/analytics
 *
 * Params:
 *   from             YYYY-MM-DD (period start)
 *   to               YYYY-MM-DD (period end)
 *   staffId?         filter to one barber
 *   returnWindowDays rolling cohort window (default 90)
 *
 * Revenue = all non-cancelled appointments (price known at booking time).
 *
 * Definitions:
 *   newCustomer       — first active appointment (at business / at barber) is in the period
 *   prevMonthCohort   — new customers in the previous calendar month; how many came back in [from,to]
 *   activityBreakdown — all-time customers split by visit count: oneTime / active(2+) / regular(3+)
 *   returnRate        — rolling cohort: customers whose first visit was in last N days; % came back
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CANCELLED = new Set(["cancelled_by_customer", "cancelled_by_staff"]);

export async function GET(req: NextRequest) {
  const biz = await prisma.business.findFirst({ select: { id: true } });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });
  const bizId = biz.id;

  const { searchParams } = req.nextUrl;
  const fromStr          = searchParams.get("from") ?? "";
  const toStr            = searchParams.get("to")   ?? "";
  const staffId          = searchParams.get("staffId") || null;
  const returnWindowDays = Math.min(Math.max(parseInt(searchParams.get("returnWindowDays") ?? "90", 10), 7), 365);

  if (!fromStr || !toStr)
    return NextResponse.json({ error: "missing from/to" }, { status: 400 });

  const fromDate = new Date(fromStr + "T00:00:00.000Z");
  const toDate   = new Date(toStr   + "T23:59:59.999Z");
  const sf       = staffId ? { staffId } : {};
  const cancelledArr = Array.from(CANCELLED);

  // Previous calendar month (relative to [from])
  const prevMonthEnd   = new Date(fromDate); prevMonthEnd.setUTCDate(0); prevMonthEnd.setUTCHours(23, 59, 59, 999);
  const prevMonthStart = new Date(prevMonthEnd); prevMonthStart.setUTCDate(1); prevMonthStart.setUTCHours(0, 0, 0, 0);

  // ── 1. Active appointments in period ─────────────────────────────────────────
  const periodAll = await prisma.appointment.findMany({
    where: { businessId: bizId, date: { gte: fromDate, lte: toDate }, ...sf },
    select: {
      id: true, customerId: true, staffId: true, price: true, status: true, date: true,
      customer: { select: { id: true, referralSource: true } },
      staff:    { select: { id: true, name: true } },
    },
  });

  const activeAppts = periodAll.filter(a => !CANCELLED.has(a.status));

  // Revenue = sum of ALL non-cancelled appointments (price is known at booking)
  const totalRevenue      = activeAppts.reduce((s, a) => s + a.price, 0);
  const totalAppointments = activeAppts.length;

  // Unique customers with active appointments
  const periodCustMap = new Map<string, { referralSource: string | null }>();
  for (const a of activeAppts) {
    if (!periodCustMap.has(a.customerId))
      periodCustMap.set(a.customerId, { referralSource: a.customer.referralSource });
  }
  const periodCustIds = Array.from(periodCustMap.keys());
  const periodCustSet = new Set(periodCustIds);

  // Daily revenue chart (from all active)
  const dailyMap = new Map<string, { revenue: number; count: number }>();
  for (const a of activeAppts) {
    const d = new Date(a.date).toISOString().slice(0, 10);
    const v = dailyMap.get(d) ?? { revenue: 0, count: 0 };
    v.revenue += a.price; v.count++;
    dailyMap.set(d, v);
  }
  const dailyRevenue: { date: string; revenue: number; count: number }[] = [];
  for (const cur = new Date(fromDate); cur <= toDate; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const d = cur.toISOString().slice(0, 10);
    dailyRevenue.push({ date: d, ...(dailyMap.get(d) ?? { revenue: 0, count: 0 }) });
  }

  if (periodCustIds.length === 0) {
    return NextResponse.json({
      totalRevenue, totalAppointments,
      newCustomers: 0, newBySource: [],
      prevMonthCohort: { newInPrevMonth: 0, returnedThisMonth: 0, rate: 0 },
      activityBreakdown: { total: 0, oneTime: 0, active: 0, regulars: 0 },
      returnRate: { windowDays: returnWindowDays, cohortSize: 0, returned: 0, rate: 0 },
      dailyRevenue, staffSummary: [],
    });
  }

  // ── 2. All-time history for period customers (to classify new vs returning) ──
  const allHistory = await prisma.appointment.findMany({
    where: { businessId: bizId, status: { notIn: cancelledArr }, customerId: { in: periodCustIds }, ...sf },
    select: { customerId: true, date: true },
  });

  const custDates = new Map<string, Date[]>();
  for (const a of allHistory) {
    const arr = custDates.get(a.customerId) ?? [];
    arr.push(new Date(a.date));
    custDates.set(a.customerId, arr);
  }
  custDates.forEach(arr => arr.sort((a, b) => a.getTime() - b.getTime()));

  // ── 3. Classify: new customer + source ───────────────────────────────────────
  let newCount = 0;
  const newBySrc      = new Map<string, number>();
  const returnedBySrc = new Map<string, number>();

  for (const [custId, { referralSource }] of Array.from(periodCustMap.entries())) {
    const dates = custDates.get(custId) ?? [];
    if (!dates.length) continue;
    const src = referralSource || "ישיר";

    if (dates[0] >= fromDate && dates[0] <= toDate) {
      // New this period
      newCount++;
      newBySrc.set(src, (newBySrc.get(src) ?? 0) + 1);
    } else if (dates[1] && dates[1] >= fromDate && dates[1] <= toDate) {
      // 2nd visit in this period (returning customer)
      returnedBySrc.set(src, (returnedBySrc.get(src) ?? 0) + 1);
    }
  }

  const allSrcs = new Set([...Array.from(newBySrc.keys()), ...Array.from(returnedBySrc.keys())]);
  const newBySource = Array.from(allSrcs)
    .map(src => ({ source: src, new: newBySrc.get(src) ?? 0, returned: returnedBySrc.get(src) ?? 0 }))
    .filter(s => s.new > 0 || s.returned > 0)
    .sort((a, b) => (b.new + b.returned) - (a.new + a.returned));

  // ── 4. Previous month cohort: new last month → how many returned this month ──
  const prevMonthAppts = await prisma.appointment.findMany({
    where: { businessId: bizId, status: { notIn: cancelledArr }, date: { gte: prevMonthStart, lte: prevMonthEnd }, ...sf },
    select: { customerId: true },
  });
  const prevCustIds = Array.from(new Set(prevMonthAppts.map((a: { customerId: string }) => a.customerId)));

  let prevMonthCohort = { newInPrevMonth: 0, returnedThisMonth: 0, rate: 0 };
  if (prevCustIds.length > 0) {
    // Find which of those were new last month (first visit was last month)
    const prevHistory = await prisma.appointment.findMany({
      where: { businessId: bizId, status: { notIn: cancelledArr }, customerId: { in: prevCustIds }, ...sf },
      select: { customerId: true, date: true },
    });
    const prevDates = new Map<string, Date[]>();
    for (const a of prevHistory) {
      const arr = prevDates.get(a.customerId) ?? [];
      arr.push(new Date(a.date));
      prevDates.set(a.customerId, arr);
    }
    prevDates.forEach(arr => arr.sort((a, b) => a.getTime() - b.getTime()));

    const prevNewIds = prevCustIds.filter(id => {
      const dates = prevDates.get(id) ?? [];
      return dates[0] && dates[0] >= prevMonthStart && dates[0] <= prevMonthEnd;
    });
    const returnedCount = prevNewIds.filter(id => periodCustSet.has(id)).length;
    prevMonthCohort = {
      newInPrevMonth:    prevNewIds.length,
      returnedThisMonth: returnedCount,
      rate: prevNewIds.length > 0 ? Math.round((returnedCount / prevNewIds.length) * 100) : 0,
    };
  }

  // ── 5. Activity breakdown — ALL-TIME customer visit counts ──────────────────
  const allTimeGroups = await prisma.appointment.groupBy({
    by: ["customerId"],
    where: { businessId: bizId, status: { notIn: cancelledArr }, ...sf },
    _count: { id: true },
  });
  const activityBreakdown = {
    total:    allTimeGroups.length,
    oneTime:  allTimeGroups.filter(g => g._count.id === 1).length,
    active:   allTimeGroups.filter(g => g._count.id >= 2).length,
    regulars: allTimeGroups.filter(g => g._count.id >= 3).length,
  };

  // ── 6. Rolling return-rate cohort ─────────────────────────────────────────────
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - returnWindowDays);

  const wAppts = await prisma.appointment.findMany({
    where: { businessId: bizId, status: { notIn: cancelledArr }, date: { gte: windowStart }, ...sf },
    select: { customerId: true, date: true },
  });
  const wCustIds = Array.from(new Set(wAppts.map(a => a.customerId)));

  const wHistory = wCustIds.length ? await prisma.appointment.findMany({
    where: { businessId: bizId, status: { notIn: cancelledArr }, customerId: { in: wCustIds }, ...sf },
    select: { customerId: true, date: true },
    orderBy: { date: "asc" },
  }) : [];

  const wDates = new Map<string, Date[]>();
  for (const a of wHistory) {
    const arr = wDates.get(a.customerId) ?? [];
    arr.push(new Date(a.date));
    wDates.set(a.customerId, arr);
  }
  wDates.forEach(arr => arr.sort((a, b) => a.getTime() - b.getTime()));

  let cohortSize = 0, cohortReturned = 0;
  for (const [, dates] of Array.from(wDates.entries())) {
    if (dates[0] >= windowStart) { cohortSize++; if (dates.length >= 2) cohortReturned++; }
  }

  // ── 7. Per-barber summary (only when no staff filter) ─────────────────────
  type StaffRow = { staffId: string; name: string; revenue: number; appointments: number; newCustomers: number; secondVisit: number };
  const staffSummary: StaffRow[] = [];

  if (!staffId) {
    const bySt = new Map<string, { name: string; appts: typeof activeAppts }>();
    for (const a of activeAppts) {
      const v = bySt.get(a.staffId) ?? { name: a.staff.name, appts: [] };
      v.appts.push(a);
      bySt.set(a.staffId, v);
    }
    for (const [sid, { name, appts }] of Array.from(bySt.entries())) {
      const stRev   = appts.reduce((s: number, a: { price: number }) => s + a.price, 0);
      const stCusts = Array.from(new Set(appts.map(a => a.customerId)));
      const stHist  = await prisma.appointment.findMany({
        where: { businessId: bizId, status: { notIn: cancelledArr }, staffId: sid, customerId: { in: stCusts } },
        select: { customerId: true, date: true },
      });
      const stDates = new Map<string, Date[]>();
      for (const a of stHist) {
        const arr = stDates.get(a.customerId) ?? [];
        arr.push(new Date(a.date));
        stDates.set(a.customerId, arr);
      }
      stDates.forEach(arr => arr.sort((a, b) => a.getTime() - b.getTime()));

      let stNew = 0, stSec = 0;
      for (const custId of stCusts) {
        const dates = stDates.get(custId) ?? [];
        if (dates[0] && dates[0] >= fromDate && dates[0] <= toDate) stNew++;
        if (dates[1] && dates[1] >= fromDate && dates[1] <= toDate) stSec++;
      }
      staffSummary.push({ staffId: sid, name, revenue: stRev, appointments: appts.length, newCustomers: stNew, secondVisit: stSec });
    }
    staffSummary.sort((a, b) => b.revenue - a.revenue);
  }

  return NextResponse.json({
    totalRevenue,
    totalAppointments,
    newCustomers: newCount,
    newBySource,
    prevMonthCohort,
    activityBreakdown,
    returnRate: {
      windowDays:  returnWindowDays,
      cohortSize,
      returned:    cohortReturned,
      rate:        cohortSize > 0 ? Math.round((cohortReturned / cohortSize) * 100) : 0,
    },
    dailyRevenue,
    staffSummary,
  });
}
