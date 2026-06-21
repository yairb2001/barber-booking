/**
 * Shared executor for an ACCEPTED swap/move proposal.
 *
 * One source of truth for the money-path (relocating / trading real
 * appointments) used by BOTH:
 *   - the admin calendar approve route (POST /api/admin/swap-proposals/[id]/approve)
 *   - the WhatsApp agent flow (candidate replied "כן" → execute automatically)
 *
 * Precondition: the proposal's status is already "accepted_by_customer".
 * On success it sets status="approved", cancels sibling proposals of the same
 * primary, sends WhatsApp confirmations, and returns the final appointment rows.
 */

import { prisma } from "@/lib/prisma";
import { sendMessage, swapConfirmationText, appointmentMovedText } from "@/lib/messaging";
import { timeToMinutes } from "@/lib/utils";

const HEBREW_DATE_OPTS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
};
function hebDate(date: Date): string {
  return date.toLocaleDateString("he-IL", { ...HEBREW_DATE_OPTS, timeZone: "Asia/Jerusalem" });
}
function minToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Mirror an outgoing confirmation into the requester's agent conversation so
 * the chat thread stays coherent (the final "done!" shows in /admin/chats and
 * in the customer's view of the thread). No-op when there's no conversation
 * (e.g. admin-created proposals). Errors are logged, never thrown.
 */
async function recordInConversation(conversationId: string | null, text: string): Promise<void> {
  if (!conversationId) return;
  try {
    await prisma.conversationMessage.create({
      data: { conversationId, role: "assistant", content: text },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });
  } catch (err) {
    console.error("[swap-exec] failed to record confirmation in conversation:", err);
  }
}

export type ExecResult =
  | { ok: true; kind: "move" | "swap"; primary: unknown; candidate?: unknown }
  | { ok: false; error: string; status?: number };

/**
 * Execute a proposal that the customer already accepted.
 * Idempotent-ish: refuses anything not in "accepted_by_customer".
 */
export async function executeApprovedProposal(proposalId: string): Promise<ExecResult> {
  const proposal = await prisma.swapProposal.findUnique({
    where: { id: proposalId },
    include: {
      primary:   { include: { customer: true, staff: true, service: true } },
      candidate: { include: { customer: true, staff: true, service: true } },
    },
  });
  if (!proposal) return { ok: false, error: "הצעה לא נמצאה", status: 404 };
  if (proposal.status !== "accepted_by_customer") {
    return { ok: false, error: "ניתן לאשר רק הצעה שהלקוח כבר אישר", status: 400 };
  }

  const business = await prisma.business.findUnique({ where: { id: proposal.businessId } });
  if (!business) return { ok: false, error: "no business", status: 500 };

  const p = proposal.primary;

  // ── kind: "move" — relocate primary, no second appointment involved ─────
  if (proposal.kind === "move") {
    if (!proposal.targetStaffId || !proposal.targetDate || !proposal.targetStartTime) {
      return { ok: false, error: "נתוני יעד חסרים בהצעה", status: 500 };
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
      prisma.swapProposal.updateMany({
        where: {
          primaryAppointmentId: p.id,
          status: { in: ["pending_response", "accepted_by_customer", "pending_staff_approval", "queued_next"] },
          id: { not: proposal.id },
        },
        data: { status: "cancelled" },
      }),
    ]);

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
    // Mirror into the requester's agent chat so the thread stays coherent
    // (otherwise it looks like the agent went silent after "I'm checking").
    await recordInConversation(proposal.requesterConversationId, text);
    // Awaited + logged so a send failure is visible (was fire-and-forget).
    try {
      await sendMessage({
        businessId: business.id,
        appointmentId: p.id,
        customerPhone: p.customer.phone,
        kind: "appointment_moved",
        body: text,
      });
    } catch (err) {
      console.error("[swap-exec] move confirmation send FAILED:", err);
    }

    const primaryFinal = await prisma.appointment.findUnique({
      where: { id: p.id },
      include: { customer: true, staff: true, service: true },
    });
    return { ok: true, kind: "move", primary: primaryFinal };
  }

  // ── kind: "swap" — trade with candidate appointment ─────────────────────
  if (!proposal.candidate) return { ok: false, error: "מועמד החלפה חסר", status: 500 };
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
        status: { in: ["pending_response", "accepted_by_customer", "pending_staff_approval", "queued_next"] },
        id: { not: proposal.id },
      },
      data: { status: "cancelled" },
    }),
  ]);

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

  // Requester (primary): mirror the confirmation into their agent chat thread,
  // then send via WhatsApp. Awaited + logged individually so one failure doesn't
  // silently swallow the other and so failures are actually visible.
  await recordInConversation(proposal.requesterConversationId, primaryConfirm);
  try {
    await sendMessage({
      businessId: business.id,
      appointmentId: p.id,
      customerPhone: p.customer.phone,
      kind: "swap_confirmation",
      body: primaryConfirm,
    });
  } catch (err) {
    console.error("[swap-exec] primary swap confirmation send FAILED:", err);
  }
  // Candidate (the customer who agreed to give up their slot).
  try {
    await sendMessage({
      businessId: business.id,
      appointmentId: c.id,
      customerPhone: c.customer.phone,
      kind: "swap_confirmation",
      body: candidateConfirm,
    });
  } catch (err) {
    console.error("[swap-exec] candidate swap confirmation send FAILED:", err);
  }

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

  return { ok: true, kind: "swap", primary: primaryFinal, candidate: candidateFinal };
}
