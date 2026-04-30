import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";
import { sendMessage, swapConfirmationText } from "@/lib/messaging";
import { timeToMinutes } from "@/lib/utils";

/**
 * POST /api/admin/swap-proposals/[id]/approve
 *
 * Executes the swap. Both appointments swap their (staffId, date, startTime,
 * endTime). The proposal is marked "approved"; sibling proposals (other
 * candidates for the same primary) are auto-cancelled. Confirmation
 * messages fire-and-forget to both customers.
 *
 * Idempotent: if the proposal is already `approved`, returns 400.
 */

const HEBREW_DATE_OPTS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
};
function hebDate(date: Date): string {
  return date.toLocaleDateString("he-IL", HEBREW_DATE_OPTS);
}
function minToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const proposal = await prisma.swapProposal.findUnique({
    where: { id: params.id },
    include: {
      primary:   { include: { customer: true, staff: true, service: true } },
      candidate: { include: { customer: true, staff: true, service: true } },
    },
  });
  if (!proposal) return NextResponse.json({ error: "הצעה לא נמצאה" }, { status: 404 });

  if (proposal.status !== "accepted_by_customer") {
    return NextResponse.json(
      { error: "ניתן לאשר רק הצעה שהלקוח כבר אישר" },
      { status: 400 }
    );
  }

  const business = await prisma.business.findUnique({ where: { id: proposal.businessId } });
  if (!business) return NextResponse.json({ error: "no business" }, { status: 500 });

  const p = proposal.primary;
  const c = proposal.candidate;

  // Compute swapped slot details. Each appointment KEEPS its own service
  // (and therefore its own duration) — only the (staff, date, startTime) move.
  const pDur = timeToMinutes(p.endTime) - timeToMinutes(p.startTime);
  const cDur = timeToMinutes(c.endTime) - timeToMinutes(c.startTime);

  // After swap: primary moves into candidate's slot
  const newPrimary = {
    staffId:   c.staffId,
    date:      c.date,
    startTime: c.startTime,
    endTime:   minToTime(timeToMinutes(c.startTime) + pDur),
  };
  // Candidate moves into primary's slot
  const newCandidate = {
    staffId:   p.staffId,
    date:      p.date,
    startTime: p.startTime,
    endTime:   minToTime(timeToMinutes(p.startTime) + cDur),
  };

  // Atomic swap + bookkeeping
  await prisma.$transaction([
    prisma.appointment.update({
      where: { id: p.id },
      data:  newPrimary,
    }),
    prisma.appointment.update({
      where: { id: c.id },
      data:  newCandidate,
    }),
    prisma.swapProposal.update({
      where: { id: proposal.id },
      data:  { status: "approved", approvedAt: new Date() },
    }),
    // Cancel sibling proposals — other candidates for the same primary
    prisma.swapProposal.updateMany({
      where: {
        primaryAppointmentId: p.id,
        status: { in: ["pending_response", "accepted_by_customer"] },
        id: { not: proposal.id },
      },
      data: { status: "cancelled" },
    }),
  ]);

  // ── Send confirmations (fire-and-forget) ──
  // For each customer, the "new" slot is the OTHER appointment's old slot.
  // Pull staff names by id (one query, both staff).
  const staffIds = Array.from(new Set([p.staffId, c.staffId]));
  const staffRecords = await prisma.staff.findMany({
    where: { id: { in: staffIds } },
    select: { id: true, name: true },
  });
  const staffNameById = new Map(staffRecords.map(s => [s.id, s.name]));

  // Primary customer gets the slot that USED to be candidate's
  const primaryConfirm = swapConfirmationText({
    customerName:   p.customer.name,
    businessName:   business.name,
    newDateLabel:   hebDate(newPrimary.date),
    newTime:        newPrimary.startTime,
    newStaffName:   staffNameById.get(newPrimary.staffId) || p.staff.name,
    serviceName:    p.service.name,
  });
  // Candidate customer gets the slot that USED to be primary's
  const candidateConfirm = swapConfirmationText({
    customerName:   c.customer.name,
    businessName:   business.name,
    newDateLabel:   hebDate(newCandidate.date),
    newTime:        newCandidate.startTime,
    newStaffName:   staffNameById.get(newCandidate.staffId) || c.staff.name,
    serviceName:    c.service.name,
  });

  // Fire-and-forget — don't block the response on WhatsApp delivery
  Promise.all([
    sendMessage({
      businessId: business.id,
      appointmentId: p.id,
      customerPhone: p.customer.phone,
      kind: "swap_confirmation",
      body: primaryConfirm,
    }),
    sendMessage({
      businessId: business.id,
      appointmentId: c.id,
      customerPhone: c.customer.phone,
      kind: "swap_confirmation",
      body: candidateConfirm,
    }),
  ]).catch(err => console.error("swap_confirmation send failed:", err));

  // Reload final state to return
  const [primaryFinal, candidateFinal] = await Promise.all([
    prisma.appointment.findUnique({
      where: { id: p.id },
      include: { customer: true, staff: true, service: true },
    }),
    prisma.appointment.findUnique({
      where: { id: c.id },
      include: { customer: true, staff: true, service: true },
    }),
  ]);

  return NextResponse.json({ ok: true, primary: primaryFinal, candidate: candidateFinal });
}
