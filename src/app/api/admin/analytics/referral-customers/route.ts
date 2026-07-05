import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness, scopedStaffId } from "@/lib/session";

// GET /api/admin/analytics/referral-customers
// Query params (same semantics as referral-stats):
//   source:  canonical (alias-resolved) source label — REQUIRED
//   period:  "all" | "month" | "custom"  (default: "all")
//   from,to: ISO date strings (period=custom)
//   staffId: string (optional, owner only — barbers are auto-scoped)
//
// Returns the customers that belong to the given canonical source, i.e. every
// customer whose raw referralSource folds into `source` via the alias map
// (Business.settings.refAliases). Mirrors the filtering in referral-stats so the
// list matches the row totals exactly. Returns:
//   [{ id, name, phone, visits, createdAt }]  (sorted by visits desc, then newest)

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const barberScope = scopedStaffId(req);
  if (barberScope === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sourceParam = (searchParams.get("source") || "").trim();
  if (!sourceParam) return NextResponse.json({ error: "source required" }, { status: 400 });

  const period    = searchParams.get("period") ?? "all";
  const fromParam = searchParams.get("from") ?? "";
  const toParam   = searchParams.get("to")   ?? "";
  const staffId   = barberScope ?? (searchParams.get("staffId") || undefined);

  const business = await getSessionBusiness(req, { id: true, settings: true });
  if (!business) return NextResponse.json([]);

  // Same alias map used at read time in referral-stats.
  let refAliases: Record<string, string> = {};
  try {
    const s = business.settings ? JSON.parse(business.settings) : {};
    if (s?.refAliases && typeof s.refAliases === "object" && !Array.isArray(s.refAliases)) {
      refAliases = s.refAliases as Record<string, string>;
    }
  } catch { /* ignore malformed settings */ }

  // ── Date range (identical to referral-stats) ────────────────────────────────
  let createdAtFilter: { gte?: Date; lte?: Date } | undefined;
  if (period === "month") {
    const now = new Date();
    createdAtFilter = { gte: new Date(now.getFullYear(), now.getMonth(), 1) };
  } else if (period === "custom" && fromParam && toParam) {
    createdAtFilter = {
      gte: new Date(fromParam + "T00:00:00.000Z"),
      lte: new Date(toParam   + "T23:59:59.999Z"),
    };
  }

  const customers = await prisma.customer.findMany({
    where: {
      businessId: business.id,
      isBlocked: false,
      deletedAt: null,
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      ...(staffId ? { appointments: { some: { staffId } } } : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      referralSource: true,
      createdAt: true,
      _count: { select: { appointments: { where: staffId ? { staffId } : undefined } } },
    },
  });

  // Keep only customers whose (alias-resolved) source matches the requested one.
  const result = customers
    .filter(c => {
      const rawSrc = c.referralSource?.trim() || "לא ידוע";
      const canonical = refAliases[rawSrc] || rawSrc;
      return canonical === sourceParam;
    })
    .map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      visits: c._count.appointments,
      createdAt: c.createdAt,
    }))
    .sort((a, b) => b.visits - a.visits || +new Date(b.createdAt) - +new Date(a.createdAt));

  return NextResponse.json(result);
}
