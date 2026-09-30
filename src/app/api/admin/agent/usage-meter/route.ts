import { NextRequest, NextResponse } from "next/server";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { tokenBudgetState, fmtTokens } from "@/lib/agent/token-budget";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/agent/usage-meter — the owner's token meter (stage 1, §4).
 * Tokens only: "נוצלו X מתוך Y" + percent + state. No money, no cost.
 */
export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  const s = await tokenBudgetState(biz.id);
  const [y, m] = s.month.split("-").map(Number);
  const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("he-IL", { month: "long", timeZone: "UTC" });
  return NextResponse.json({
    month: s.month, monthLabel,
    usedTokens: s.usedTokens, packageTokens: s.packageTokens,
    usedLabel: fmtTokens(s.usedTokens), packageLabel: fmtTokens(s.packageTokens),
    pct: Math.min(100, Math.round(s.pct)), level: s.level,
  });
}
