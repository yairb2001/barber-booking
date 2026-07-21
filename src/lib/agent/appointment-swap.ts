/**
 * Agent-driven appointment MOVE / SWAP orchestration.
 * ───────────────────────────────────────────────────
 * Lets the WhatsApp customer agent move a customer's appointment to a time they
 * asked for, with the least possible disturbance to everyone else. Priority
 * order (decided with the owner):
 *
 *   1. Free slot at the SAME barber → relocate in place. Bother no one.
 *   2. Customer doesn't care which barber (or is new) → relocate to any FREE
 *      barber at that time, silently. Still bother no one.
 *   3. No free slot anywhere near the time → ask the barber (per-request) for
 *      permission to "bother" another customer. If the barber says כן, contact
 *      up to 2 customers who hold that exact slot, SEQUENTIALLY. The first to
 *      agree gets swapped. If the barber doesn't answer within 2h, give up.
 *
 * The heavy lifting is in code (this module) + the webhook reply router, not in
 * the prompt — the agent only calls one tool, `request_appointment_move`.
 *
 * All async hand-offs are tracked as SwapProposal rows (initiatedBy="agent").
 * There is no cron: expiry is lazy (`expireStaleAgentSwaps` runs on every
 * inbound webhook for the business).
 */

import { prisma } from "@/lib/prisma";
import { sendMessage, swapProposalText, firstName } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { computeDayAvailability, resolveStaffService } from "@/lib/agent/availability";
import { executeApprovedProposal } from "@/lib/appointments/swap-exec";
import { timeToMinutes, getBusinessNow } from "@/lib/utils";
import { pushToOwner } from "@/lib/native/push";

// Hebrew label for a change-request kind (used in owner alerts).
function kindLabelHe(kind: string): string {
  return kind === "move" ? "העברה" : kind === "cancel" ? "ביטול" : "החלפה";
}

// 2-hour windows: barber approval AND each candidate contact.
const APPROVAL_TTL_MS = 2 * 60 * 60 * 1000;

// SwapProposal statuses that mean "an agent swap flow is live for this primary".
const LIVE_STATUSES = ["pending_staff_approval", "pending_response", "queued_next", "accepted_by_customer"];

function hebDate(date: Date): string {
  return date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
}
function dateOnly(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function computeEndTime(date: string, start: string, durationMin: number): string {
  const startDT = new Date(`${date}T${start}:00.000Z`);
  return new Date(startDT.getTime() + durationMin * 60_000).toISOString().slice(11, 16);
}
/**
 * Pick the `n` free slots closest to a target time (by absolute minute
 * distance), then return them in chronological order. Used to offer the
 * customer the nearest AVAILABLE alternatives before bothering anyone.
 */
function nearestSlots(slots: string[], target: string, n = 3): string[] {
  const t = timeToMinutes(target);
  return [...slots]
    .sort((a, b) => Math.abs(timeToMinutes(a) - t) - Math.abs(timeToMinutes(b) - t))
    .slice(0, n)
    .sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
}

/** Robust-enough Hebrew yes/no detection for short WhatsApp replies. */
export function parseYesNo(text: string): "yes" | "no" | "unclear" {
  const t = (text || "").trim().toLowerCase();
  if (!t) return "unclear";
  // Check "no" first — a "no" reply must never be misread as "yes".
  const no = ["לא רוצה", "לא מתאים", "לא יכול", "אי אפשר", "ממש לא", "לצערי לא", "לא,", "לא ", "לא.", "no", "❌", "👎"];
  const yes = ["כן", "בטח", "אישור", "מאשר", "מסכים", "סבבה", "אוקיי", "אוקי", "יאללה", "אפשר", "בסדר גמור", "אין בעיה", "ok", "okay", "yes", "👍", "✅", "👌"];
  for (const n of no) if (t.includes(n)) return "no";
  if (t === "לא") return "no";
  for (const y of yes) if (t.includes(y)) return "yes";
  return "unclear";
}

/** Notify the customer who ASKED for the move, through their conversation. */
async function notifyRequester(
  bizId: string,
  conversationId: string | null,
  phone: string,
  text: string,
): Promise<void> {
  if (conversationId) {
    await prisma.conversationMessage.create({
      data: { conversationId, role: "assistant", content: text },
    }).catch(() => {});
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    }).catch(() => {});
  }
  await sendMessage({ businessId: bizId, customerPhone: phone, kind: "agent_reply", body: text }).catch(() => {});
}

/** Find up to 2 OTHER customers' appointments occupying a specific slot. */
async function gatherCandidates(
  bizId: string,
  staffId: string,
  targetDate: Date,
  targetStartTime: string,
  excludeCustomerId: string,
) {
  return prisma.appointment.findMany({
    where: {
      businessId: bizId,
      staffId,
      date: targetDate,
      startTime: targetStartTime,
      status: { in: ["pending", "confirmed"] },
      customerId: { not: excludeCustomerId },
    },
    orderBy: { createdAt: "asc" },
    take: 2,
    include: { customer: true, staff: true, service: true },
  });
}

