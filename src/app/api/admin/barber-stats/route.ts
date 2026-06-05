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
// Returns Sunday..Saturday (UTC) for a given week offset.
// offsetWeeks=0 → current week, -1 → previous week, etc.
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
  // Week crosses month boundary
  return `${startDay} ${MONTHS_HE[startMonth]}–${endDay} ${MONTHS_HE[endMonth]}`;
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const staffIdParam = searchParams.get("staffId");

  // Determine whose stats to fetch
  let staffId: string;
  if (!session.isOwner && session.staffId) {
    staffId = session.staffId;
  } else if (session.isOwner && staffIdParam) {
    staffId = staffIdParam;
  } else {
    return NextResponse.json({ error: "no staff scope" }, { status: 400 });
  }

  // Israel time ≈ UTC+2 (acceptable approximation for daily boundaries)
  const nowIsrael = new Date(Date.now() + 2 * 60 * 60 * 1000);

  const thisWeekRange = getWeekRange(0,  nowIsrael);
  const lastWeekRange = getWeekRange(-1, nowIsrael);

  // 12 weeks of history: [-11, -10, ..., -1, 0] oldest → newest
  const weekRanges = Array.from({ length: 12 }, (_, i) => getWeekRange(i - 11, nowIsrael));

  // Earliest boundary we need
  const earliest = weekRanges[0].start;

  // Base filter: non-cancelled appointments for this barber
  const CANCELLED = ["cancelled_by_customer", "cancelled_by_staff"] as string[];
  const baseWhere = {
    staffId,
    status: { notIn: CANCELLED },
  };

  // Fetch all appointments in the 8-week window in one query
  const recentAppts = await prisma.appointment.findMany({
    where: {
      ...baseWhere,
      date: { gte: earliest, lte: thisWeekRange.end },
    },
    select: { date: true, price: true, customerId: true },
  });

  function sumRange(start: Date, end: Date) {
    const appts = recentAppts.filter(a => a.date >= start && a.date <= end);
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

  // ── Lifetime stats (all time, not just 8 weeks) ───────────────────────────
  // Use aggregate + findMany instead of groupBy to avoid Prisma _count shape issues
  const lifetimeRaw = await prisma.appointment.groupBy({
    by:     ["customerId"],
    where:  baseWhere,
    _count: { _all: true },
  });
  const totalLifetime   = lifetimeRaw.reduce((s, r) => s + r._count._all, 0);
  const uniqueCustomers = lifetimeRaw.length;
  const repeatCustomers = lifetimeRaw.filter(r => r._count._all >= 2).length;
  const returnRate       = uniqueCustomers > 0
    ? Math.round((repeatCustomers / uniqueCustomers) * 100)
    : 0;

  return NextResponse.json({
    thisWeek,
    lastWeek,
    weeklyHistory,
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
