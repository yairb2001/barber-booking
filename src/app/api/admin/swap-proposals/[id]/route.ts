import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";

/**
 * PATCH /api/admin/swap-proposals/[id]
 *
 * Admin manually updates a single proposal's state (until full bot integration).
 *
 * Body: { action: "mark_accepted" | "mark_rejected" | "cancel", rawResponse?: string }
 *
 *   mark_accepted → customer said yes (the proposal is now ready for admin approval)
 *   mark_rejected → customer said no (the proposal is closed; admin can pick another candidate)
 *   cancel        → admin cancels the proposal manually (e.g., not relevant anymore)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const rawResponse: string | null = typeof body?.rawResponse === "string" ? body.rawResponse : null;

  if (!["mark_accepted", "mark_rejected", "cancel"].includes(action)) {
    return NextResponse.json({ error: "פעולה לא חוקית" }, { status: 400 });
  }

  const proposal = await prisma.swapProposal.findUnique({ where: { id: params.id } });
  if (!proposal) {
    return NextResponse.json({ error: "הצעה לא נמצאה" }, { status: 404 });
  }

  // Block actions on already-finalized proposals
  const FINAL = ["approved", "cancelled", "expired", "rejected_by_customer"];
  if (FINAL.includes(proposal.status)) {
    return NextResponse.json(
      { error: `ההצעה כבר במצב סופי (${proposal.status})` },
      { status: 400 }
    );
  }
  // mark_accepted / mark_rejected only allowed from pending_response
  if (action !== "cancel" && proposal.status !== "pending_response") {
    return NextResponse.json(
      { error: "ניתן לסמן תשובה רק כשההצעה במצב 'ממתין לתשובה'" },
      { status: 400 }
    );
  }

  const now = new Date();
  let newStatus: string;
  if (action === "mark_accepted") newStatus = "accepted_by_customer";
  else if (action === "mark_rejected") newStatus = "rejected_by_customer";
  else newStatus = "cancelled";

  const updated = await prisma.swapProposal.update({
    where: { id: params.id },
    data: {
      status: newStatus,
      respondedAt: action === "cancel" ? proposal.respondedAt : now,
      rawResponse: rawResponse ?? proposal.rawResponse,
    },
    include: {
      primary:   { include: { customer: true, staff: true, service: true } },
      candidate: { include: { customer: true, staff: true, service: true } },
    },
  });

  return NextResponse.json(updated);
}

/** DELETE /api/admin/swap-proposals/[id] — hard delete (admin cleanup). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = requireOwner(req);
  if (guard) return guard;

  await prisma.swapProposal.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
