/**
 * WhatsApp report generators for managers + staff.
 *
 * Five generators:
 *   buildDailyReport(bizId)               — sent to manager 22:00 IST Sun-Fri
 *   buildWeeklyReportManager(bizId)       — sent to manager Sun morning
 *   buildWeeklyReportStaff(bizId, sid)    — sent to each barber Sun morning
 *   buildMonthlyReportManager(bizId)      — sent to manager 1st of month
 *   buildMonthlyReportStaff(bizId, sid)   — sent to each barber 1st of month
 *
 * All output is plain text (WhatsApp-friendly): emojis, line breaks, no HTML.
 */

import { prisma } from "@/lib/prisma";
import { computeOccupancy } from "@/lib/analytics/occupancy";

const CANCELLED = ["cancelled_by_customer", "cancelled_by_staff"];
const DAY_NAMES_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const MONTH_NAMES_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

// ── Time helpers (UTC-day, matching how appt.date is stored) ────────────────

function todayRange(): { start: Date; end: Date } {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const end   = new Date(); end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}
function tomorrowRange(): { start: Date; end: Date } {
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 1); start.setUTCHours(0, 0, 0, 0);
  const end   = new Date(start); end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}
function lastNDaysRange(days: number): { start: Date; end: Date } {
  const end = new Date(); end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - (days - 1)); start.setUTCHours(0, 0, 0, 0);
  return { start, end };
}
function previousNDaysRange(days: number, offsetDays: number): { start: Date; end: Date } {
  const end   = new Date(); end.setUTCDate(end.getUTCDate() - offsetDays); end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - (days - 1)); start.setUTCHours(0, 0, 0, 0);
  return { start, end };
}
function lastCalendarMonthRange(): { start: Date; end: Date; monthLabel: string } {
  const now = new Date();
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999)); // last day of prev month
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 0, 0, 0, 0));
  return { start, end, monthLabel: `${MONTH_NAMES_HE[end.getUTCMonth()]} ${end.getUTCFullYear()}` };
}
function nMonthsAgoRange(monthsAgo: number): { start: Date; end: Date } {
  const now = new Date();
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsAgo - 1), 0, 23, 59, 59, 999));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1, 0, 0, 0, 0));
  return { start, end };
}

function fmtMoney(n: number): string {
  return `₪${Math.round(n).toLocaleString("he-IL")}`;
}
function fmtTrend(curr: number, prev: number): string {
  if (prev === 0) {
    if (curr === 0) return "—";
    return "▲ חדש";
  }
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return "≡ ללא שינוי";
  if (pct > 0)   return `▲ ${pct}%`;
  return `▼ ${Math.abs(pct)}%`;
}
function fmtDateHe(d: Date): string {
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric" });
}

// ── Period stats — common building block ────────────────────────────────────

type StaffStat = {
  staffId: string;
  name: string;
  appointments: number;
  revenue: number;
  newToStaff: number;       // first-ever visit WITH this staff in period
  newAlsoToBusiness: number; // first-ever visit ANYWHERE also in period
};

type PeriodStats = {
  appointments: number;       // active (non-cancelled) appointments in period
  revenue: number;
  uniqueCustomers: number;
  newToBusiness: number;      // customers whose first-ever visit anywhere is in period
  noShows: number;
  cancellationsSameDay: number; // cancelled today (or in period) for same-day appts
  perStaff: StaffStat[];
};

