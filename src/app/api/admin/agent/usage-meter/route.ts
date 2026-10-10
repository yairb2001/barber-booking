import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { tokenBudgetState, currentMonth } from "@/lib/agent/token-budget";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/agent/usage-meter — the owner's agent meter.
 * A percentage of this month's package plus what the agent did with it
 * (conversations answered, appointments it booked). No tokens and no money
 * (10.10.2026, Yair): token counts can be converted back to our cost.
 */
export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  const s = await tokenBudgetState(biz.id);
  const { start } = currentMonth();
  const [conversations, agentBookings] = await Promise.all([
    prisma.conversation.count({ where: { businessId: biz.id, agentType: { not: "owner" }, messages: { some: { role: "assistant", source: "agent", createdAt: { gte: start } } } } }),
    prisma.appointment.count({ where: { businessId: biz.id, source: "agent", createdAt: { gte: start } } }),
  ]);
  const [y, m] = s.month.split("-").map(Number);
  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("he-IL", { month: "long", timeZone: "UTC" });
  return NextResponse.json({ month: s.month, monthLabel, pct: Math.min(100, Math.round(s.pct)), level: s.level, conversations, agentBookings });
}
