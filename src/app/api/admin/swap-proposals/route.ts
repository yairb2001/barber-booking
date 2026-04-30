import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";

/**
 * GET /api/admin/swap-proposals
 *
 * Query params:
 *   - primaryAppointmentId: filter by a specific primary appt
 *   - status:
 *       - "open"   → status IN (pending_response, accepted_by_customer)
 *       - "<exact>" → exact match on status
 *       - omitted  → defaults to "open"
 *
 * Used by the calendar to render visual badges on appointments that are
 * involved in active swap flows.
 */
export const dynamic = "force-dynamic";

const OPEN_STATUSES = ["pending_response", "accepted_by_customer"];

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const { searchParams } = new URL(req.url);
  const primaryAppointmentId = searchParams.get("primaryAppointmentId");
  const statusFilter = searchParams.get("status") || "open";

  const where: Record<string, unknown> = {};
  if (statusFilter === "open") {
    where.status = { in: OPEN_STATUSES };
  } else {
    where.status = statusFilter;
  }
  if (primaryAppointmentId) {
    where.primaryAppointmentId = primaryAppointmentId;
  }

  const proposals = await prisma.swapProposal.findMany({
    where,
    include: {
      primary:   { include: { customer: true, staff: true, service: true } },
      candidate: { include: { customer: true, staff: true, service: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(proposals);
}