async function computePeriodStats(bizId: string, start: Date, end: Date): Promise<PeriodStats> {
  // All appts (incl. cancelled) in the period — needed to count cancellations
  const all = await prisma.appointment.findMany({
    where: { businessId: bizId, date: { gte: start, lte: end } },
    select: {
      id: true, customerId: true, staffId: true, price: true, status: true,
      staff: { select: { id: true, name: true } },
    },
  });
  const active = all.filter(a => !CANCELLED.includes(a.status));
  const noShows = all.filter(a => a.status === "no_show").length;
  const cancellationsSameDay = all.filter(a => CANCELLED.includes(a.status)).length;

  const revenue = active.reduce((s, a) => s + a.price, 0);
  const customerIds = Array.from(new Set(active.map(a => a.customerId)));

  // Global history for these customers (no staff filter) — to detect newToBusiness
  let newToBusiness = 0;
  const firstEverByCust = new Map<string, Date>();
  if (customerIds.length > 0) {
    const history = await prisma.appointment.findMany({
      where: { businessId: bizId, status: { notIn: CANCELLED }, customerId: { in: customerIds } },
      select: { customerId: true, date: true },
    });
    for (const h of history) {
      const d = new Date(h.date);
      const cur = firstEverByCust.get(h.customerId);
      if (!cur || d < cur) firstEverByCust.set(h.customerId, d);
    }
    for (const cid of customerIds) {
      const first = firstEverByCust.get(cid);
      if (first && first >= start && first <= end) newToBusiness++;
    }
  }

  // Per-staff aggregation
  type Bucket = { name: string; appts: typeof active; customerIds: Set<string> };
  const byStaff = new Map<string, Bucket>();
  for (const a of active) {
    const cur = byStaff.get(a.staffId) ?? { name: a.staff.name, appts: [], customerIds: new Set<string>() };
    cur.appts.push(a);
    cur.customerIds.add(a.customerId);
    byStaff.set(a.staffId, cur);
  }

  const perStaff: StaffStat[] = [];
  for (const [sid, b] of Array.from(byStaff.entries())) {
    // Per-staff history (with this staff only) for newToStaff
    const stHist = await prisma.appointment.findMany({
      where: {
        businessId: bizId, status: { notIn: CANCELLED },
        staffId: sid, customerId: { in: Array.from(b.customerIds) },
      },
      select: { customerId: true, date: true },
    });
    const firstWithStaff = new Map<string, Date>();
    for (const h of stHist) {
      const d = new Date(h.date);
      const cur = firstWithStaff.get(h.customerId);
      if (!cur || d < cur) firstWithStaff.set(h.customerId, d);
    }

    let newToStaff = 0;
    let newAlsoToBusiness = 0;
    for (const cid of Array.from(b.customerIds)) {
      const fws = firstWithStaff.get(cid);
      if (fws && fws >= start && fws <= end) {
        newToStaff++;
        const fbs = firstEverByCust.get(cid);
        if (fbs && fbs >= start && fbs <= end) newAlsoToBusiness++;
      }
    }

    perStaff.push({
      staffId: sid,
      name: b.name,
      appointments: b.appts.length,
      revenue: b.appts.reduce((s, a) => s + a.price, 0),
      newToStaff,
      newAlsoToBusiness,
    });
  }
  perStaff.sort((a, b) => b.revenue - a.revenue);

  return {
    appointments: active.length,
    revenue,
    uniqueCustomers: customerIds.length,
    newToBusiness,
    noShows,
    cancellationsSameDay,
    perStaff,
  };
}

// ── Daily report ────────────────────────────────────────────────────────────

