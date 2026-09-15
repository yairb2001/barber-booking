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
import { getRequestSession, getSessionBusiness } from "@/lib/session";
import { computeOccupancy } from "@/lib/analytics/occupancy";
import { appointmentInstant } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CANCELLED = new Set(["cancelled_by_customer", "cancelled_by_staff"]);

const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני",
                   "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

// Sunday→Saturday week window, `offsetWeeks` from the base date (0 = current week).
// Mirrors the barber-stats helper so owner + barber weekly numbers line up.
function getWeekRangeUTC(offsetWeeks: number, base: Date) {
  const day = base.getUTCDay(); // 0=Sunday
  const sunday = new Date(base);
  sunday.setUTCDate(base.getUTCDate() - day + offsetWeeks * 7);
  sunday.setUTCHours(0, 0, 0, 0);
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  saturday.setUTCHours(23, 59, 59, 999);
  return { start: sunday, end: saturday };
}

function weekLabelHe(start: Date, end: Date) {
  const sM = start.getUTCMonth(), eM = end.getUTCMonth();
  const sD = start.getUTCDate(),  eD = end.getUTCDate();
  return sM === eM
    ? `${sD}–${eD} ${MONTHS_HE[sM]}`
    : `${sD} ${MONTHS_HE[sM]}–${eD} ${MONTHS_HE[eM]}`;
}