/** Send the swap question to a candidate customer for a given proposal row. */
async function messageCandidate(proposalId: string): Promise<void> {
  const proposal = await prisma.swapProposal.findUnique({
    where: { id: proposalId },
    include: {
      business: { select: { name: true, swapProposalTemplate: true } },
      primary:   { include: { customer: true, staff: true, service: true } },
      candidate: { include: { customer: true, staff: true, service: true } },
    },
  });
  if (!proposal?.candidate || !proposal.primary) return;
  const c = proposal.candidate;
  const p = proposal.primary;
  const body = swapProposalText({
    candidateName:     c.customer.name,
    businessName:      proposal.business.name,
    candidateDateLabel: hebDate(c.date),
    candidateTime:     c.startTime,
    primaryDateLabel:  hebDate(p.date),
    primaryTime:       p.startTime,
    primaryStaffName:  p.staff.name,
  }, proposal.business.swapProposalTemplate);
  await sendMessage({
    businessId: proposal.businessId,
    appointmentId: c.id,
    customerPhone: c.customer.phone,
    kind: "swap_proposal",
    body,
  }).catch(err => console.error("[agent-swap] candidate message failed", err));
}

/**
 * Promote the next reserved candidate (queued_next → pending_response) for a
 * primary and message them. Returns true if a candidate was promoted.
 */
async function promoteNextCandidate(primaryAppointmentId: string): Promise<boolean> {
  const next = await prisma.swapProposal.findFirst({
    where: { primaryAppointmentId, status: "queued_next", initiatedBy: "agent" },
    orderBy: { createdAt: "asc" },
  });
  if (!next) return false;
  await prisma.swapProposal.update({
    where: { id: next.id },
    data: { status: "pending_response", expiresAt: new Date(Date.now() + APPROVAL_TTL_MS) },
  });
  await messageCandidate(next.id);
  return true;
}