export async function buildDailyReport(bizId: string): Promise<string> {
  const { start: tStart, end: tEnd } = todayRange();
  const { start: tomStart, end: tomEnd } = tomorrowRange();

  const [stats, occ, bookingsCreatedToday, tomorrowAppts] = await Promise.all([
    computePeriodStats(bizId, tStart, tEnd),
    computeOccupancy({ businessId: bizId, from: tStart, to: tEnd }),
    prisma.appointment.count({
      where: {
        businessId: bizId,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        status: { notIn: CANCELLED },
      },
    }),
    prisma.appointment.findMany({
      where: { businessId: bizId, status: { notIn: CANCELLED }, date: { gte: tomStart, lte: tomEnd } },
      select: { startTime: true },
      orderBy: { startTime: "asc" },
    }),
  ]);

  const today = new Date();
  const dayName = DAY_NAMES_HE[today.getDay()];
  const dateStr = fmtDateHe(today);

  const lines: string[] = [];
  lines.push(`📊 סיכום יום — יום ${dayName} ${dateStr}`);
  lines.push("");
  lines.push(`לקוחות היום: ${stats.appointments}${stats.newToBusiness > 0 ? ` (${stats.newToBusiness} חדשים למספרה)` : ""}`);
  lines.push(`מחזור: ${fmtMoney(stats.revenue)}`);
  lines.push(`תפוסה: ${occ.pct}%`);
  lines.push(`תורים שנקבעו היום: ${bookingsCreatedToday}`);

  if (stats.perStaff.length > 0) {
    lines.push("");
    lines.push("— פר ספר —");
    // Per-staff occupancy
    const occPerStaff = await Promise.all(
      stats.perStaff.map(s => computeOccupancy({ businessId: bizId, from: tStart, to: tEnd, staffId: s.staffId }))
    );
    stats.perStaff.forEach((s, i) => {
      const newsPart = s.newToStaff > 0 ? ` (${s.newToStaff} חדשים)` : "";
      lines.push(`• ${s.name}: ${s.appointments}${newsPart} — ${fmtMoney(s.revenue)} — תפוסה ${occPerStaff[i].pct}%`);
    });
  }

  if (stats.noShows > 0 || stats.cancellationsSameDay > 0) {
    lines.push("");
    lines.push(`⚠️ no-shows: ${stats.noShows} | ביטולים: ${stats.cancellationsSameDay}`);
  }

  if (tomorrowAppts.length > 0) {
    lines.push("");
    lines.push(`מחר: ${tomorrowAppts.length} תורים (פתיחה ${tomorrowAppts[0].startTime})`);
  } else {
    lines.push("");
    lines.push(`מחר: אין תורים מתוכננים`);
  }

  return lines.join("\n");
}

// ── Weekly report — manager view ────────────────────────────────────────────

export async function buildWeeklyReportManager(bizId: string): Promise<string> {
  const { start: wStart, end: wEnd } = lastNDaysRange(7);
  const { start: pStart, end: pEnd } = previousNDaysRange(7, 7);

  const [curr, prev, occ, atRiskCount, topServices] = await Promise.all([
    computePeriodStats(bizId, wStart, wEnd),
    computePeriodStats(bizId, pStart, pEnd),
    computeOccupancy({ businessId: bizId, from: wStart, to: wEnd }),
    countAtRiskCustomers(bizId),
    topServicesInRange(bizId, wStart, wEnd, 3),
  ]);

  const lines: string[] = [];
  lines.push(`📈 סיכום שבועי — ${fmtDateHe(wStart)}–${fmtDateHe(wEnd)}`);
  lines.push("");
  lines.push(`לקוחות: ${curr.appointments} (${fmtTrend(curr.appointments, prev.appointments)})`);
  lines.push(`מחזור: ${fmtMoney(curr.revenue)} (${fmtTrend(curr.revenue, prev.revenue)})`);
  lines.push(`חדשים למספרה: ${curr.newToBusiness}`);
  lines.push(`תפוסה: ${occ.pct}%`);

  if (curr.perStaff.length > 0) {
    lines.push("");
    lines.push("— פר ספר —");
    curr.perStaff.forEach(s => {
      lines.push(`${s.name}: ${s.appointments} | ${fmtMoney(s.revenue)} | ${s.newToStaff} חדשים`);
    });
  }

  if (topServices.length > 0) {
    lines.push("");
    lines.push(`🏆 שירותים מובילים: ${topServices.map(s => `${s.name} (${s.count})`).join(", ")}`);
  }

  if (atRiskCount > 0) {
    lines.push("");
    lines.push(`⚠️ ${atRiskCount} לקוחות לא חזרו 60+ יום — שווה לפנות אליהם`);
  }

  return lines.join("\n");
}

// ── Weekly report — staff personal view ─────────────────────────────────────

