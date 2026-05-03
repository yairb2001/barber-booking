import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, scopedStaffId } from "@/lib/session";

// GET /api/admin/analytics/referral-stats
// Query params:
//   period: "all" | "month" | "custom"  (default: "all")
//   from:   ISO date string (used when period=custom)
//   to:     ISO date string (used when period=custom)
//   staffId: string (optional, owner only — barbers are auto-scoped)
//
// Returns array of:
//   { source, total, regulars, regularPct }
//   where regulars = customers with 3+ appointments

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const barberScope = scopedStaffId(req);
  if (barberScope === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const period   = searchParams.get("period") ?? "all";
  const fromParam = searchParams.get("from") ?? "";
  const toParam   = searchParams.get("to")   ?? "";
  // Barbers are always scoped to themselves; owners can filter by staffId
  const staffId   = barberScope ?? (searchParams.get("staffId") || undefined);

  const business = await prisma.business.findFirst({ select: { id: true } });
  if (!business) return NextResponse.json([]);

  // ── Date range for customer creation filter ──────────────────────────────────
  let createdAtFilter: { gte?: Date; lte?: Date } | undefined;
  if (period === "month") {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    createdAtFilter = { gte: start };
  } else if (period === "custom" && fromParam && toParam) {
    createdAtFilter = {
      gte: new Date(fromParam + "T00:00:00.000Z"),
      lte: new Date(toParam   + "T23:59:59.999Z"),
    };
  }

  // ── Fetch all customers (with appointment count) ─────────────────────────────
  // If staffId scoped, only count customers who have at least one appointment with that staff
  const customers = await prisma.customer.findMany({
    where: {
      businessId: business.id,
      isBlocked: false,
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      ...(staffId ? { appointments: { some: { staffId } } } : {}),
    },
    select: {
      referralSource: true,
      _count: { select: { appointments: { where: staffId ? { staffId } : undefined } } },
    },
  });

  // ── Group by referral source ──────────────────────────────────────────────────
  const map = new Map<string, { total: number; returning: number; regulars: number; loyal: number }>();

  for (const c of customers) {
    const src = c.referralSource?.trim() || "לא ידוע";
    const n = c._count.appointments;
    const row = map.get(src) ?? { total: 0, returning: 0, regulars: 0, loyal: 0 };
    row.total    += 1;
    if (n >= 2)  row.returning += 1;
    if (n >= 3)  row.regulars  += 1;
    if (n >= 10) row.loyal     += 1;
    map.set(src, row);
  }

  const result = Array.from(map.entries())
    .map(([source, { total, returning, regulars, loyal }]) => ({
      source,
      total,
      returning,
      returningPct: total > 0 ? Math.round((returning / total) * 100) : 0,
      regulars,
      regularPct:   total > 0 ? Math.round((regulars  / total) * 100) : 0,
      loyal,
      loyalPct:     total > 0 ? Math.round((loyal     / total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json(result);
}
