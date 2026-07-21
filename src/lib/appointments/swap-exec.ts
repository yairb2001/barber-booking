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
import { sendMessage, swapConfirmationText, appointmentMovedText, firstName } from "@/lib/messaging";
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
  | { ok: true; kind: "move" | "swap" | "cancel"; primary: unknown; candidate?: unknown }
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

  // ── kind: "cancel" — cancel the primary appointment, no relocation ──────
  if (proposal.kind === "cancel") {
    try {
      await prisma.$transaction([
        prisma.appointment.update({
          where: { id: p.id },
          data: { status: "cancelled_by_staff", cancelledAt: new Date() },
        }),
        prisma.swapProposal.update({
          where: { id: proposal.id },
          data: { status: "approved", approvedAt: new Date() },
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
    } catch (err) {
      console.error("[swap-exec] cancel transaction failed:", err);
      return { ok: false, error: "לא ניתן היה לבטל את התור", status: 409 };
    }
    const text =
      `היי ${firstName(p.customer.name)}, התור שלך ב-${business.name} ל-${hebDate(p.date)} ` +
      `בשעה ${p.startTime} בוטל. מוזמן/ת לתאם תור חדש מתי שנוח 🙏`;
    await recordInConversation(proposal.requesterConversationId, text);
    try {
      await sendMessage({
        businessId: business.id,
        appointmentId: p.id,
        customerPhone: p.customer.phone,
        kind: "swap_cancelled",
        body: text,
      });
    } catch (err) {
      console.error("[swap-exec] cancel confirmation send FAILED:", err);
    }
    return { ok: true, kind: "cancel", primary: p };
  }

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

    try {
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
    } catch (err) {
      // Most likely a unique-violation (P2002) from the partial active-slot index
      // — the target slot was taken between proposal and execution. Return a
      // clean failure so callers can apologize; never throw (a throw would let
      // the webhook fall back to the context-less agent).
      console.error("[swap-exec] move transaction failed:", err);
      return { ok: false, error: "לא ניתן היה לבצע את ההעברה — ייתכן שהשעה נתפסה בינתיים", status: 409 };
    }

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

  // ⚠️ A swap trades two appointments INTO each other's slots. With the partial
  // unique index on (staff_id, date, start_time) WHERE status active, a naive
  // two-step update trips P2002: after moving the primary into the candidate's
  // slot, the candidate is momentarily still sitting in that same slot. So we
  // first "park" the candidate at a sentinel date (1970) that no real
  // appointment occupies, then move the primary in, then move the candidate to
  // its final slot. All inside one transaction → atomic and rollback-safe.
  const PARK_DATE = new Date(0); // 1970-01-01 — guaranteed-free sentinel slot
  try {
    await prisma.$transaction([
      prisma.appointment.update({ where: { id: c.id }, data: { date: PARK_DATE } }),
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
  } catch (err) {
    // Slot taken between proposal and execution (P2002) or any other DB error —
    // fail cleanly so callers apologize; never throw (would leak to the agent).
    console.error("[swap-exec] swap transaction failed:", err);
    return { ok: false, error: "לא ניתן היה לבצע את ההחלפה — ייתכן שאחת השעות נתפסה בינתיים", status: 409 };
  }

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
