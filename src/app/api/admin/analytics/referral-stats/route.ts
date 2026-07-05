import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness, scopedStaffId } from "@/lib/session";

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

  const business = await getSessionBusiness(req, { id: true, settings: true });
  if (!business) return NextResponse.json([]);

  // Owner-defined source-merge map (Business.settings.refAliases): folds raw
  // sources into a canonical label at read time. Non-destructive & retroactive.
  // A raw source with no entry is left as-is (shows as its own row).
  let refAliases: Record<string, string> = {};
  try {
    const s = business.settings ? JSON.parse(business.settings) : {};
    if (s?.refAliases && typeof s.refAliases === "object" && !Array.isArray(s.refAliases)) {
      refAliases = s.refAliases as Record<string, string>;
    }
  } catch { /* ignore malformed settings */ }

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
      deletedAt: null,
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      ...(staffId ? { appointments: { some: { staffId } } } : {}),
    },
    select: {
      referralSource: true,
      utmContent: true,
      _count: { select: { appointments: { where: staffId ? { staffId } : undefined } } },
    },
  });

  // ── Group by referral source ──────────────────────────────────────────────────
  // Each source also keeps a per-ad breakdown (from utm_content) so the dashboard
  // can drill campaign → specific ad.
  type Ads = Map<string, { total: number; returning: number }>;
  const map = new Map<string, { total: number; returning: number; regulars: number; loyal: number; ads: Ads }>();

  for (const c of customers) {
    const rawSrc = c.referralSource?.trim() || "לא ידוע";
    const src = refAliases[rawSrc] || rawSrc;
    const n = c._count.appointments;
    const row = map.get(src) ?? { total: 0, returning: 0, regulars: 0, loyal: 0, ads: new Map() as Ads };
    row.total    += 1;
    if (n >= 2)  row.returning += 1;
    if (n >= 3)  row.regulars  += 1;
    if (n >= 10) row.loyal     += 1;
    // Ad-level breakdown — only for customers that carry a specific ad name.
    const ad = c.utmContent?.trim();
    if (ad) {
      const adRow = row.ads.get(ad) ?? { total: 0, returning: 0 };
      adRow.total += 1;
      if (n >= 2) adRow.returning += 1;
      row.ads.set(ad, adRow);
    }
    map.set(src, row);
  }

  const result = Array.from(map.entries())
    .map(([source, { total, returning, regulars, loyal, ads }]) => ({
      source,
      total,
      returning,
      returningPct: total > 0 ? Math.round((returning / total) * 100) : 0,
      regulars,
      regularPct:   total > 0 ? Math.round((regulars  / total) * 100) : 0,
      loyal,
      loyalPct:     total > 0 ? Math.round((loyal     / total) * 100) : 0,
      ads: Array.from(ads.entries())
        .map(([ad, v]) => ({ ad, total: v.total, returning: v.returning }))
        .sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json(result);
}