export async function GET(req: NextRequest) {
  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });
  const bizId = biz.id;
  // Regulars from before this system (owner marked "known before") are never "new" in any cohort.
  const knownBeforeIds = new Set((await prisma.customer.findMany({ where: { businessId: bizId, knownBefore: true }, select: { id: true } })).map(c => c.id));

  const { searchParams } = req.nextUrl;
  const fromStr          = searchParams.get("from") ?? "";
  const toStr            = searchParams.get("to")   ?? "";
  const staffId          = searchParams.get("staffId") || null;
  const returnWindowDays = Math.min(Math.max(parseInt(searchParams.get("returnWindowDays") ?? "90", 10), 7), 365);
  const minVisits        = Math.min(Math.max(parseInt(searchParams.get("minVisits") ?? "2", 10), 2), 20);
  // includeFuture (default true): when false, the period metrics ignore
  // appointments that haven't happened yet — i.e. "data up to this moment".
  const includeFuture    = (searchParams.get("includeFuture") ?? "true") !== "false";
  // date (optional, YYYY-MM-DD): which day the "⚡ [date]" snapshot section
  // covers. Defaults to the real today. Independent of from/to (the month
  // picker) — lets the owner browse the snapshot back through past days.
  const dateStr           = searchParams.get("date") || "";

  // Staff scoping: barbers only see analytics for their own data
  const session = getRequestSession(req);
  const effectiveStaffId = (session && !session.isOwner && session.staffId)
    ? session.staffId
    : staffId;

  if (!fromStr || !toStr)
    return NextResponse.json({ error: "missing from/to" }, { status: 400 });

  const fromDate = new Date(fromStr + "T00:00:00.000Z");
  const toDate   = new Date(toStr   + "T23:59:59.999Z");
  const now      = new Date();
  // Period end for occupancy: capped to "now" when the future toggle is off.
  const occTo    = includeFuture ? toDate : new Date(Math.min(toDate.getTime(), now.getTime()));
  const sf       = effectiveStaffId ? { staffId: effectiveStaffId } : {};
  const cancelledArr = Array.from(CANCELLED);

  // Today range (UTC day — matches how Appointment.date is stored). Clamped to
  // [today-30, today] so the snapshot can't be pointed at the future or wander
  // arbitrarily far into the past.
  const realTodayStart = new Date(); realTodayStart.setUTCHours(0, 0, 0, 0);
  const minTodayStart = new Date(realTodayStart); minTodayStart.setUTCDate(minTodayStart.getUTCDate() - 30);
  const parsedDate = dateStr ? new Date(dateStr + "T00:00:00.000Z") : null;
  const todayStart = (parsedDate && !isNaN(parsedDate.getTime()) && parsedDate <= realTodayStart && parsedDate >= minTodayStart)
    ? parsedDate
    : realTodayStart;
  const todayEnd = new Date(todayStart); todayEnd.setUTCHours(23, 59, 59, 999);

  // Previous calendar month (relative to [from])
  const prevMonthEnd   = new Date(fromDate); prevMonthEnd.setUTCDate(0); prevMonthEnd.setUTCHours(23, 59, 59, 999);
  const prevMonthStart = new Date(prevMonthEnd); prevMonthStart.setUTCDate(1); prevMonthStart.setUTCHours(0, 0, 0, 0);

  // ── 1. Active appointments in period ─────────────────────────────────────────
  const periodAll = await prisma.appointment.findMany({
    where: { businessId: bizId, date: { gte: fromDate, lte: toDate }, ...sf },
    select: {
      id: true, customerId: true, staffId: true, price: true, status: true, date: true,
      startTime: true, serviceId: true, cancelledAt: true,
      customer: { select: { id: true, referralSource: true, name: true, knownBefore: true } },
      staff:    { select: { id: true, name: true } },
      service:  { select: { id: true, name: true } },
    },
  });

  // Every display metric below derives from activeAppts. When the future toggle
  // is OFF we drop appointments whose real datetime is still ahead of now, so the
  // numbers reflect only what has actually happened up to this moment.
  const activeAppts = periodAll
    .filter(a => !CANCELLED.has(a.status))
    .filter(a => includeFuture || appointmentInstant(a.date, a.startTime).getTime() <= now.getTime());

  // Revenue = sum of ALL non-cancelled appointments (price is known at booking)
  const totalRevenue      = activeAppts.reduce((s, a) => s + a.price, 0);
  const totalAppointments = activeAppts.length;

  // No-shows within the selected period (respects the month picker + staff
  // filter) — separate from `totalNoShows` below, which is all-time.
  const periodNoShows = periodAll.filter(a => a.status === "no_show").length;

  // ── Cancellations — the metric that was missing ────────────────────────────
  // Rate over everything booked in the period, split by who cancelled, by
  // barber, by weekday, "late" (cancelledAt within 24h of the slot) and the
  // customers who cancel most. Money lost = late cancellations × price.
  const cancelled = periodAll.filter(a => CANCELLED.has(a.status) && a.status !== "no_show");
  const byStaffCancel = new Map<string, { name: string; cancelled: number; total: number }>();
  const byWeekday = Array.from({ length: 7 }, () => ({ cancelled: 0, total: 0 }));
  const byCustomer = new Map<string, { name: string; count: number }>();
  let lateCount = 0, lateRevenue = 0;
  for (const a of periodAll) {
    const st = byStaffCancel.get(a.staffId) || { name: a.staff.name, cancelled: 0, total: 0 };
    st.total++;
    const wd = new Date(a.date).getUTCDay();
    byWeekday[wd].total++;
    if (CANCELLED.has(a.status) && a.status !== "no_show") {
      st.cancelled++;
      byWeekday[wd].cancelled++;
      const c = byCustomer.get(a.customerId) || { name: a.customer.name, count: 0 };
      c.count++; byCustomer.set(a.customerId, c);
      if (a.cancelledAt && appointmentInstant(a.date, a.startTime).getTime() - a.cancelledAt.getTime() < 24 * 3_600_000) {
        lateCount++; lateRevenue += a.price;
      }
    }
    byStaffCancel.set(a.staffId, st);
  }
  // ── "הגיע הזמן לתור" — split into regulars (2+ visits at send time) and
  // new customers (single visit → kind rhythm_nudge_new). Per customer, not per
  // message: a regular may get two messages. "Booked" = an appointment created
  // within 3 days of a message (any source), cancelled ones excluded.
  const nudgeLogs = await prisma.messageLog.findMany({
    where: { businessId: bizId, kind: { in: ["rhythm_nudge", "rhythm_nudge_2", "rhythm_nudge_new"] }, createdAt: { gte: fromDate, lte: toDate }, status: { not: "failed" } },
    select: { customerPhone: true, createdAt: true, kind: true },
    orderBy: { createdAt: "asc" },
  });
  type NudgeGroup = {
    customers: number; messages: number; booked: number; rate: number;
    by: { self: number; agent: number; admin: number }; avgHoursToBook: number | null; revenue: number;
    repliedNoBook: number;
    afterFirst?: number; afterSecond?: number;   // regulars
    bookedLater?: number; secondVisit?: number;  // new customers
  };
  const emptyGroup = (): NudgeGroup => ({ customers: 0, messages: 0, booked: 0, rate: 0, by: { self: 0, agent: 0, admin: 0 }, avgHoursToBook: null, revenue: 0, repliedNoBook: 0 });
  const nudgeRegular = { ...emptyGroup(), afterFirst: 0, afterSecond: 0 };
  const nudgeNew = { ...emptyGroup(), bookedLater: 0, secondVisit: 0 };
  const hoursOf = { regular: [] as number[], new: [] as number[] };
  if (nudgeLogs.length) {
    const norm = (p: string) => p.replace(/\D/g, "").replace(/^0/, "972");
    const H3D = 3 * 86_400_000, H30D = 30 * 86_400_000;
    const phones = Array.from(new Set(nudgeLogs.map(l => norm(l.customerPhone))));
    const variants = phones.flatMap(p => [p, "0" + p.slice(3)]);
    const [custs, convs] = await Promise.all([
      prisma.customer.findMany({ where: { businessId: bizId, phone: { in: variants } }, select: { id: true, phone: true } }),
      prisma.conversation.findMany({ where: { businessId: bizId, phone: { in: variants } }, select: { id: true, phone: true } }),
    ]);
    const idByPhone = new Map(custs.map(c => [norm(c.phone), c.id]));
    const convByPhone = new Map(convs.map(c => [norm(c.phone), c.id]));
    const [created, inbound] = await Promise.all([
      prisma.appointment.findMany({
        where: { businessId: bizId, customerId: { in: custs.map(c => c.id) }, createdAt: { gte: fromDate, lte: new Date(toDate.getTime() + H30D) }, status: { in: ["pending", "confirmed", "completed"] } },
        select: { customerId: true, createdAt: true, source: true, price: true, status: true },
      }),
      convs.length ? prisma.conversationMessage.findMany({
        where: { conversationId: { in: convs.map(c => c.id) }, role: "user", createdAt: { gte: fromDate, lte: new Date(toDate.getTime() + H3D) } },
        select: { conversationId: true, createdAt: true },
      }) : Promise.resolve([] as { conversationId: string; createdAt: Date }[]),
    ]);
    // Group messages per customer; the customer's group is decided by the kind of their first message.
    const perCustomer = new Map<string, { phone: string; logs: typeof nudgeLogs }>();
    for (const l of nudgeLogs) {
      const cid = idByPhone.get(norm(l.customerPhone)); if (!cid) continue;
      const e = perCustomer.get(cid) || { phone: norm(l.customerPhone), logs: [] }; e.logs.push(l); perCustomer.set(cid, e);
    }
    for (const [cid, { phone, logs }] of Array.from(perCustomer.entries())) {
      const isNew = logs[0].kind === "rhythm_nudge_new";
      const g = isNew ? nudgeNew : nudgeRegular;
      g.customers++; g.messages += logs.length;
      const first = logs[0].createdAt;
      const mine = created.filter(a => a.customerId === cid && a.createdAt >= first).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      // Booked within 3 days of ANY of their messages → attributed to the last message before the booking.
      let hit: typeof mine[number] | null = null, afterMsg: typeof logs[number] | null = null;
      for (const a of mine) {
        const m = [...logs].reverse().find(l => a.createdAt >= l.createdAt && a.createdAt.getTime() - l.createdAt.getTime() <= H3D);
        if (m) { hit = a; afterMsg = m; break; }
      }
      if (hit && afterMsg) {
        g.booked++; g.revenue += hit.price;
        if (hit.source === "agent") g.by.agent++; else if (hit.source === "admin" || hit.source === "recurring") g.by.admin++; else g.by.self++;
        (isNew ? hoursOf.new : hoursOf.regular).push((hit.createdAt.getTime() - afterMsg.createdAt.getTime()) / 3_600_000);
        if (!isNew) { if (afterMsg.kind === "rhythm_nudge_2") nudgeRegular.afterSecond++; else nudgeRegular.afterFirst++; }
      } else {
        const convId = convByPhone.get(phone);
        const replied = !!convId && inbound.some(m => m.conversationId === convId && logs.some(l => m.createdAt >= l.createdAt && m.createdAt.getTime() - l.createdAt.getTime() <= H3D));
        if (replied) g.repliedNoBook++;
        if (isNew && mine.some(a => a.createdAt.getTime() - first.getTime() <= H30D)) nudgeNew.bookedLater++;
      }
      if (isNew && mine.some(a => a.status === "completed")) nudgeNew.secondVisit++;
    }
    for (const g of [nudgeRegular, nudgeNew]) g.rate = g.customers ? Math.round((g.booked / g.customers) * 100) : 0;
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, h) => s + h, 0) / xs.length) : null);
    nudgeRegular.avgHoursToBook = avg(hoursOf.regular); nudgeNew.avgHoursToBook = avg(hoursOf.new);
    nudgeRegular.revenue = Math.round(nudgeRegular.revenue); nudgeNew.revenue = Math.round(nudgeNew.revenue);
  }
  const rhythmNudge = {
    // Legacy totals (kept for anything still reading them)
    sent: nudgeLogs.length, booked: nudgeRegular.booked + nudgeNew.booked,
    rate: nudgeLogs.length ? Math.round(((nudgeRegular.booked + nudgeNew.booked) / (nudgeRegular.customers + nudgeNew.customers || 1)) * 100) : 0,
    by: { self: nudgeRegular.by.self + nudgeNew.by.self, agent: nudgeRegular.by.agent + nudgeNew.by.agent, admin: nudgeRegular.by.admin + nudgeNew.by.admin },
    avgHoursToBook: null as number | null,
    regular: nudgeRegular, new: nudgeNew,
  };

  const cancellations = {
    total: cancelled.length,
    booked: periodAll.length,
    rate: periodAll.length ? Math.round((cancelled.length / periodAll.length) * 100) : 0,
    byCustomerCount: cancelled.filter(a => a.status === "cancelled_by_customer").length,
    byStaffCount: cancelled.filter(a => a.status === "cancelled_by_staff").length,
    late: lateCount,
    lateRevenue: Math.round(lateRevenue),
    byStaff: Array.from(byStaffCancel.entries()).map(([staffId, v]) => ({ staffId, ...v, rate: v.total ? Math.round((v.cancelled / v.total) * 100) : 0 })).sort((x, y) => y.rate - x.rate),
    byWeekday: byWeekday.map((v, i) => ({ weekday: i, ...v, rate: v.total ? Math.round((v.cancelled / v.total) * 100) : 0 })),
    topCancellers: Array.from(byCustomer.entries()).map(([customerId, v]) => ({ customerId, ...v })).filter(x => x.count >= 2).sort((x, y) => y.count - x.count).slice(0, 8),
  };

  // ── Service breakdown (for the pie chart): appointments per service in period ──
  const svcMap = new Map<string, { name: string; count: number; revenue: number }>();
  for (const a of activeAppts) {
    const key = a.serviceId;
    const v = svcMap.get(key) ?? { name: a.service?.name ?? "ללא שירות", count: 0, revenue: 0 };
    v.count++; v.revenue += a.price;
    svcMap.set(key, v);
  }
  const serviceBreakdown = Array.from(svcMap.entries())
    .map(([serviceId, v]) => ({ serviceId, name: v.name, count: v.count, revenue: v.revenue }))
    .sort((a, b) => b.count - a.count);

  // ── Product sales breakdown ──────────────────────────────────────────────────
  // Which products sold + how many units, in the period, respecting the staff
  // scope. INTENTIONALLY separate from totalRevenue — this is a standalone data
  // point (see ProductSale model) and is never folded into turnover figures.
  const productSaleRows = await prisma.productSale.findMany({
    where: {
      businessId: bizId,
      ...(effectiveStaffId ? { staffId: effectiveStaffId } : {}),
      appointment: { date: { gte: fromDate, lte: toDate } },
    },
    select: { productId: true, quantity: true, unitPrice: true, product: { select: { name: true } } },
  });
  const prodMap = new Map<string, { name: string; units: number; total: number }>();
  for (const s of productSaleRows) {
    const v = prodMap.get(s.productId) ?? { name: s.product.name, units: 0, total: 0 };
    v.units += s.quantity;
    v.total += s.quantity * s.unitPrice;
    prodMap.set(s.productId, v);
  }
  const productSales = Array.from(prodMap.entries())
    .map(([productId, v]) => ({ productId, name: v.name, units: v.units, total: v.total }))
    .sort((a, b) => b.units - a.units);
  const productSalesTotals = {
    units:   productSales.reduce((s, p) => s + p.units, 0),
    revenue: productSales.reduce((s, p) => s + p.total, 0),
  };

  // Unique customers with active appointments
  const periodCustMap = new Map<string, { referralSource: string | null; knownBefore: boolean }>();
  for (const a of activeAppts) {
    if (!periodCustMap.has(a.customerId))
      periodCustMap.set(a.customerId, { referralSource: a.customer.referralSource, knownBefore: !!a.customer.knownBefore });
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

  // bookingsCreatedToday — appointments BOOKED today (full calendar day, midnight→midnight),
  // regardless of when the appt itself is. Includes barber-created entries (no source filter).
  const bookingsCreatedToday = await prisma.appointment.count({
    where: {
      businessId: bizId,
      createdAt: { gte: todayStart, lte: todayEnd },
      status: { notIn: cancelledArr },
      ...sf,
    },
  });

  // totalNoShows — all-time count, NOT date-scoped (unlike the metrics above).
  // Powers the "🚫 הברזות" dashboard card + drill-down list of repeat no-shows.
  const totalNoShows = await prisma.appointment.count({
    where: { businessId: bizId, status: "no_show", ...sf },
  });

  // ── Weekly summary (this week, last week, 12-week trend) ────────────────────
  // Anchored to "now" (not the month picker) and scoped by the active staff
  // filter — powers the weekly section at the bottom of the owner dashboard.
  // Computed BEFORE the empty-period early return so it's accurate even when the
  // selected month has no appointments. Week base is Israel-shifted for Sun–Sat.
  const weekBase = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const weekRanges = Array.from({ length: 12 }, (_, i) => getWeekRangeUTC(i - 11, weekBase));
  const weekAppts = await prisma.appointment.findMany({
    where: {
      businessId: bizId,
      status: { notIn: cancelledArr },
      date: { gte: weekRanges[0].start, lte: weekRanges[11].end },
      ...sf,
    },
    select: { date: true, price: true },
  });
  const sumWeek = (s: Date, e: Date) => {
    const ap = weekAppts.filter(a => a.date >= s && a.date <= e);
    return { appointments: ap.length, revenue: ap.reduce((x, a) => x + a.price, 0) };
  };
  const weekly = {
    thisWeek: sumWeek(weekRanges[11].start, weekRanges[11].end),
    lastWeek: sumWeek(weekRanges[10].start, weekRanges[10].end),
    history: weekRanges.map(w => ({ weekLabel: weekLabelHe(w.start, w.end), ...sumWeek(w.start, w.end) })),
  };

  if (periodCustIds.length === 0) {
    // Even with empty period, return today metrics + occupancy
    const [occToday, occMonth] = await Promise.all([
      computeOccupancy({ businessId: bizId, from: todayStart, to: todayEnd, staffId: effectiveStaffId }),
      computeOccupancy({ businessId: bizId, from: fromDate,   to: occTo,    staffId: effectiveStaffId }),
    ]);
    return NextResponse.json({
      totalRevenue, totalAppointments, periodNoShows, cancellations, rhythmNudge,
      uniqueCustomers: 0,
      weekly,
      newCustomers: 0,           // legacy alias
      newToBusiness: 0,
      newToStaff: 0,
      newBySource: [],
      todayAppointments, todayRevenue, todayNewToBusiness: 0, bookingsCreatedToday, totalNoShows,
      todayDate: todayStart.toISOString().slice(0, 10),
      occupancyToday: occToday.pct, occupancyMonth: occMonth.pct,
      prevMonthCohort: { newInPrevMonth: 0, returnedThisMonth: 0, rate: 0 },
      activityBreakdown: { total: 0, oneTime: 0, active: 0, regulars: 0 },
      returnRate: { windowDays: returnWindowDays, cohortSize: 0, returned: 0, rate: 0 },
      dailyRevenue, staffSummary: [],
      serviceBreakdown, staffUniqueCustomers: [],
      productSales, productSalesTotals,
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

  for (const [custId, { referralSource, knownBefore }] of Array.from(periodCustMap.entries())) {
    const gDates = globalDates.get(custId) ?? [];
    const sDates = staffDates.get(custId) ?? [];
    const src = referralSource || "לא צוין";

    const isNewToBusiness = !knownBefore && gDates[0] && gDates[0] >= fromDate && gDates[0] <= toDate;
    const isNewToStaff    = !knownBefore && sDates[0] && sDates[0] >= fromDate && sDates[0] <= toDate;

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
      if (knownBeforeIds.has(id)) return false;
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
  for (const [id, dates] of Array.from(wDates.entries())) {
    if (knownBeforeIds.has(id)) continue;
    if (dates[0] >= windowStart) { cohortSize++; if (dates.length >= minVisits) cohortReturned++; }
  }

  // ── 7. Per-barber summary (only when no staff filter) ─────────────────────
  type StaffRow = {
    staffId: string; name: string;
    revenue: number; appointments: number; uniqueCustomers: number;
    newToStaff: number;          // customer's first visit WITH this staff is in period
    newAlsoToBusiness: number;   // of newToStaff, also customer's first visit ANYWHERE is in period
    secondVisit: number;
    secondVisitRate: { cohortSize: number; returned: number; rate: number };
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

      const barberWindowStart = new Date();
      barberWindowStart.setDate(barberWindowStart.getDate() - returnWindowDays);

      let stNew = 0, stSec = 0, stNewAlsoBiz = 0;
      let barberCohortSize = 0, barberCohortReturned = 0;
      for (const custId of stCusts) {
        const dates = stDates.get(custId) ?? [];
        const gDates = stGlobalDates.get(custId) ?? [];
        if (dates[0] && dates[0] >= fromDate && dates[0] <= toDate) {
          stNew++;
          if (gDates[0] && gDates[0] >= fromDate && gDates[0] <= toDate) stNewAlsoBiz++;
        }
        if (dates[1] && dates[1] >= fromDate && dates[1] <= toDate) stSec++;
        // Rolling second-visit cohort: first visit with this barber within the window
        if (dates[0] && dates[0] >= barberWindowStart) {
          barberCohortSize++;
          if (dates.length >= minVisits) barberCohortReturned++;
        }
      }
      staffSummary.push({
        staffId: sid, name,
        revenue: stRev, appointments: appts.length, uniqueCustomers: stCusts.length,
        newToStaff: stNew, newAlsoToBusiness: stNewAlsoBiz,
        secondVisit: stSec,
        secondVisitRate: {
          cohortSize: barberCohortSize,
          returned:   barberCohortReturned,
          rate: barberCohortSize > 0 ? Math.round((barberCohortReturned / barberCohortSize) * 100) : 0,
        },
      });
    }
    staffSummary.sort((a, b) => b.revenue - a.revenue);
  }

  // ── 8. Occupancy (today + period) ────────────────────────────────────────────
  const [occToday, occMonth] = await Promise.all([
    computeOccupancy({ businessId: bizId, from: todayStart, to: todayEnd, staffId: effectiveStaffId }),
    computeOccupancy({ businessId: bizId, from: fromDate,   to: occTo,    staffId: effectiveStaffId }),
  ]);

  // ── 9. Deep data — all-time unique customers per staff (owner view only) ──────
  // A customer served by multiple staff is counted once for EACH staff (overlap OK).
  // Includes departed (isActive:false) staff so their history isn't lost.
  type StaffUnique = { staffId: string; name: string; isActive: boolean; uniqueCustomers: number };
  let staffUniqueCustomers: StaffUnique[] = [];
  if (!effectiveStaffId) {
    const pairs = await prisma.appointment.groupBy({
      by: ["staffId", "customerId"],
      where: { businessId: bizId, status: { notIn: cancelledArr } },
    });
    const countByStaff = new Map<string, number>();
    for (const p of pairs) countByStaff.set(p.staffId, (countByStaff.get(p.staffId) ?? 0) + 1);

    const allStaff = await prisma.staff.findMany({
      where: { businessId: bizId },
      select: { id: true, name: true, isActive: true },
    });
    const nameById = new Map(allStaff.map(s => [s.id, s]));
    staffUniqueCustomers = Array.from(countByStaff.entries())
      .map(([staffId, uniqueCustomers]) => {
        const s = nameById.get(staffId);
        return { staffId, name: s?.name ?? "—", isActive: s?.isActive ?? true, uniqueCustomers };
      })
      .sort((a, b) => b.uniqueCustomers - a.uniqueCustomers);
  }

  return NextResponse.json({
    totalRevenue,
    totalAppointments,
    periodNoShows,
    cancellations,
    rhythmNudge,
    // Unique customers served in the period (respects staff filter via sf)
    uniqueCustomers: periodCustIds.length,
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
    totalNoShows,
    todayDate: todayStart.toISOString().slice(0, 10),
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
    serviceBreakdown,
    staffUniqueCustomers,
    productSales,
    productSalesTotals,
    weekly,
  });
}
