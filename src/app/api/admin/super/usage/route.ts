import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/super-admin";

/**
 * GET /api/admin/super/usage
 *
 * Per-business AI usage & cost (from AgentUsage rows) — tokens burned and USD
 * spent, all-time and this calendar month. Gated to the platform owner. Feeds
 * the "עלויות" tab in the super-admin console (usage quotas E6 / pricing E7).
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [allTime, thisMonth, businesses] = await Promise.all([
    prisma.agentUsage.groupBy({
      by: ["businessId"],
      _sum: {
        inputTokens: true, outputTokens: true,
        cacheWriteTokens: true, cacheReadTokens: true, costUsd: true,
      },
      _count: { _all: true },
    }),
    prisma.agentUsage.groupBy({
      by: ["businessId"],
      where: { createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
      _count: { _all: true },
    }),
    prisma.business.findMany({ select: { id: true, name: true } }),
  ]);

  const nameMap = new Map(businesses.map((b) => [b.id, b.name]));
  const monthMap = new Map(
    thisMonth.map((g) => [g.businessId, { costUsd: g._sum.costUsd ?? 0, calls: g._count._all }])
  );

  const rows = allTime
    .map((g) => {
      const m = monthMap.get(g.businessId);
      return {
        businessId: g.businessId,
        name: nameMap.get(g.businessId) ?? "(עסק לא ידוע)",
        calls: g._count._all,
        inputTokens: g._sum.inputTokens ?? 0,
        outputTokens: g._sum.outputTokens ?? 0,
        cacheTokens: (g._sum.cacheWriteTokens ?? 0) + (g._sum.cacheReadTokens ?? 0),
        costUsd: g._sum.costUsd ?? 0,
        costUsdMonth: m?.costUsd ?? 0,
        callsMonth: m?.calls ?? 0,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  const totals = {
    costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
    costUsdMonth: rows.reduce((s, r) => s + r.costUsdMonth, 0),
    calls: rows.reduce((s, r) => s + r.calls, 0),
    businesses: rows.length,
  };

  return NextResponse.json({ rows, totals });
}
