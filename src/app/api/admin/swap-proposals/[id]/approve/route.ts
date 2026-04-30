import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";
import { sendMessage, swapConfirmationText, appointmentMovedText } from "@/lib/messaging";
import { timeToMinutes } from "@/lib/utils";

/**
 * POST /api/admin/swap-proposals/[id]/approve
 *
 * Executes a customer-accepted proposal. Two paths:
 *   - kind="swap": both appointments swap (staff/date/startTime/endTime) atomically;
 *                  confirmation messages fire to both customers.
 *   - kind="move": primary appointment relocates to the empty target slot;
 *                  one confirmation goes to primary's customer.
 *
 * Sibling proposals (other candidates of the same primary) are auto-cancelled.
 *
 * Idempotent: if proposal already approved/cancelled/expired, returns 400.
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
    return NextResponse.json({ error: "ניתן לאשר רק הצעה שהלקוח כבר אישר" }, { status: 400 });
  }

  const business = await prisma.business.findUnique({ where: { id: proposal.businessId } });
  if (!business) return NextResponse.json({ error: "no business" }, { status: 500 });

  const p = proposal.primary;

  // ── kind: "move" — relocate primary, no second appointment involved ─────
  if (proposal.kind === "move") {
    if (!proposal.targetStaffId || !proposal.targetDate || !proposal.targetStartTime) {
      return NextResponse.json({ error: "נתוני יעד חסרים בהצעה" }, { status: 500 });
    }
    const pDur = timeToMinutes(p.endTime) - timeToMinutes(p.startTime);
    const newPrimary = {
      staffId:   proposal.targetStaffId,
      date:      proposal.targetDate,
      startTime: proposal.targetStartTime,
      endTime:   minToTime(timeToMinutes(proposal.targetStartTime) + pDur),
    };

    await prisma.$transaction([
      prisma.appointment.update({ where: { id: p.id }, data: newPrimary }),
      prisma.swapProposal.update({
        where: { id: proposal.id },
        data:  { status: "approved", approvedAt: new Date() },
      }),
      // Cancel sibling proposals of this primary
      prisma.swapProposal.updateMany({
        where: {
          primaryAppointmentId: p.id,
          status: { in: ["pending_response", "accepted_by_customer"] },
          id: { not: proposal.id },
        },
        data: { status: "cancelled" },
      }),
    ]);

    // Confirmation to primary's customer (reuses appointment_moved template)
    const newStaff = await prisma.staff.findUnique({
      where: { id: newPrimary.staffId },
      select: { name: true },
    });
    const text = appointmentMovedText({
      customerName: p.customer.name,
      businessName: business.name,
      newDateLabel: hebDate(newPrimary.date),
      newTime: newPrimary.startTime,
      newStaffName: newStaff?.name || p.staff.name,
      serviceName: p.service.name,
    }, business.appointmentMovedTemplate);
    sendMessage({
      businessId: business.id,
      appointmentId: p.id,
      customerPhone: p.customer.phone,
      kind: "appointment_moved",
      body: text,
    }).catch(err => console.error("move_confirmation send failed:", err));

    const primaryFinal = await prisma.appointment.findUnique({
      where: { id: p.id },
      include: { customer: true, staff: true, service: true },
    });
    return NextResponse.json({ ok: true, kind: "move", primary: primaryFinal });
  }

  // ── kind: "swap" — trade with candidate appointment ─────────────────────
  if (!proposal.candidate) {
    return NextResponse.json({ error: "מועמד החלפה חסר" }, { status: 500 });
  }
  const c = proposal.candidate;
  const pDur = timeToMinutes(p.endTime) - timeToMinutes(p.startTime);
  const cDur = timeToMinutes(c.endTime) - timeToMinutes(c.startTime);

  const newPrimary = {
    staffId:   c.staffId,
    date:      c.date,
    startTime: c.startTime,
    endTime:   minToTime(timeToMinutes(c.startTime) + pDur),
  };
  const newCandidate = {
    staffId:   p.staffId,
    date:      p.date,
    startTime: p.startTime,
    endTime:   minToTime(timeToMinutes(p.startTime) + cDur),
  };

  await prisma.$transaction([
    prisma.appointment.update({ where: { id: p.id }, data: newPrimary }),
    prisma.appointment.update({ where: { id: c.id }, data: newCandidate }),
    prisma.swapProposal.update({
      where: { id: proposal.id },
      data:  { status: "approved", approvedAt: new Date() },
    }),
    prisma.swapProposal.updateMany({
      where: {
        primaryAppointmentId: p.id,
        status: { in: ["pending_response", "accepted_by_customer"] },
        id: { not: proposal.id },
      },
      data: { status: "cancelled" },
    }),
  ]);

  // Both customers get a confirmation with their new slot
  const staffIds = Array.from(new Set([p.staffId, c.staffId]));
  const staffRecords = await prisma.staff.findMany({
    where: { id: { in: staffIds } },
    select: { id: true, name: true },
  });
  const staffNameById = new Map(staffRecords.map(s => [s.id, s.name]));

  const primaryConfirm = swapConfirmationText({
    customerName: p.customer.name,
    businessName: business.name,
    newDateLabel: hebDate(newPrimary.date),
    newTime:      newPrimary.startTime,
    newStaffName: staffNameById.get(newPrimary.staffId) || p.staff.name,
    serviceName:  p.service.name,
  }, business.swapConfirmationTemplate);
  const candidateConfirm = swapConfirmationText({
    customerName: c.customer.name,
    businessName: business.name,
    newDateLabel: hebDate(newCandidate.date),
    newTime:      newCandidate.startTime,
    newStaffName: staffNameById.get(newCandidate.staffId) || c.staff.name,
    serviceName:  c.service.name,
  }, business.swapConfirmationTemplate);

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

  return NextResponse.json({ ok: true, kind: "swap", primary: primaryFinal, candidate: candidateFinal });
}
