import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin } from "@/lib/super-admin";
import { tierQuota, tierLabel } from "@/lib/tier";

/**
 * GET /api/admin/super/usage
 *
 * Per-business AI usage & cost + this-month usage-vs-quota (the pricing system).
 * Two metered cost drivers: agent conversations (AgentUsage, distinct
 * conversationId) and broadcast messages (MessageLog kind broadcast/agent_broadcast),
 * each compared to the tier's included quota. Gated to the platform owner.
 */
export async function GET(req: NextRequest) {
  if (!isSuperAdmin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [allTime, monthCost, convoRows, broadcastRows, businesses] = await Promise.all([
    prisma.agentUsage.groupBy({
      by: ["businessId"],
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      _count: { _all: true },
    }),
    prisma.agentUsage.groupBy({
      by: ["businessId"],
      where: { createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
    }),
    // One row per (business, conversation) this month → count rows per business
    // = distinct conversations the agent handled.
    prisma.agentUsage.groupBy({
      by: ["businessId", "conversationId"],
      where: { createdAt: { gte: monthStart }, conversationId: { not: null } },
    }),
    prisma.messageLog.groupBy({
      by: ["businessId"],
      where: { kind: { in: ["broadcast", "agent_broadcast"] }, createdAt: { gte: monthStart } },
      _count: { _all: true },
    }),
    prisma.business.findMany({ select: { id: true, name: true, tier: true } }),
  ]);

  const nameMap = new Map(businesses.map((b) => [b.id, b.name]));
  const tierMap = new Map(businesses.map((b) => [b.id, b.tier]));
  const monthCostMap = new Map(monthCost.map((g) => [g.businessId, g._sum.costUsd ?? 0]));
  const broadcastMap = new Map(broadcastRows.map((g) => [g.businessId, g._count._all]));
  const convoCountMap = new Map<string, number>();
  for (const r of convoRows) {
    convoCountMap.set(r.businessId, (convoCountMap.get(r.businessId) ?? 0) + 1);
  }

  // Any business with either agent usage (ever) or broadcasts (this month).
  const ids = new Set<string>([
    ...allTime.map((g) => g.businessId),
    ...broadcastRows.map((g) => g.businessId),
  ]);

  const rows = Array.from(ids)
    .map((id) => {
      const at = allTime.find((g) => g.businessId === id);
      const tier = tierMap.get(id) ?? "basic";
      const q = tierQuota(tier);
      return {
        businessId: id,
        name: nameMap.get(id) ?? "(עסק לא ידוע)",
        tier,
        tierLabel: tierLabel(tier),
        calls: at?._count._all ?? 0,
        inputTokens: at?._sum.inputTokens ?? 0,
        outputTokens: at?._sum.outputTokens ?? 0,
        costUsd: at?._sum.costUsd ?? 0,
        costUsdMonth: monthCostMap.get(id) ?? 0,
        conversations: convoCountMap.get(id) ?? 0,
        aiQuota: q.aiConversations,
        broadcasts: broadcastMap.get(id) ?? 0,
        broadcastQuota: q.broadcasts,
      };
    })
    .sort((a, b) => b.costUsdMonth - a.costUsdMonth);

  const totals = {
    costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
    costUsdMonth: rows.reduce((s, r) => s + r.costUsdMonth, 0),
    conversations: rows.reduce((s, r) => s + r.conversations, 0),
    broadcasts: rows.reduce((s, r) => s + r.broadcasts, 0),
    businesses: rows.length,
  };

  return NextResponse.json({ rows, totals });
}