export async function buildWeeklyReportStaff(bizId: string, staffId: string): Promise<string> {
  const { start: wStart, end: wEnd } = lastNDaysRange(7);
  const { start: pStart, end: pEnd } = previousNDaysRange(7, 7);

  const [curr, prev, occ, staff] = await Promise.all([
    computeStaffStatsForPeriod(bizId, staffId, wStart, wEnd),
    computeStaffStatsForPeriod(bizId, staffId, pStart, pEnd),
    computeOccupancy({ businessId: bizId, from: wStart, to: wEnd, staffId }),
    prisma.staff.findUnique({ where: { id: staffId }, select: { name: true } }),
  ]);

  const lines: string[] = [];
  lines.push(`📊 השבוע שלך, ${staff?.name ?? ""} — ${fmtDateHe(wStart)}–${fmtDateHe(wEnd)}`);
  lines.push("");
  lines.push(`לקוחות: ${curr.appointments} (${fmtTrend(curr.appointments, prev.appointments)})`);
  lines.push(`חדשים אצלך: ${curr.newToStaff}${curr.newAlsoToBusiness > 0 ? ` (מתוכם ${curr.newAlsoToBusiness} חדשים גם למספרה)` : ""}`);
  lines.push(`מחזור: ${fmtMoney(curr.revenue)}`);
  lines.push(`תפוסה: ${occ.pct}%`);

  // Insight line
  const insight = staffInsight(curr, prev, occ.pct);
  if (insight) {
    lines.push("");
    lines.push(insight);
  }

  return lines.join("\n");
}

// ── Monthly report — manager view ───────────────────────────────────────────

export async function buildMonthlyReportManager(bizId: string): Promise<string> {
  const { start: mStart, end: mEnd, monthLabel } = lastCalendarMonthRange();
  const { start: prevStart, end: prevEnd } = nMonthsAgoRange(2);
  const { start: threeAgoStart, end: threeAgoEnd } = nMonthsAgoRange(3);

  const [curr, prev, threeAgo, occ, atRiskCount, topServices, lostNow, returnedNow] = await Promise.all([
    computePeriodStats(bizId, mStart, mEnd),
    computePeriodStats(bizId, prevStart, prevEnd),
    computePeriodStats(bizId, threeAgoStart, threeAgoEnd),
    computeOccupancy({ businessId: bizId, from: mStart, to: mEnd }),
    countAtRiskCustomers(bizId),
    topServicesInRange(bizId, mStart, mEnd, 5),
    countCustomersLostInMonth(bizId, mStart, mEnd, 90),
    countCustomersWonBackInMonth(bizId, mStart, mEnd, 60),
  ]);

  const lines: string[] = [];
  lines.push(`📅 דוח חודשי — ${monthLabel}`);
  lines.push("");
  lines.push(`לקוחות: ${curr.appointments} (${fmtTrend(curr.appointments, prev.appointments)})`);
  lines.push(`מחזור: ${fmtMoney(curr.revenue)} (${fmtTrend(curr.revenue, prev.revenue)})`);
  lines.push(`חדשים למספרה: ${curr.newToBusiness}`);
  lines.push(`תפוסה: ${occ.pct}%`);
  lines.push(`מגמה (3 חודשים): ${fmtTrend(curr.revenue, threeAgo.revenue)}`);

  if (curr.perStaff.length > 0) {
    lines.push("");
    lines.push("— פר ספר —");
    curr.perStaff.forEach(s => {
      lines.push(`${s.name}: ${s.appointments} | ${fmtMoney(s.revenue)} | ${s.newToStaff} חדשים`);
    });
  }

  if (topServices.length > 0) {
    lines.push("");
    lines.push(`🏆 שירותים מובילים: ${topServices.map(s => `${s.name} (${s.count})`).join(", ")}`);
  }

  lines.push("");
  if (lostNow > 0)     lines.push(`💔 לקוחות שאיבדנו החודש: ${lostNow} (לא חזרו 90+ יום)`);
  if (returnedNow > 0) lines.push(`💚 לקוחות שהחזרנו החודש: ${returnedNow}`);
  if (atRiskCount > 0) lines.push(`⚠️ סה״כ לקוחות בסיכון כרגע: ${atRiskCount}`);

  return lines.join("\n");
}

// ── Monthly report — staff personal view ────────────────────────────────────

