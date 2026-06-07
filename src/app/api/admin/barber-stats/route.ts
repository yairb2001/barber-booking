import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// ── Level thresholds (based on lifetime unique customers) ──────────────────────
const LEVELS = [
  { name: "מתחיל",  emoji: "🌱", min: 0,   max: 49  },
  { name: "מקצועי", emoji: "💪", min: 50,  max: 149 },
  { name: "מומחה",  emoji: "🔥", min: 150, max: 299 },
  { name: "מאסטר",  emoji: "👑", min: 300, max: 499 },
  { name: "אגדה",   emoji: "⭐", min: 500, max: Infinity },
] as const;

function getLevel(uniqueCustomers: number) {
  const idx = LEVELS.findIndex(
    l => uniqueCustomers >= l.min && (l.max === Infinity || uniqueCustomers <= l.max)
  );
  const safeIdx  = idx >= 0 ? idx : 0;
  const level    = LEVELS[safeIdx];
  const next     = LEVELS[safeIdx + 1] ?? null;

  const progressPct =
    level.max === Infinity
      ? 100
      : Math.min(
          100,
          Math.round(((uniqueCustomers - level.min) / (level.max - level.min + 1)) * 100)
        );

  return {
    level:       level.name,
    levelEmoji:  level.emoji,
    levelMin:    level.min,
    levelMax:    level.max === Infinity ? null : level.max,
    nextLevel:      next?.name       ?? null,
    nextLevelEmoji: next?.emoji      ?? null,
    nextLevelAt:    next?.min        ?? null,
    progressPct,
  };
}

// ── Week boundary helpers ─────────────────────────────────────────────────────
function getWeekRange(offsetWeeks: number, baseDate: Date) {
  const day = baseDate.getUTCDay(); // 0=Sunday
  const sunday = new Date(baseDate);
  sunday.setUTCDate(baseDate.getUTCDate() - day + offsetWeeks * 7);
  sunday.setUTCHours(0, 0, 0, 0);
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  saturday.setUTCHours(23, 59, 59, 999);
  return { start: sunday, end: saturday };
}

// ── Month boundary helpers ────────────────────────────────────────────────────
function getMonthRange(year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end   = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני",
                   "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function weekLabel(start: Date, end: Date) {
  const startMonth = start.getUTCMonth();
  const endMonth   = end.getUTCMonth();
  const startDay   = start.getUTCDate();
  const endDay     = end.getUTCDate();
  if (startMonth === endMonth) {
    return `${startDay}–${endDay} ${MONTHS_HE[startMonth]}`;
  }
  return `${startDay} ${MONTHS_HE[startMonth]}–${endDay} ${MONTHS_HE[endMonth]}`;
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const staffIdParam = searchParams.get("staffId");

  let staffId: string;
  if (!session.isOwner && session.staffId) {
    staffId = session.staffId;
  } else if (session.isOwner && staffIdParam) {
    staffId = staffIdParam;
  } else {
    return NextResponse.json({ error: "no staff scope" }, { status: 400 });
  }

  // Israel time ≈ UTC+2
  const nowIsrael = new Date(Date.now() + 2 * 60 * 60 * 1000);

  const thisWeekRange = getWeekRange(0,  nowIsrael);
  const lastWeekRange = getWeekRange(-1, nowIsrael);

  // 12 weeks of weekly history
  const weekRanges = Array.from({ length: 12 }, (_, i) => getWeekRange(i - 11, nowIsrael));

  // 12 months of monthly history
  const nowYear  = nowIsrael.getUTCFullYear();
  const nowMonth = nowIsrael.getUTCMonth();
  const monthRanges = Array.from({ length: 12 }, (_, i) => {
    const totalMonth = nowYear * 12 + nowMonth - (11 - i);
    const year  = Math.floor(totalMonth / 12);
    const month = totalMonth % 12;
    return { year, month, ...getMonthRange(year, month) };
  });

  // Today boundaries (Israel)
  const todayStart = new Date(Date.UTC(
    nowIsrael.getUTCFullYear(), nowIsrael.getUTCMonth(), nowIsrael.getUTCDate(), 0, 0, 0, 0
  ));
  const todayEnd = new Date(Date.UTC(
    nowIsrael.getUTCFullYear(), nowIsrael.getUTCMonth(), nowIsrael.getUTCDate(), 23, 59, 59, 999
  ));

  // This month boundaries
  const thisMonthRange = getMonthRange(nowYear, nowMonth);

  const earliest = new Date(Math.min(weekRanges[0].start.getTime(), monthRanges[0].start.getTime()));
  const CANCELLED = ["cancelled_by_customer", "cancelled_by_staff"] as string[];

  // All non-cancelled appointments for this barber from the earliest needed date
  const allRecentAppts = await prisma.appointment.findMany({
    where: {
      staffId,
      status: { notIn: CANCELLED },
      date: { gte: earliest, lte: thisWeekRange.end },
    },
    select: { date: true, price: true, customerId: true },
  });

  function sumRange(start: Date, end: Date) {
    const appts = allRecentAppts.filter(a => a.date >= start && a.date <= end);
    return {
      appointments: appts.length,
      revenue:      appts.reduce((s, a) => s + a.price, 0),
    };
  }

  const thisWeek = sumRange(thisWeekRange.start, thisWeekRange.end);
  const lastWeek = sumRange(lastWeekRange.start, lastWeekRange.end);

  const weeklyHistory = weekRanges.map(wr => ({
    weekStart: wr.start.toISOString().split("T")[0],
    weekLabel: weekLabel(wr.start, wr.end),
    ...sumRange(wr.start, wr.end),
  }));

  const monthlyHistory = monthRanges.map(mr => ({
    monthLabel: `${MONTHS_HE[mr.month]}`,
    year: mr.year,
    month: mr.month,
    ...sumRange(mr.start, mr.end),
  }));

  // ── Lifetime stats ────────────────────────────────────────────────────────
  const lifetimeRaw = await prisma.appointment.groupBy({
    by:     ["customerId"],
    where:  { staffId, status: { notIn: CANCELLED } },
    _count: { _all: true },
  });
  const totalLifetime   = lifetimeRaw.reduce((s, r) => s + r._count._all, 0);
  const uniqueCustomers = lifetimeRaw.length;
  const repeatCustomers = lifetimeRaw.filter(r => r._count._all >= 2).length;
  const returnRate      = uniqueCustomers > 0
    ? Math.round((repeatCustomers / uniqueCustomers) * 100)
    : 0;

  // ── New customers — "first appointment with this barber" ─────────────────
  // For each customer, find the date of their FIRST appointment with this barber
  const firstVisitPerCustomer = await prisma.appointment.groupBy({
    by:      ["customerId"],
    where:   { staffId, status: { notIn: CANCELLED } },
    _min:    { date: true },
  });

  function countNewInRange(start: Date, end: Date) {
    return firstVisitPerCustomer.filter(r => {
      const d = r._min.date;
      return d !== null && d >= start && d <= end;
    }).length;
  }

  const newCustomers = {
    today:     countNewInRange(todayStart, todayEnd),
    thisWeek:  countNewInRange(thisWeekRange.start, thisWeekRange.end),
    thisMonth: countNewInRange(thisMonthRange.start, thisMonthRange.end),
  };

  return NextResponse.json({
    thisWeek,
    lastWeek,
    weeklyHistory,
    monthlyHistory,
    newCustomers,
    lifetime: {
      totalAppointments: totalLifetime,
      uniqueCustomers,
      ...getLevel(uniqueCustomers),
    },
    returnRate: {
      uniqueCustomers,
      repeatCustomers,
      rate: returnRate,
    },
  });
}
