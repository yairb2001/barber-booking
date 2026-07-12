import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

// GET /api/admin/qa/suggestions — QA suggestions for the owner's business.
// Pending first, then recently-resolved (last 7 days) for history.
export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await prisma.qaSuggestion.findMany({
    where: {
      businessId: session.businessId,
      OR: [{ status: "pending" }, { resolvedAt: { gte: weekAgo } }],
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  const pending = rows.filter(r => r.status === "pending")
    .sort((a, b) => (rank[a.severity] ?? 1) - (rank[b.severity] ?? 1));
  const resolved = rows.filter(r => r.status !== "pending");

  return NextResponse.json({ pending, resolved });
}