export async function buildMonthlyReportStaff(bizId: string, staffId: string): Promise<string> {
  const { start: mStart, end: mEnd, monthLabel } = lastCalendarMonthRange();
  const { start: prevStart, end: prevEnd } = nMonthsAgoRange(2);

  const [curr, prev, occ, staff] = await Promise.all([
    computeStaffStatsForPeriod(bizId, staffId, mStart, mEnd),
    computeStaffStatsForPeriod(bizId, staffId, prevStart, prevEnd),
    computeOccupancy({ businessId: bizId, from: mStart, to: mEnd, staffId }),
    prisma.staff.findUnique({ where: { id: staffId }, select: { name: true } }),
  ]);

  const lines: string[] = [];
  lines.push(`📊 הדוח החודשי שלך, ${staff?.name ?? ""} — ${monthLabel}`);
  lines.push("");
  lines.push(`לקוחות: ${curr.appointments} (${fmtTrend(curr.appointments, prev.appointments)})`);
  lines.push(`חדשים אצלך: ${curr.newToStaff}${curr.newAlsoToBusiness > 0 ? ` (מתוכם ${curr.newAlsoToBusiness} חדשים גם למספרה)` : ""}`);
  lines.push(`מחזור: ${fmtMoney(curr.revenue)} (${fmtTrend(curr.revenue, prev.revenue)})`);
  lines.push(`תפוסה: ${occ.pct}%`);

  const insight = staffInsight(curr, prev, occ.pct);
  if (insight) {
    lines.push("");
    lines.push(insight);
  }

  return lines.join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type StaffPeriod = {
  appointments: number;
  revenue: number;
  newToStaff: number;
  newAlsoToBusiness: number;
};

async function computeStaffStatsForPeriod(
  bizId: string, staffId: string, start: Date, end: Date
): Promise<StaffPeriod> {
  const active = await prisma.appointment.findMany({
    where: { businessId: bizId, staffId, status: { notIn: CANCELLED }, date: { gte: start, lte: end } },
    select: { customerId: true, price: true },
  });
  const customerIds = Array.from(new Set(active.map(a => a.customerId)));
  const revenue = active.reduce((s, a) => s + a.price, 0);

  if (customerIds.length === 0) {
    return { appointments: 0, revenue: 0, newToStaff: 0, newAlsoToBusiness: 0 };
  }

  // first-with-staff dates
  const stHist = await prisma.appointment.findMany({
    where: { businessId: bizId, staffId, status: { notIn: CANCELLED }, customerId: { in: customerIds } },
    select: { customerId: true, date: true },
  });
  const firstWithStaff = new Map<string, Date>();
  for (const h of stHist) {
    const d = new Date(h.date);
    const cur = firstWithStaff.get(h.customerId);
    if (!cur || d < cur) firstWithStaff.set(h.customerId, d);
  }

  // first-ever (global) dates for the same customers
  const globalHist = await prisma.appointment.findMany({
    where: { businessId: bizId, status: { notIn: CANCELLED }, customerId: { in: customerIds } },
    select: { customerId: true, date: true },
  });
  const firstEver = new Map<string, Date>();
  for (const h of globalHist) {
    const d = new Date(h.date);
    const cur = firstEver.get(h.customerId);
    if (!cur || d < cur) firstEver.set(h.customerId, d);
  }

  let newToStaff = 0;
  let newAlsoToBusiness = 0;
  for (const cid of customerIds) {
    const fws = firstWithStaff.get(cid);
    if (fws && fws >= start && fws <= end) {
      newToStaff++;
      const fbs = firstEver.get(cid);
      if (fbs && fbs >= start && fbs <= end) newAlsoToBusiness++;
    }
  }

  return { appointments: active.length, revenue, newToStaff, newAlsoToBusiness };
}

async function countAtRiskCustomers(bizId: string, daysCutoff = 60): Promise<number> {
  const cutoff = new Date(Date.now() - daysCutoff * 24 * 60 * 60 * 1000);
  const all = await prisma.appointment.groupBy({
    by: ["customerId"],
    where: { businessId: bizId, status: { notIn: CANCELLED } },
    _max: { date: true },
  });
  return all.filter(r => r._max.date && new Date(r._max.date) < cutoff).length;
}

async function topServicesInRange(
  bizId: string, start: Date, end: Date, limit: number
): Promise<{ name: string; count: number }[]> {
  const grouped = await prisma.appointment.groupBy({
    by: ["serviceId"],
    where: { businessId: bizId, status: { notIn: CANCELLED }, date: { gte: start, lte: end } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: limit,
  });
  if (grouped.length === 0) return [];
  const services = await prisma.service.findMany({
    where: { id: { in: grouped.map(g => g.serviceId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(services.map(s => [s.id, s.name]));
  return grouped.map(g => ({
    name: nameById.get(g.serviceId) ?? "—",
    count: g._count.id,
  }));
}

/**
 * Customers "lost this month" = had a visit BEFORE the cutoff (last visit ≥ daysCutoff days
 * before month end) AND that crossover happened DURING the month.
 *
 * Practical proxy: customers whose last visit is now between (monthEnd − daysCutoff − 30 days) and
 * (monthEnd − daysCutoff) — i.e. they crossed into "lost" during the report month.
 */
async function countCustomersLostInMonth(
  bizId: string, monthStart: Date, monthEnd: Date, daysCutoff: number
): Promise<number> {
  const grouped = await prisma.appointment.groupBy({
    by: ["customerId"],
    where: { businessId: bizId, status: { notIn: CANCELLED } },
    _max: { date: true },
  });
  // Crossover window = (monthEnd − daysCutoff − monthSpan) to (monthEnd − daysCutoff)
  const cutoffEnd   = new Date(monthEnd.getTime()   - daysCutoff * 24 * 60 * 60 * 1000);
  const monthSpanMs = monthEnd.getTime() - monthStart.getTime();
  const cutoffStart = new Date(cutoffEnd.getTime() - monthSpanMs);
  return grouped.filter(r => {
    const d = r._max.date ? new Date(r._max.date) : null;
    return d && d >= cutoffStart && d <= cutoffEnd;
  }).length;
}

/**
 * Customers "won back this month" = had a visit DURING the report month AND their previous
 * visit was at least `dormantDays` before that visit.
 */
async function countCustomersWonBackInMonth(
  bizId: string, monthStart: Date, monthEnd: Date, dormantDays: number
): Promise<number> {
  const inMonth = await prisma.appointment.findMany({
    where: { businessId: bizId, status: { notIn: CANCELLED }, date: { gte: monthStart, lte: monthEnd } },
    select: { customerId: true, date: true },
  });
  const monthCustIds = Array.from(new Set(inMonth.map(a => a.customerId)));
  if (monthCustIds.length === 0) return 0;

  const earliestInMonth = new Map<string, Date>();
  for (const a of inMonth) {
    const d = new Date(a.date);
    const cur = earliestInMonth.get(a.customerId);
    if (!cur || d < cur) earliestInMonth.set(a.customerId, d);
  }

  const allHist = await prisma.appointment.findMany({
    where: {
      businessId: bizId, status: { notIn: CANCELLED },
      customerId: { in: monthCustIds }, date: { lt: monthStart },
    },
    select: { customerId: true, date: true },
    orderBy: { date: "desc" },
  });
  const lastBeforeMonth = new Map<string, Date>();
  for (const a of allHist) {
    if (!lastBeforeMonth.has(a.customerId)) lastBeforeMonth.set(a.customerId, new Date(a.date));
  }

  let wonBack = 0;
  for (const cid of monthCustIds) {
    const last = lastBeforeMonth.get(cid);
    const first = earliestInMonth.get(cid);
    if (!last || !first) continue; // brand-new customers don't count as "won back"
    const gapMs = first.getTime() - last.getTime();
    if (gapMs >= dormantDays * 24 * 60 * 60 * 1000) wonBack++;
  }
  return wonBack;
}

function staffInsight(curr: StaffPeriod, prev: StaffPeriod, occPct: number): string | null {
  if (curr.appointments === 0 && prev.appointments === 0) {
    return "💡 שבוע שקט — נסה לפנות ללקוחות ותיקים ולהציע להם תור";
  }
  if (curr.appointments > prev.appointments * 1.15 && prev.appointments > 0) {
    return "🎉 גידול משמעותי בתפוסה — כל הכבוד!";
  }
  if (curr.appointments < prev.appointments * 0.85 && prev.appointments > 0) {
    return "📉 ירידה בתפוסה — שווה לדחוף תורים מהירים או הצעות שיווק";
  }
  if (occPct < 50 && curr.appointments > 0) {
    return "💡 יש עוד מקום ביומן — נסה לדחוף תורים מהירים";
  }
  if (occPct >= 85) {
    return "🔥 תפוסה מעולה!";
  }
  return null;
}
