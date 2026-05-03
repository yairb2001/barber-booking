/**
 * GET /api/admin/analytics/insights
 *
 * Marketing deep-analysis: customers grouped by referral source.
 *
 * Query params:
 *   period  — "all" | "month" | "custom"  (default: "all")
 *   from    — ISO date string (used when period="custom")
 *   to      — ISO date string (used when period="custom")
 *   staffId — optional staff UUID to scope to a specific barber
 *
 * Response:
 *   rows[]  — one row per referral source (+ "ישיר / לא ידוע" bucket)
 *     source        : string
 *     total         : number   — customers with this source in the period
 *     regulars      : number   — customers with 3+ non-cancelled appointments
 *     regularsPct   : number   — 0-100
 *
 *   totalCustomers, totalRegulars, regularsPct  — grand totals
 *   staffList[]    — id + name of all staff (for the barber filter UI)
 *   periodLabel    — human-readable string for display
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const CANCELLED = ["cancelled_by_customer", "cancelled_by_staff"];
const REGULAR_MIN_VISITS = 3;
const UNKNOWN_SOURCE = "ישיר / לא ידוע";

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const biz = await prisma.business.findFirst({ select: { id: true } });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });
  const bizId = biz.id;

  const isOwner = session.isOwner ?? false;
  const sessionStaffId = (!isOwner && session.staffId) ? session.staffId : null;

  // ── Parse query params ────────────────────────────────────────────────────
  const url   = new URL(req.url);
  const period  = url.searchParams.get("period") ?? "all";       // all | month | custom
  const fromStr = url.searchParams.get("from");
  const toStr   = url.searchParams.get("to");

  // Barbers can only see their own data; owners can filter optionally
  const filterStaffId = sessionStaffId ?? (isOwner ? (url.searchParams.get("staffId") ?? null) : null);

  // ── Date range ────────────────────────────────────────────────────────────
  let fromDate: Date | null = null;
  let toDate:   Date | null = null;
  let periodLabel = "כל הזמנים";

  if (period === "month") {
    const now = new Date();
    fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    toDate   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    periodLabel = `${now.toLocaleString("he-IL", { month: "long", timeZone: "UTC" })} ${now.getUTCFullYear()}`;
  } else if (period === "custom" && fromStr && toStr) {
    fromDate = new Date(fromStr);
    toDate   = new Date(toStr);
    toDate.setUTCHours(23, 59, 59, 999);
    const fmt = (d: Date) => d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
    periodLabel = `${fmt(fromDate)} – ${fmt(toDate)}`;
  }

  // ── 1. Fetch customers (optionally filtered by join date) ─────────────────
  // When a staff filter is active we only count customers who have at least
  // one appointment with that staff member in the period.
  let customerIds: string[] | null = null; // null = no staff restriction

  if (filterStaffId) {
    // Get all customerIds who have any appointment with this staff
    const staffAppts = await prisma.appointment.findMany({
      where: {
        businessId: bizId,
        staffId: filterStaffId,
        status: { notIn: CANCELLED },
      },
      select: { customerId: true },
      distinct: ["customerId"],
    });
    customerIds = staffAppts.map(a => a.customerId);
  }

  const customers = await prisma.customer.findMany({
    where: {
      businessId: bizId,
      ...(fromDate ? { createdAt: { gte: fromDate } } : {}),
      ...(toDate   ? { createdAt: { lt:  toDate   } } : {}),
      ...(customerIds !== null ? { id: { in: customerIds } } : {}),
    },
    select: { id: true, referralSource: true },
  });

  if (customers.length === 0) {
    // Still need staffList for the filter UI
    const staffList = isOwner
      ? await prisma.staff.findMany({
          where: { businessId: bizId, isAvailable: true },
          select: { id: true, name: true },
          orderBy: { sortOrder: "asc" },
        })
      : [];

    return NextResponse.json({
      rows: [],
      totalCustomers: 0,
      totalRegulars: 0,
      regularsPct: 0,
      staffList,
      periodLabel,
    });
  }

  const allCustIds = customers.map(c => c.id);

  // ── 2. Count appointments per customer ────────────────────────────────────
  // "Regular" = 3+ non-cancelled appointments (scoped to the barber if filtered)
  const apptGroups = await prisma.appointment.groupBy({
    by: ["customerId"],
    where: {
      businessId: bizId,
      customerId: { in: allCustIds },
      status: { notIn: CANCELLED },
      ...(filterStaffId ? { staffId: filterStaffId } : {}),
    },
    _count: { id: true },
  });

  const apptCountById = new Map<string, number>(
    apptGroups.map(g => [g.customerId, g._count.id])
  );

  // ── 3. Aggregate by referral source ──────────────────────────────────────
  type SourceAgg = { total: number; regulars: number };
  const bySource = new Map<string, SourceAgg>();

  for (const cust of customers) {
    const source = cust.referralSource?.trim() || UNKNOWN_SOURCE;
    const visits = apptCountById.get(cust.id) ?? 0;
    const isRegular = visits >= REGULAR_MIN_VISITS;

    const cur = bySource.get(source);
    if (cur) {
      cur.total++;
      if (isRegular) cur.regulars++;
    } else {
      bySource.set(source, { total: 1, regulars: isRegular ? 1 : 0 });
    }
  }

  // ── 4. Build sorted rows ──────────────────────────────────────────────────
  // Sort by total desc; "unknown" always last
  const rows = Array.from(bySource.entries())
    .map(([source, agg]) => ({
      source,
      total: agg.total,
      regulars: agg.regulars,
      regularsPct: agg.total > 0 ? Math.round((agg.regulars / agg.total) * 100) : 0,
    }))
    .sort((a, b) => {
      if (a.source === UNKNOWN_SOURCE) return 1;
      if (b.source === UNKNOWN_SOURCE) return -1;
      return b.total - a.total;
    });

  const totalCustomers = customers.length;
  const totalRegulars  = rows.reduce((s, r) => s + r.regulars, 0);
  const regularsPct    = totalCustomers > 0 ? Math.round((totalRegulars / totalCustomers) * 100) : 0;

  // ── 5. Staff list for the barber-filter UI (owners only) ─────────────────
  const staffList = isOwner
    ? await prisma.staff.findMany({
        where: { businessId: bizId, isAvailable: true },
        select: { id: true, name: true },
        orderBy: { sortOrder: "asc" },
      })
    : [];

  return NextResponse.json({
    rows,
    totalCustomers,
    totalRegulars,
    regularsPct,
    staffList,
    periodLabel,
  });
}
