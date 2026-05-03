/**
 * GET /api/admin/analytics/insights
 *
 * Deep-analysis data for the dashboard insights page:
 *   - atRisk[]  — customers whose last active appointment was 60+ days ago
 *   - heatmap[] — occupancy % per (dayOfWeek, hour) over the last 90 days
 *
 * Owners see all customers; barbers are scoped to their own.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const CANCELLED = ["cancelled_by_customer", "cancelled_by_staff"];
const AT_RISK_DAYS = 60;
const HEATMAP_WINDOW_DAYS = 90;
const ATRISK_LIMIT = 50;

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const biz = await prisma.business.findFirst({ select: { id: true } });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });
  const bizId = biz.id;

  const effectiveStaffId = (!session.isOwner && session.staffId) ? session.staffId : null;
  const sf = effectiveStaffId ? { staffId: effectiveStaffId } : {};

  const now = new Date();
  const atRiskCutoff = new Date(now.getTime() - AT_RISK_DAYS * 24 * 60 * 60 * 1000);
  const heatmapStart = new Date(now.getTime() - HEATMAP_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // ── At-risk customers ─────────────────────────────────────────────────────
  // Group all non-cancelled appointments by customer; find MAX(date)
  const allAppts = await prisma.appointment.findMany({
    where: { businessId: bizId, status: { notIn: CANCELLED }, ...sf },
    select: { customerId: true, staffId: true, date: true },
  });

  type Agg = { lastDate: Date; visits: number; staffCounts: Map<string, number> };
  const byCust = new Map<string, Agg>();
  for (const a of allAppts) {
    const d = new Date(a.date);
    const cur = byCust.get(a.customerId);
    if (cur) {
      cur.visits++;
      if (d > cur.lastDate) cur.lastDate = d;
      cur.staffCounts.set(a.staffId, (cur.staffCounts.get(a.staffId) ?? 0) + 1);
    } else {
      byCust.set(a.customerId, {
        lastDate: d,
        visits: 1,
        staffCounts: new Map([[a.staffId, 1]]),
      });
    }
  }

  // Filter to at-risk (>= AT_RISK_DAYS since last visit)
  type AtRiskRaw = { customerId: string; lastDate: Date; daysSince: number; visits: number; topStaffId: string };
  const atRiskRaw: AtRiskRaw[] = [];
  for (const [cid, agg] of Array.from(byCust.entries())) {
    if (agg.lastDate < atRiskCutoff) {
      // pick the most-frequent staff
      let topStaff = "";
      let topCount = 0;
      for (const [sid, c] of Array.from(agg.staffCounts.entries())) {
        if (c > topCount) { topCount = c; topStaff = sid; }
      }
      atRiskRaw.push({
        customerId: cid,
        lastDate: agg.lastDate,
        daysSince: Math.floor((now.getTime() - agg.lastDate.getTime()) / (24 * 60 * 60 * 1000)),
        visits: agg.visits,
        topStaffId: topStaff,
      });
    }
  }

  // Sort: most "fresh" at-risk first (smallest daysSince) — best chance to win back
  atRiskRaw.sort((a, b) => a.daysSince - b.daysSince);
  const top = atRiskRaw.slice(0, ATRISK_LIMIT);

  // Look up customer + staff details for the top slice
  const custIds = top.map(x => x.customerId);
  const staffIds = Array.from(new Set(top.map(x => x.topStaffId).filter(Boolean)));
  const [customers, staffRows] = await Promise.all([
    prisma.customer.findMany({
      where: { id: { in: custIds } },
      select: { id: true, name: true, phone: true },
    }),
    prisma.staff.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true },
    }),
  ]);
  const custMap  = new Map(customers.map(c => [c.id, c]));
  const staffMap = new Map(staffRows.map(s => [s.id, s.name]));

  const atRisk = top.map(r => {
    const c = custMap.get(r.customerId);
    return {
      customerId: r.customerId,
      name:  c?.name  ?? "—",
      phone: c?.phone ?? "",
      lastVisitAt: r.lastDate.toISOString(),
      daysSince: r.daysSince,
      totalVisits: r.visits,
      preferredStaffName: staffMap.get(r.topStaffId) ?? null,
    };
  });

  // ── Heatmap (last 90 days, by dayOfWeek + hour of startTime) ────────────
  const recentAppts = await prisma.appointment.findMany({
    where: {
      businessId: bizId,
      status: { notIn: CANCELLED },
      date: { gte: heatmapStart },
      ...sf,
    },
    select: { date: true, startTime: true },
  });

  // counts[day][hour] = appointments
  const counts = new Map<string, number>();
  for (const a of recentAppts) {
    const d = new Date(a.date);
    const dayOfWeek = d.getUTCDay(); // 0 = Sunday
    const hour = parseInt((a.startTime || "00:00").split(":")[0], 10);
    const key = `${dayOfWeek}-${hour}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const maxCount = Math.max(1, ...Array.from(counts.values()));
  const heatmap: { dayOfWeek: number; hour: number; count: number; pct: number }[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 7; hour <= 22; hour++) {
      const c = counts.get(`${day}-${hour}`) ?? 0;
      heatmap.push({ dayOfWeek: day, hour, count: c, pct: Math.round((c / maxCount) * 100) });
    }
  }

  return NextResponse.json({
    atRisk,
    atRiskTotal: atRiskRaw.length,
    heatmap,
    heatmapWindowDays: HEATMAP_WINDOW_DAYS,
    heatmapMaxCount: maxCount,
  });
}
