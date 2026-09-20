import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/super-admin";
import { computeAgentCost } from "@/lib/analytics/agent-cost";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/super/agent-cost?businessId=…
 *
 * Customer-agent AI cost metrics for the super-admin "עלויות" tab: the last
 * 7 days vs the 7 before, plus the fixed pre-optimisation baseline window
 * (1–20.9.2026) so the owner can see whether cost work actually moved the
 * numbers. Defaults to the "dominant" business. Gated to the platform owner.
 */
const DAY_MS = 86400_000;
const BASELINE_SINCE = new Date("2026-09-01T00:00:00+03:00");
const BASELINE_UNTIL = new Date("2026-09-20T23:59:59+03:00");

export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const businessId = req.nextUrl.searchParams.get("businessId");
  const biz = businessId
    ? await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } })
    : await prisma.business.findUnique({ where: { slug: "dominant" }, select: { id: true, name: true } });
  if (!biz) {
    return NextResponse.json({ error: "business not found" }, { status: 404 });
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

  const [current, previous, baseline] = await Promise.all([
    computeAgentCost({ businessId: biz.id, since: weekAgo, until: now }),
    computeAgentCost({ businessId: biz.id, since: twoWeeksAgo, until: new Date(weekAgo.getTime() - 1) }),
    computeAgentCost({ businessId: biz.id, since: BASELINE_SINCE, until: BASELINE_UNTIL }),
  ]);

  return NextResponse.json({ businessId: biz.id, businessName: biz.name, current, previous, baseline });
}
