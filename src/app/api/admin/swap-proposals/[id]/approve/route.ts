import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnerOrSubManager, getRequestSession } from "@/lib/session";
import { executeApprovedProposal } from "@/lib/appointments/swap-exec";

/**
 * POST /api/admin/swap-proposals/[id]/approve
 *
 * Executes a customer-accepted proposal. Two paths (kind="swap" trades two
 * appointments, kind="move" relocates one). The heavy lifting lives in the
 * shared executor so the WhatsApp agent flow uses the exact same code path.
 *
 * Idempotent: if the proposal isn't in "accepted_by_customer", returns 400.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireOwnerOrSubManager(req);
  if (guard) return guard;

  // Tenant isolation: never approve/execute another business's proposal.
  const session = getRequestSession(req)!;
  const proposal = await prisma.swapProposal.findUnique({
    where: { id: params.id },
    select: { businessId: true },
  });
  if (!proposal) return NextResponse.json({ error: "הצעה לא נמצאה" }, { status: 404 });
  if (proposal.businessId !== session.businessId) {
    return NextResponse.json({ error: "אין הרשאה למשאב זה" }, { status: 403 });
  }

  const result = await executeApprovedProposal(params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }
  return result.kind === "swap"
    ? NextResponse.json({ ok: true, kind: "swap", primary: result.primary, candidate: result.candidate })
    : NextResponse.json({ ok: true, kind: "move", primary: result.primary });
}
