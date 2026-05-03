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
 *   newToBusiness     — customer's first ever active appointment in the business is in the period
 *   newToStaff        — customer's first ever active appointment WITH the filtered staff is in the period
 *                       (only meaningful when staffId is set; otherwise = newToBusiness)
 *   prevMonthCohort   — new customers in the previous calendar month; how many came back in [from,to]
 *   activityBreakdown — all-time customers split by visit count: oneTime / active(2+) / regular(3+)
 *   returnRate        — rolling cohort: customers whose first visit was in last N days; % came back
 *   today*            — same-day metrics (UTC day, matching how dates are stored)
 *   occupancy*        — % of available staff hours that were booked
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { computeOccupancy } from "@/lib/analytics/occupancy";

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

  // Staff scoping: barbers only see analytics for their own data
  const session = getRequestSession(req);
  const effectiveStaffId = (session && !session.isOwner && session.staffId)
    ? session.staffId
    : staffId;

  if (!fromStr || !toStr)
    return NextResponse.json({ error: "missing from/to" }, { status: 400 });

  const fromDate = new Date(fromStr + "T00:00:00.000Z");
  const toDate   = new Date(toStr   + "T23:59:59.999Z");
  const sf       = effectiveStaffId ? { staffId: effectiveStaffId } : {};
  const cancelledArr = Array.from(CANCELLED);

  // Today range (UTC day — matches how Appointment.date is stored)
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd   = new Date(); todayEnd.setUTCHours(23, 59, 59, 999);
  const last24h    = new Date(Date.now() - 24 * 60 * 60 * 1000);

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

  // ── Today metrics (independent of from/to filter) ────────────────────────────
  const todayAppts = await prisma.appointment.findMany({
    where: {
      businessId: bizId,
      date: { gte: todayStart, lte: todayEnd },
      status: { notIn: cancelledArr },
      ...sf,
    },
    select: { id: true, customerId: true, price: true },
  });
  const todayAppointments = todayAppts.length;
  const todayRevenue = todayAppts.reduce((s, a) => s + a.price, 0);

  // bookingsCreatedToday — appointments BOOKED in last 24h (regardless of when the appt is)
  const bookingsCreatedToday = await prisma.appointment.count({
    where: {
      businessId: bizId,
      createdAt: { gte: last24h },
      status: { notIn: cancelledArr },
      ...sf,
    },
  });

  if (periodCustIds.length === 0) {
    // Even with empty period, return today metrics + occupancy
    const [occToday, occMonth] = await Promise.all([
      computeOccupancy({ businessId: bizId, from: todayStart, to: todayEnd, staffId: effectiveStaffId }),
      computeOccupancy({ businessId: bizId, from: fromDate,   to: toDate,   staffId: effectiveStaffId }),
    ]);
    return NextResponse.json({
      totalRevenue, totalAppointments,
      newCustomers: 0,           // legacy alias
      newToBusiness: 0,
      newToStaff: 0,
      newBySource: [],
      todayAppointments, todayRevenue, todayNewToBusiness: 0, bookingsCreatedToday,
      occupancyToday: occToday.pct, occupancyMonth: occMonth.pct,
      prevMonthCohort: { newInPrevMonth: 0, returnedThisMonth: 0, rate: 0 },
      activityBreakdown: { total: 0, oneTime: 0, active: 0, regulars: 0 },
      returnRate: { windowDays: returnWindowDays, cohortSize: 0, returned: 0, rate: 0 },
      dailyRevenue, staffSummary: [],
    });
  }

  // ── 2. All-time history for period customers ────────────────────────────────
  // We need TWO views per customer:
  //   (a) global  — all appointments across all staff (for newToBusiness)
  //   (b) staff   — only appointments with the filtered staff (for newToStaff)
  // (a) is always loaded; (b) is the same set when no staff filter, otherwise filtered.
  const globalHistory = await prisma.appointment.findMany({
    where: { businessId: bizId, status: { notIn: cancelledArr }, customerId: { in: periodCustIds } },
    select: { customerId: true, staffId: true, date: true },
  });

  const globalDates = new Map<string, Date[]>();   // customer → ALL their dates
  const staffDates  = new Map<string, Date[]>();   // customer → dates with effectiveStaffId only
  for (const a of globalHistory) {
    const d = new Date(a.date);
    const ga = globalDates.get(a.customerId) ?? [];
    ga.push(d);
    globalDates.set(a.customerId, ga);

    if (!effectiveStaffId || a.staffId === effectiveStaffId) {
      const sa = staffDates.get(a.customerId) ?? [];
      sa.push(d);
      staffDates.set(a.customerId, sa);
    }
  }
  globalDates.forEach(arr => arr.sort((a, b) => a.getTime() - b.getTime()));
  staffDates.forEach(arr  => arr.sort((a, b) => a.getTime() - b.getTime()));

  // ── 3. Classify: new customer + source ───────────────────────────────────────
  let newToBusiness = 0;
  let newToStaff = 0;
  const newBySrc      = new Map<string, number>();
  const returnedBySrc = new Map<string, number>();

  for (const [custId, { referralSource }] of Array.from(periodCustMap.entries())) {
    const gDates = globalDates.get(custId) ?? [];
    const sDates = staffDates.get(custId) ?? [];
    const src = referralSource || "לא צוין";

    const isNewToBusiness = gDates[0] && gDates[0] >= fromDate && gDates[0] <= toDate;
    const isNewToStaff    = sDates[0] && sDates[0] >= fromDate && sDates[0] <= toDate;

    if (isNewToBusiness) newToBusiness++;
    if (isNewToStaff)    newToStaff++;

    // Source breakdown follows the staff-scoped definition (matches existing UI semantics)
    if (isNewToStaff) {
      newBySrc.set(src, (newBySrc.get(src) ?? 0) + 1);
    } else {
      returnedBySrc.set(src, (returnedBySrc.get(src) ?? 0) + 1);
    }
  }

  // todayNewToBusiness — of today's customers, how many are new to the business overall
  const todayCustIds = Array.from(new Set(todayAppts.map(a => a.customerId)));
  let todayNewToBusiness = 0;
  if (todayCustIds.length > 0) {
    const todayHistory = await prisma.appointment.findMany({
      where: { businessId: bizId, status: { notIn: cancelledArr }, customerId: { in: todayCustIds } },
      select: { customerId: true, date: true },
    });
    const tDates = new Map<string, Date[]>();
    for (const a of todayHistory) {
      const arr = tDates.get(a.customerId) ?? [];
      arr.push(new Date(a.date));
      tDates.set(a.customerId, arr);
    }
    tDates.forEach(arr => arr.sort((a, b) => a.getTime() - b.getTime()));
    for (const cid of todayCustIds) {
      const d0 = tDates.get(cid)?.[0];
      if (d0 && d0 >= todayStart && d0 <= todayEnd) todayNewToBusiness++;
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
  type StaffRow = {
    staffId: string; name: string;
    revenue: number; appointments: number;
    newToStaff: number;          // customer's first visit WITH this staff is in period
    newAlsoToBusiness: number;   // of newToStaff, also customer's first visit ANYWHERE is in period
    secondVisit: number;
  };
  const staffSummary: StaffRow[] = [];

  if (!effectiveStaffId) {
    const bySt = new Map<string, { name: string; appts: typeof activeAppts }>();
    for (const a of activeAppts) {
      const v = bySt.get(a.staffId) ?? { name: a.staff.name, appts: [] };
      v.appts.push(a);
      bySt.set(a.staffId, v);
    }
    for (const [sid, { name, appts }] of Array.from(bySt.entries())) {
      const stRev   = appts.reduce((s: number, a: { price: number }) => s + a.price, 0);
      const stCusts = Array.from(new Set(appts.map(a => a.customerId)));

      // Per-staff history (with this staff only) for newToStaff + secondVisit
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

      // Global history for these same customers, to compute newAlsoToBusiness
      const stGlobalHist = await prisma.appointment.findMany({
        where: { businessId: bizId, status: { notIn: cancelledArr }, customerId: { in: stCusts } },
        select: { customerId: true, date: true },
      });
      const stGlobalDates = new Map<string, Date[]>();
      for (const a of stGlobalHist) {
        const arr = stGlobalDates.get(a.customerId) ?? [];
        arr.push(new Date(a.date));
        stGlobalDates.set(a.customerId, arr);
      }
      stGlobalDates.forEach(arr => arr.sort((a, b) => a.getTime() - b.getTime()));

      let stNew = 0, stSec = 0, stNewAlsoBiz = 0;
      for (const custId of stCusts) {
        const dates = stDates.get(custId) ?? [];
        const gDates = stGlobalDates.get(custId) ?? [];
        if (dates[0] && dates[0] >= fromDate && dates[0] <= toDate) {
          stNew++;
          if (gDates[0] && gDates[0] >= fromDate && gDates[0] <= toDate) stNewAlsoBiz++;
        }
        if (dates[1] && dates[1] >= fromDate && dates[1] <= toDate) stSec++;
      }
      staffSummary.push({
        staffId: sid, name,
        revenue: stRev, appointments: appts.length,
        newToStaff: stNew, newAlsoToBusiness: stNewAlsoBiz,
        secondVisit: stSec,
      });
    }
    staffSummary.sort((a, b) => b.revenue - a.revenue);
  }

  // ── 8. Occupancy (today + period) ────────────────────────────────────────────
  const [occToday, occMonth] = await Promise.all([
    computeOccupancy({ businessId: bizId, from: todayStart, to: todayEnd, staffId: effectiveStaffId }),
    computeOccupancy({ businessId: bizId, from: fromDate,   to: toDate,   staffId: effectiveStaffId }),
  ]);

  return NextResponse.json({
    totalRevenue,
    totalAppointments,
    // Legacy alias — kept so older clients don't break. Prefer newToBusiness/newToStaff.
    newCustomers: effectiveStaffId ? newToStaff : newToBusiness,
    newToBusiness,
    newToStaff,
    newBySource,
    // Today metrics
    todayAppointments,
    todayRevenue,
    todayNewToBusiness,
    bookingsCreatedToday,
    occupancyToday: occToday.pct,
    occupancyMonth: occMonth.pct,
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