/** No (more) candidate accepted — tell the requester their appt stays put. */
async function finishUnsuccessful(primaryAppointmentId: string): Promise<void> {
  // Cancel any leftover reserved candidates for this primary.
  await prisma.swapProposal.updateMany({
    where: { primaryAppointmentId, status: { in: ["pending_response", "queued_next", "pending_staff_approval"] }, initiatedBy: "agent" },
    data: { status: "cancelled" },
  });
  const any = await prisma.swapProposal.findFirst({
    where: { primaryAppointmentId, initiatedBy: "agent" },
    orderBy: { createdAt: "desc" },
    include: { primary: { include: { customer: true } } },
  });
  if (!any?.primary) return;
  await notifyRequester(
    any.businessId,
    any.requesterConversationId,
    any.primary.customer.phone,
    `לא הצלחתי לארגן החלפה לשעה שביקשת, אז התור הקיים שלך נשאר כרגיל. רוצה שאחפש לך זמן פנוי אחר?`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) Tool entry: the agent asks to move a customer's appointment.
// ─────────────────────────────────────────────────────────────────────────────

export async function requestAppointmentMove(opts: {
  bizId: string;
  conversationId: string;
  callerPhone: string;
  appointmentId: string;
  targetDate: string;       // YYYY-MM-DD
  targetStartTime: string;  // HH:MM
  allowOtherBarber?: boolean;
  insistExactTime?: boolean; // customer insists on the exact (taken) time → allow swap flow
}): Promise<string> {
  const { bizId, conversationId, callerPhone, appointmentId, targetDate, targetStartTime } = opts;
  const allowOtherBarber = !!opts.allowOtherBarber;
  const insistExactTime = !!opts.insistExactTime;

  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { customer: true, staff: true, service: true },
  });
  if (!appt || appt.businessId !== bizId) {
    return "לא מצאתי את התור הזה. קרא ל-check_appointment כדי לקבל את מזהה התור הנכון של הלקוח, ואז נסה שוב.";
  }
  if (["cancelled_by_customer", "cancelled_by_staff"].includes(appt.status)) {
    return "התור הזה כבר בוטל, אין מה להעביר.";
  }

  // Safety: the caller must be the owner of this appointment (same phone).
  const phone = normalizeIsraeliPhone(callerPhone);
  const localPhone = phone.replace(/^972/, "0");
  const custPhone = normalizeIsraeliPhone(appt.customer.phone);
  if (custPhone !== phone && custPhone !== normalizeIsraeliPhone(localPhone)) {
    return "התור הזה שייך ללקוח אחר — אי אפשר להעביר אותו מהשיחה הזו.";
  }

  // Same time/date as now? Nothing to do.
  const apptDateIso = new Date(appt.date).toISOString().slice(0, 10);
  if (apptDateIso === targetDate && appt.startTime === targetStartTime) {
    return "זה בדיוק הזמן של התור הקיים — אין צורך לשנות כלום.";
  }

  // Don't start a second flow if one is already live for this appointment.
  const live = await prisma.swapProposal.findFirst({
    where: { primaryAppointmentId: appt.id, status: { in: LIVE_STATUSES }, initiatedBy: "agent" },
  });
  if (live) {
    return "כבר יש בקשת העברה פעילה לתור הזה שמחכה לתשובה. אמור ללקוח שאתה עדיין בודק את זה ותעדכן אותו ברגע שיש תשובה — אל תפתח בקשה נוספת.";
  }

  const duration = timeToMinutes(appt.endTime) - timeToMinutes(appt.startTime);

  // ── Step 1: free slot at the SAME barber → relocate in place ───────────────
  const sameAvail = await computeDayAvailability(bizId, targetDate, appt.staffId, appt.serviceId);
  const sameSlots = sameAvail.find(s => s.staffId === appt.staffId)?.slots ?? [];
  if (sameSlots.includes(targetStartTime)) {
    await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        date: dateOnly(targetDate),
        startTime: targetStartTime,
        endTime: computeEndTime(targetDate, targetStartTime, duration),
      },
    });
    return `✅ העברתי את התור של ${firstName(appt.customer.name)} ל-${hebDate(dateOnly(targetDate))} בשעה ${targetStartTime} אצל ${appt.staff.name} (אותו ספר). אשר ללקוח שזה סודר.`;
  }

  // ── Step 2: customer doesn't mind the barber → any FREE barber, silently ───
  if (allowOtherBarber) {
    const allAvail = await computeDayAvailability(bizId, targetDate, undefined, appt.serviceId);
    const freeOther = allAvail.find(s => s.staffId !== appt.staffId && s.slots.includes(targetStartTime));
    if (freeOther) {
      const eff = await resolveStaffService(freeOther.staffId, appt.serviceId, appt.service.name, appt.service.durationMinutes, appt.price);
      await prisma.appointment.update({
        where: { id: appt.id },
        data: {
          staffId: freeOther.staffId,
          date: dateOnly(targetDate),
          startTime: targetStartTime,
          endTime: computeEndTime(targetDate, targetStartTime, eff.duration),
          price: eff.price,
        },
      });
      return `✅ העברתי את התור של ${firstName(appt.customer.name)} ל-${hebDate(dateOnly(targetDate))} בשעה ${targetStartTime} אצל ${freeOther.name}. אמור ללקוח שאצל ${appt.staff.name} לא היה פנוי באותה שעה, אז קבעתי אצל ${freeOther.name} — ושאל אם זה מתאים לו.`;
    }
  }

  // ── Step 2.5: exact slot taken → offer the CLOSEST FREE times first ────────
  // Don't bother the barber or another customer yet. Only when the customer
  // explicitly insists on the exact taken time (insistExactTime=true) do we fall
  // through to the swap-approval flow below.
  if (!insistExactTime) {
    const sameNearest = nearestSlots(sameSlots, targetStartTime);
    if (sameNearest.length) {
      return `❌ לא בוצעה העברה — אל תגיד ללקוח שהתור הועבר. השעה ${targetStartTime} לא פנויה אצל ${appt.staff.name}. הזמנים הפנויים הכי קרובים אצלו באותו יום: ${sameNearest.join(", ")}. הצע ללקוח את הזמנים האלה. אם הוא בוחר אחד מהם, קרא שוב ל-request_appointment_move עם השעה שבחר. רק אם הוא מתעקש דווקא על ${targetStartTime} (שלא פנוי), קרא שוב ל-request_appointment_move עם insistExactTime=true כדי שאבדוק אפשרות להחליף עם לקוח אחר.`;
    }
    if (allowOtherBarber) {
      const allAvail = await computeDayAvailability(bizId, targetDate, undefined, appt.serviceId);
      const otherFree = allAvail
        .filter(s => s.staffId !== appt.staffId && s.slots.length)
        .map(s => ({ name: s.name, slots: nearestSlots(s.slots, targetStartTime) }))
        .filter(s => s.slots.length);
      if (otherFree.length) {
        const lines = otherFree.map(s => `${s.name}: ${s.slots.join(", ")}`).join(" | ");
        return `❌ לא בוצעה העברה — אל תגיד ללקוח שהתור הועבר. השעה ${targetStartTime} לא פנויה אצל ${appt.staff.name}. זמנים פנויים קרובים אצל ספרים אחרים: ${lines}. הצע ללקוח את האפשרויות האלה. אם הוא בוחר אחת, קרא שוב ל-request_appointment_move עם allowOtherBarber=true והשעה שבחר. רק אם הוא מתעקש דווקא על ${targetStartTime} אצל ${appt.staff.name}, קרא שוב עם insistExactTime=true.`;
      }
    }
    // No free alternatives that day → still DON'T bother anyone. Offer another
    // day / barber. The swap flow only starts if the customer explicitly insists
    // on the exact taken time (insistExactTime=true).
    return `❌ לא בוצעה העברה — אל תגיד ללקוח שהתור הועבר. אין אף שעה פנויה ב-${hebDate(dateOnly(targetDate))} אצל ${appt.staff.name} (היום עמוס). אל תפתח בקשת החלפה. הצע ללקוח יום אחר קרוב (קרא ל-find_next_available) או שאל אם בא לו אצל ספר אחר. רק אם הלקוח מתעקש דווקא על ${targetStartTime} ב-${hebDate(dateOnly(targetDate))}, קרא שוב ל-request_appointment_move עם insistExactTime=true כדי שאבדוק אפשרות להחליף עם לקוח אחר.`;
  }

  // ── Master switch: swap offers disabled for this business ──────────────────
  // Some shops never want the agent to bump another customer. When off, we don't
  // even reveal that someone holds the slot — just steer to another time / barber
  // / waitlist. Checked only here (the sole entry to the swap flow).
  const swapCfg = await prisma.agentConfig.findUnique({
    where: { businessId: bizId },
    select: { allowSwapOffers: true },
  });
  if (swapCfg?.allowSwapOffers === false) {
    return `❌ לא בוצעה העברה — אל תגיד ללקוח שהתור הועבר. השעה ${targetStartTime} לא פנויה אצל ${appt.staff.name}. אל תזכיר שיש שם לקוח אחר ואל תציע החלפה. הצע ללקוח יום או שעה אחרים (קרא ל-find_next_available או get_available_slots), או הצע להירשם לרשימת המתנה עם join_waitlist.`;
  }

  // ── Step 3: customer INSISTS on the exact taken time → bother another customer (with approval) ─
  const candidates = await gatherCandidates(bizId, appt.staffId, dateOnly(targetDate), targetStartTime, appt.customerId);
  if (!candidates.length) {
    return `אין מקום פנוי בשעה ${targetStartTime} ב-${targetDate} אצל ${appt.staff.name}, וגם אין שם תור של לקוח אחר שאפשר להציע לו החלפה (כנראה הספר לא עובד אז, או זו הפסקה). אל תפתח בקשה — במקום זה הצע ללקוח את הזמן הפנוי הקרוב ביותר (קרא ל-get_available_slots לאותו יום) או שעה אחרת.`;
  }

  // Per-business setting: must the barber approve a swap before we bother
  // another customer? Default true (safe — preserves the legacy behaviour).
  const cfg = await prisma.agentConfig.findUnique({
    where: { businessId: bizId },
    select: { requireSwapApproval: true },
  });
  const requireApproval = cfg?.requireSwapApproval ?? true;

  // ── 3a: approval required → ask the barber first (no candidate contacted) ──
  if (requireApproval) {
    if (!appt.staff.phone) {
      return `כדי לבקש מלקוח אחר להחליף צריך לקבל אישור מ${appt.staff.name}, אבל אין לו מספר טלפון רשום במערכת ואי אפשר לפנות אליו. אל תפתח בקשה — הצע ללקוח זמן פנוי אחר במקום.`;
    }

    await prisma.swapProposal.create({
      data: {
        businessId: bizId,
        primaryAppointmentId: appt.id,
        kind: "swap",
        initiatedBy: "agent",
        requesterConversationId: conversationId,
        approvalStaffId: appt.staffId,
        targetStaffId: appt.staffId,
        targetDate: dateOnly(targetDate),
        targetStartTime,
        status: "pending_staff_approval",
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
      },
    });

    const targetLabel = `${hebDate(dateOnly(targetDate))} בשעה ${targetStartTime}`;
    const currentLabel = `${hebDate(new Date(appt.date))} בשעה ${appt.startTime}`;
    // Who is sitting in the requested slot today — so the barber knows exactly
    // which customer would be asked to give it up before approving.
    const occupantNames = Array.from(new Set(candidates.map(c => c.customer.name))).join(" / ");
    const approvalMsg =
      `🔔 בקשת החלפת תור\n` +
      `הלקוח שרוצה להחליף: ${appt.customer.name} (${appt.service.name})\n` +
      `התור הנוכחי שלו: ${currentLabel}\n` +
      `רוצה לעבור ל: ${targetLabel}\n` +
      `אבל השעה הזו תפוסה אצל: ${occupantNames}\n` +
      `אפשר להציע ל${occupantNames} להחליף? ענה כן או לא.`;
    await sendMessage({
      businessId: bizId,
      customerPhone: normalizeIsraeliPhone(appt.staff.phone),
      kind: "swap_staff_request",
      body: approvalMsg,
    }).catch(err => console.error("[agent-swap] staff approval send failed", err));

    return `אין מקום פנוי בשעה שביקש, אז שלחתי ל${appt.staff.name} בקשה לאשר החלפה עם לקוח אחר. אמור ללקוח שאתה בודק מול הספר אפשרות להחליף לשעה הזו ותעדכן אותו ברגע שיש תשובה — בלי להבטיח שזה סגור.`;
  }

  // ── 3b: no approval needed → contact the candidate customer(s) directly ────
  // Mirror the post-approval path: the first candidate gets the live
  // pending_response row, the rest are queued as fallbacks.
  const proposal = await prisma.swapProposal.create({
    data: {
      businessId: bizId,
      primaryAppointmentId: appt.id,
      kind: "swap",
      initiatedBy: "agent",
      requesterConversationId: conversationId,
      candidateAppointmentId: candidates[0].id,
      targetStaffId: appt.staffId,
      targetDate: dateOnly(targetDate),
      targetStartTime,
      status: "pending_response",
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    },
  });
  await messageCandidate(proposal.id);

  for (const extra of candidates.slice(1)) {
    await prisma.swapProposal.create({
      data: {
        businessId: bizId,
        primaryAppointmentId: appt.id,
        kind: "swap",
        initiatedBy: "agent",
        requesterConversationId: conversationId,
        candidateAppointmentId: extra.id,
        targetStaffId: appt.staffId,
        targetDate: dateOnly(targetDate),
        targetStartTime,
        status: "queued_next",
        expiresAt: new Date(Date.now() + 2 * APPROVAL_TTL_MS),
      },
    });
  }

  return `אין מקום פנוי בשעה שביקש, אז פניתי ישירות ללקוח שיש לו תור בשעה הזו לבדוק אם הוא מוכן להחליף. אמור ללקוח שאתה בודק מול לקוח אחר אפשרות להחליף לשעה הזו ותעדכן אותו ברגע שיש תשובה — בלי להבטיח שזה סגור.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Webhook: a BARBER replied to an approval request.
//    Returns true if the reply was consumed (don't run the booking agent).
// ─────────────────────────────────────────────────────────────────────────────

export async function handleStaffApprovalReply(
  bizId: string,
  fromPhone: string,
  text: string,
): Promise<boolean> {
  const phone = normalizeIsraeliPhone(fromPhone);
  const local = phone.replace(/^972/, "0");

  // Is the sender a staff member of this business with a live approval request?
  const staff = await prisma.staff.findFirst({
    where: { businessId: bizId, OR: [{ phone }, { phone: local }] },
    select: { id: true, name: true },
  });
  if (!staff) return false;

  const proposal = await prisma.swapProposal.findFirst({
    where: { businessId: bizId, approvalStaffId: staff.id, status: "pending_staff_approval", initiatedBy: "agent" },
    orderBy: { createdAt: "desc" },
    include: { primary: { include: { customer: true, staff: true, service: true } } },
  });
  if (!proposal || !proposal.primary) return false;

  // Expired (>2h)? Treat as a timeout and clean up.
  if (proposal.expiresAt.getTime() < Date.now()) {
    await prisma.swapProposal.update({ where: { id: proposal.id }, data: { status: "expired" } });
    await finishUnsuccessful(proposal.primaryAppointmentId);
    return true;
  }

  const ans = parseYesNo(text);
  if (ans === "unclear") {
    await sendMessage({
      businessId: bizId,
      customerPhone: phone,
      kind: "swap_staff_request",
      body: `לא הבנתי — לגבי ההחלפה של ${proposal.primary.customer.name}, ענה כן או לא בבקשה.`,
    }).catch(() => {});
    return true;
  }

  if (ans === "no") {
    await prisma.swapProposal.update({
      where: { id: proposal.id },
      data: { status: "staff_rejected", respondedAt: new Date(), rawResponse: text.slice(0, 500) },
    });
    await notifyRequester(
      bizId,
      proposal.requesterConversationId,
      proposal.primary.customer.phone,
      `בדקתי מול ${proposal.primary.staff.name} ולצערי אי אפשר להחליף לשעה שביקשת כרגע, אז התור הקיים שלך נשאר. רוצה שאחפש לך זמן פנוי אחר?`,
    );
    return true;
  }

  // ans === "yes" → contact candidates sequentially.
  await prisma.swapProposal.update({
    where: { id: proposal.id },
    data: { respondedAt: new Date(), rawResponse: text.slice(0, 500) },
  });

  if (!proposal.targetStaffId || !proposal.targetDate || !proposal.targetStartTime) {
    await finishUnsuccessful(proposal.primaryAppointmentId);
    return true;
  }

  const candidates = await gatherCandidates(
    bizId,
    proposal.targetStaffId,
    proposal.targetDate,
    proposal.targetStartTime,
    proposal.primary.customerId,
  );

  if (!candidates.length) {
    // Slot may have freed up since the request — try a clean in-place move.
    const iso = proposal.targetDate.toISOString().slice(0, 10);
    const avail = await computeDayAvailability(bizId, iso, proposal.targetStaffId, proposal.primary.serviceId);
    const slots = avail.find(s => s.staffId === proposal.targetStaffId)?.slots ?? [];
    if (slots.includes(proposal.targetStartTime)) {
      const dur = timeToMinutes(proposal.primary.endTime) - timeToMinutes(proposal.primary.startTime);
      await prisma.appointment.update({
        where: { id: proposal.primaryAppointmentId },
        data: {
          date: proposal.targetDate,
          startTime: proposal.targetStartTime,
          endTime: computeEndTime(iso, proposal.targetStartTime, dur),
        },
      });
      await prisma.swapProposal.update({ where: { id: proposal.id }, data: { status: "approved", approvedAt: new Date() } });
      await notifyRequester(
        bizId,
        proposal.requesterConversationId,
        proposal.primary.customer.phone,
        `התפנה מקום! העברתי את התור שלך ל-${hebDate(proposal.targetDate)} בשעה ${proposal.targetStartTime} אצל ${proposal.primary.staff.name}. נתראה!`,
      );
      return true;
    }
    await finishUnsuccessful(proposal.primaryAppointmentId);
    return true;
  }

  // Reuse THIS row for candidate #1, reserve the rest as queued_next.
  await prisma.swapProposal.update({
    where: { id: proposal.id },
    data: {
      status: "pending_response",
      candidateAppointmentId: candidates[0].id,
      approvalStaffId: null,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    },
  });
  await messageCandidate(proposal.id);

  for (const extra of candidates.slice(1)) {
    await prisma.swapProposal.create({
      data: {
        businessId: bizId,
        primaryAppointmentId: proposal.primaryAppointmentId,
        kind: "swap",
        initiatedBy: "agent",
        requesterConversationId: proposal.requesterConversationId,
        candidateAppointmentId: extra.id,
        targetStaffId: proposal.targetStaffId,
        targetDate: proposal.targetDate,
        targetStartTime: proposal.targetStartTime,
        status: "queued_next",
        expiresAt: new Date(Date.now() + 2 * APPROVAL_TTL_MS),
      },
    });
  }

  await notifyRequester(
    bizId,
    proposal.requesterConversationId,
    proposal.primary.customer.phone,
    `${proposal.primary.staff.name} אישר, ואני בודק עכשיו מול לקוח אחר אם הוא מוכן להחליף איתך לשעה הזו. אעדכן אותך ברגע שתהיה תשובה 🙏`,
  );
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) Webhook: a CANDIDATE customer replied to a swap proposal.
//    Returns true if the reply was consumed (don't run the booking agent).
// ─────────────────────────────────────────────────────────────────────────────

export async function handleCandidateReply(
  bizId: string,
  fromPhone: string,
  text: string,
): Promise<boolean> {
  const phone = normalizeIsraeliPhone(fromPhone);
  const local = phone.replace(/^972/, "0");

  // Find an agent-initiated proposal awaiting THIS customer's answer.
  const proposal = await prisma.swapProposal.findFirst({
    where: {
      businessId: bizId,
      status: "pending_response",
      initiatedBy: "agent",
      candidate: { customer: { OR: [{ phone }, { phone: local }] } },
    },
    orderBy: { createdAt: "desc" },
    include: {
      candidate: { include: { customer: true } },
      primary:   { include: { customer: true } },
    },
  });
  if (!proposal || !proposal.candidate) return false;

  // Expired (>2h)? Treat as no answer → move on to the next candidate.
  if (proposal.expiresAt.getTime() < Date.now()) {
    await prisma.swapProposal.update({ where: { id: proposal.id }, data: { status: "expired" } });
    const promoted = await promoteNextCandidate(proposal.primaryAppointmentId);
    if (!promoted) await finishUnsuccessful(proposal.primaryAppointmentId);
    return true;
  }

  const ans = parseYesNo(text);
  if (ans === "unclear") {
    await sendMessage({
      businessId: bizId,
      customerPhone: phone,
      kind: "swap_proposal",
      body: `רק שאדע — מתאים לך להחליף את התור? ענה כן או לא 🙏`,
    }).catch(() => {});
    return true;
  }

  if (ans === "no") {
    await prisma.swapProposal.update({
      where: { id: proposal.id },
      data: { status: "rejected_by_customer", respondedAt: new Date(), rawResponse: text.slice(0, 500) },
    });
    await sendMessage({
      businessId: bizId,
      customerPhone: phone,
      kind: "swap_proposal",
      body: `אין בעיה, תודה על התשובה! התור שלך נשאר כרגיל 🙏`,
    }).catch(() => {});
    const promoted = await promoteNextCandidate(proposal.primaryAppointmentId);
    if (!promoted) await finishUnsuccessful(proposal.primaryAppointmentId);
    return true;
  }

  // ans === "yes" → claim the row ATOMICALLY (see handleAdminProposalReply):
  // two racing "yes" replies must not both reach the money-path.
  const claim = await prisma.swapProposal.updateMany({
    where: { id: proposal.id, status: "pending_response" },
    data: { status: "accepted_by_customer", respondedAt: new Date(), rawResponse: text.slice(0, 500) },
  });
  if (claim.count === 0) return true; // a concurrent reply already claimed it
  const result = await executeApprovedProposal(proposal.id);
  if (!result.ok) {
    // Couldn't execute (slot changed under us) — apologize + try the next one.
    await prisma.swapProposal.update({ where: { id: proposal.id }, data: { status: "cancelled" } }).catch(() => {});
    await sendMessage({
      businessId: bizId,
      customerPhone: phone,
      kind: "swap_proposal",
      body: `תודה על הנכונות! בסוף ההחלפה כבר לא רלוונטית, אז התור שלך נשאר כרגיל 🙏`,
    }).catch(() => {});
    const promoted = await promoteNextCandidate(proposal.primaryAppointmentId);
    if (!promoted) await finishUnsuccessful(proposal.primaryAppointmentId);
    return true;
  }
  // Success: executeApprovedProposal already sent swap_confirmation to BOTH
  // customers (the requester included) and cancelled sibling proposals.
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b) Webhook: a customer replied to an ADMIN-initiated (MANUAL) swap/move.
//     The barber built the proposal from the calendar, so the agent never saw
//     the outgoing offer and can't understand a bare "כן". We intercept the
//     yes/no deterministically here, run the same money-path executor, and stop
//     — so the reply never reaches the context-less booking agent.
//       • swap → the CANDIDATE customer is the one answering.
//       • move → the PRIMARY customer (the one being relocated) is answering.
//     Unlike the agent flow there is NO candidate queue: for a multi-candidate
//     manual swap the admin route created one independent proposal per candidate,
//     so a "no" just closes that one row and the others stay open; the first
//     "yes" wins and executeApprovedProposal cancels the siblings.
//     Returns true if the reply was consumed (don't run the booking agent).
// ─────────────────────────────────────────────────────────────────────────────

export async function handleAdminProposalReply(
  bizId: string,
  fromPhone: string,
  text: string,
): Promise<boolean> {
  const phone = normalizeIsraeliPhone(fromPhone);
  const local = phone.replace(/^972/, "0");

  // Find a manual (admin) proposal awaiting THIS customer's answer. For a swap
  // the responder is the candidate; for a move it's the primary customer. We do
  // NOT match a swap by its primary's phone — the primary was never messaged.
  // Include just-expired proposals too: the lazy-expiry sweep runs BEFORE this
  // handler on the same webhook, so a "כן" that arrives minutes past the 24h
  // window would otherwise match nothing and leak to the booking agent. Matching
  // a recently-expired (still-unanswered) row lets us send the "offer lapsed"
  // courtesy and consume the reply. respondedAt=null excludes already-answered.
  const proposal = await prisma.swapProposal.findFirst({
    where: {
      businessId: bizId,
      status: { in: ["pending_response", "expired"] },
      respondedAt: null,
      initiatedBy: "admin",
      OR: [
        { candidate: { customer: { OR: [{ phone }, { phone: local }] } } },
        { kind: "move", primary: { customer: { OR: [{ phone }, { phone: local }] } } },
        { kind: "cancel", primary: { customer: { OR: [{ phone }, { phone: local }] } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      candidate: { include: { customer: true } },
      primary:   { include: { customer: true } },
    },
  });
  if (!proposal) return false;
  // Only honor a RECENT lapse — ignore an ancient expired row so it can't hijack
  // an unrelated "כן" days later.
  if (proposal.status === "expired" && Date.now() - proposal.expiresAt.getTime() > 24 * 60 * 60 * 1000) {
    return false;
  }

  // Always answer the person who actually received the offer. For move+cancel
  // that's the PRIMARY customer; for swap it's the CANDIDATE.
  const primaryAnswers = proposal.kind === "move" || proposal.kind === "cancel";
  const replyPhone = primaryAnswers
    ? normalizeIsraeliPhone(proposal.primary?.customer.phone ?? phone)
    : normalizeIsraeliPhone(proposal.candidate?.customer.phone ?? phone);
  const replyKind: "move_proposal" | "swap_proposal" | "cancel_proposal" =
    proposal.kind === "move" ? "move_proposal"
      : proposal.kind === "cancel" ? "cancel_proposal"
      : "swap_proposal";
  // The customer whose decision this is (for owner alerts).
  const subjectName = primaryAnswers
    ? (proposal.primary?.customer.name ?? "לקוח")
    : (proposal.candidate?.customer.name ?? "לקוח");

  // Expired? Admin proposals default to a 24h window and are never auto-expired
  // by the agent cron, so enforce it lazily on reply. Close it and let the
  // customer know the offer lapsed.
  if (proposal.expiresAt.getTime() < Date.now()) {
    await prisma.swapProposal.update({ where: { id: proposal.id }, data: { status: "expired" } }).catch(() => {});
    await sendMessage({
      businessId: bizId,
      customerPhone: replyPhone,
      kind: replyKind,
      body: `תודה על התשובה! ההצעה כבר אינה בתוקף, אז התור נשאר כרגיל 🙏`,
    }).catch(() => {});
    return true;
  }

  const ans = parseYesNo(text);
  if (ans === "unclear") {
    await sendMessage({
      businessId: bizId,
      customerPhone: replyPhone,
      kind: replyKind,
      body: `רק שאדע — מתאים לך? ענה כן או לא 🙏`,
    }).catch(() => {});
    return true;
  }

  if (ans === "no") {
    await prisma.swapProposal.update({
      where: { id: proposal.id },
      data: { status: "rejected_by_customer", respondedAt: new Date(), rawResponse: text.slice(0, 500) },
    });
    await sendMessage({
      businessId: bizId,
      customerPhone: replyPhone,
      kind: replyKind,
      body: `אין בעיה, תודה על התשובה! התור נשאר כרגיל 🙏`,
    }).catch(() => {});
    // Alert the owner (persisted as the proposal's rejected_by_customer status).
    pushToOwner(bizId, {
      title: "לקוח דחה בקשת שינוי",
      body: `${subjectName} ענה/תה "לא" ל${kindLabelHe(proposal.kind)}. התור נשאר כרגיל.`,
      data: { type: "change_declined", proposalId: proposal.id },
    }).catch(() => {});
    return true;
  }

  // ans === "yes" → claim the row ATOMICALLY before executing, so two "yes"
  // replies racing through concurrent webhook invocations can't both reach the
  // money-path (which for a swap would trade the appointments twice). Only the
  // update that flips it out of pending_response wins.
  const claim = await prisma.swapProposal.updateMany({
    where: { id: proposal.id, status: "pending_response" },
    data: { status: "accepted_by_customer", respondedAt: new Date(), rawResponse: text.slice(0, 500) },
  });
  if (claim.count === 0) return true; // a concurrent reply already claimed it
  const result = await executeApprovedProposal(proposal.id);
  if (!result.ok) {
    // Slot changed under us (e.g. someone cancelled/booked) — apologize cleanly.
    await prisma.swapProposal.update({ where: { id: proposal.id }, data: { status: "cancelled" } }).catch(() => {});
    await sendMessage({
      businessId: bizId,
      customerPhone: replyPhone,
      kind: replyKind,
      body: `תודה על הנכונות! בסוף השינוי כבר לא רלוונטי, אז התור נשאר כרגיל 🙏`,
    }).catch(() => {});
    // Alert the owner: the customer said yes but we couldn't apply it.
    pushToOwner(bizId, {
      title: "בקשת שינוי נכשלה",
      body: `${subjectName} אישר/ה ${kindLabelHe(proposal.kind)} אבל לא ניתן היה לבצע (כנראה השעה נתפסה). התור נשאר.`,
      data: { type: "change_failed", proposalId: proposal.id },
    }).catch(() => {});
    return true;
  }
  // Success: executeApprovedProposal already sent the WhatsApp confirmation(s)
  // to both parties and cancelled any sibling proposals.
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) Lazy expiry — runs on every inbound webhook for the business (no cron).
// ─────────────────────────────────────────────────────────────────────────────

export async function expireStaleAgentSwaps(bizId: string): Promise<void> {
  const now = new Date();
  const stale = await prisma.swapProposal.findMany({
    where: {
      businessId: bizId,
      initiatedBy: "agent",
      status: { in: ["pending_staff_approval", "pending_response"] },
      expiresAt: { lt: now },
    },
    select: { id: true, status: true, primaryAppointmentId: true },
  });
  for (const s of stale) {
    await prisma.swapProposal.update({ where: { id: s.id }, data: { status: "expired" } }).catch(() => {});
    if (s.status === "pending_response") {
      const promoted = await promoteNextCandidate(s.primaryAppointmentId);
      if (!promoted) await finishUnsuccessful(s.primaryAppointmentId);
    } else {
      await finishUnsuccessful(s.primaryAppointmentId);
    }
  }

  // Admin/owner-initiated change requests: no candidate queue — just expire the
  // ones the customer never answered, and alert the owner (persisted as the
  // proposal's "expired" status, so a weekly "what fell" report can query it).
  const staleAdmin = await prisma.swapProposal.findMany({
    where: {
      businessId: bizId,
      initiatedBy: "admin",
      status: "pending_response",
      expiresAt: { lt: now },
    },
    include: {
      primary:   { include: { customer: { select: { name: true } } } },
      candidate: { include: { customer: { select: { name: true } } } },
    },
  });
  for (const s of staleAdmin) {
    await prisma.swapProposal.update({ where: { id: s.id }, data: { status: "expired" } }).catch(() => {});
    const nm = s.kind === "swap"
      ? (s.candidate?.customer.name ?? "לקוח")
      : (s.primary?.customer.name ?? "לקוח");
    pushToOwner(bizId, {
      title: "בקשת שינוי פגה",
      body: `${nm} לא ענה/תה על בקשת ${kindLabelHe(s.kind)} בזמן. התור נשאר כרגיל.`,
      data: { type: "change_expired", proposalId: s.id },
    }).catch(() => {});
  }
}
