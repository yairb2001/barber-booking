/**
 * Calendar closure — the customer's reply.
 * ────────────────────────────────────────
 * Runs in the webhook BEFORE the generic admin-proposal handler. A closure
 * proposal carries two alternatives, so a bare "כן" is ambiguous and the
 * answer is free text: "הראשון", "השני", "13:30", "מחר", "יום שלישי",
 * "אצל ניתאי", "לא", "שעה אחרת"… We resolve the easy cases deterministically
 * (a clear pick of A or B, an explicit decline), execute through the same
 * money-path as every other move (swap-exec), and hand EVERYTHING else to the
 * booking agent with closure context injected (customer-agent loadCustomerContext),
 * so "אצל ניתאי" / "שעה אחרת" become a normal rebooking conversation in the
 * barber's voice. Spec: specs/calendar-closure.md §3.5
 *
 * Returns true when the reply was fully consumed (do not run the agent).
 */
import { prisma } from "@/lib/prisma";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { sendMessage } from "@/lib/messaging/index";
import { executeApprovedProposal } from "@/lib/appointments/swap-exec";
import { describeSlot } from "./message";

type Opt = { staffId: string; staffName: string; date: string; startTime: string; sameStaff: boolean };

const DAY_WORDS: Record<string, number> = { "ראשון": 0, "שני": 1, "שלישי": 2, "רביעי": 3, "חמישי": 4, "שישי": 5, "שבת": 6 };

/** Which of the two options did the customer pick? null = not a clear pick. */
export function resolvePick(text: string, options: Opt[], today: string): number | null {
  const t = text.trim().replace(/[!.،,]+$/g, "");
  if (options.length === 1) {
    if (/^(כן|סבבה|מתאים|אוקיי|אוקי|בסדר|יאללה|מעולה|אחלה)\b/.test(t)) return 0;
  }
  if (/^(ה?ראשונ[הי]?|האופציה הראשונה|1|א['׳]?|הראשון)$/.test(t)) return 0;
  if (options.length > 1 && /^(ה?שני[יה]?|האופציה השנייה|2|ב['׳]?|השני)$/.test(t)) return 1;
  // explicit time "13:30" / "13.30" / "ב-13:30"
  const tm = t.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (tm) {
    const hhmm = `${tm[1].padStart(2, "0")}:${tm[2]}`;
    const hits = options.map((o, i) => (o.startTime === hhmm ? i : -1)).filter(i => i >= 0);
    if (hits.length === 1) return hits[0];
  }
  // "מחר" / "היום" / day name — only if exactly one option matches
  const tomorrow = new Date(today + "T00:00:00.000Z"); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  const byDate = (pred: (o: Opt) => boolean) => { const h = options.map((o, i) => (pred(o) ? i : -1)).filter(i => i >= 0); return h.length === 1 ? h[0] : null; };
  // NOTE: \b is useless next to Hebrew (not \w in JS) — use explicit edges.
  const has = (word: string) => new RegExp(`(?:^|[\\s,.])${word}(?=$|[\\s,.!?])`).test(t);
  if (has("מחר")) { const r = byDate(o => o.date === tomorrowIso); if (r !== null) return r; }
  if (has("היום")) { const r = byDate(o => o.date === today); if (r !== null) return r; }
  for (const [w, dow] of Object.entries(DAY_WORDS)) {
    if (has(`(?:יום |ב|ביום )?${w}`)) { const r = byDate(o => new Date(o.date + "T00:00:00.000Z").getUTCDay() === dow); if (r !== null) return r; }
  }
  // barber name — only if exactly one option is at that barber
  const nameHit = options.map((o, i) => (o.staffName && t.includes(o.staffName.split(/\s+/)[0]) ? i : -1)).filter(i => i >= 0);
  if (nameHit.length === 1 && /אצל|עם/.test(t)) return nameHit[0];
  return null;
}

export function isDecline(text: string): boolean {
  // A decline is the WHOLE message ("לא", "לא תודה", "לא מתאים לי"). "לא, שעה
  // אחרת" / "לא, מחר" is a request, not a decline — it must reach the agent.
  // (\b is useless next to Hebrew, so we match the full string instead.)
  return /^(לא תודה|לא מתאים( לי)?|לא רלוונטי|אין צורך|תבטל|בטל|לא רוצה|לא)[\s,.!?]*(תודה( רבה)?|אחי|סבבה)?[\s,.!?]*$/.test(text.trim());
}

export async function handleClosureReply(bizId: string, fromPhone: string, text: string, today: string): Promise<boolean> {
  const phone = normalizeIsraeliPhone(fromPhone);
  const local = phone.replace(/^972/, "0");
  const proposal = await prisma.swapProposal.findFirst({
    where: {
      businessId: bizId, closureId: { not: null }, kind: "move",
      status: "pending_response", respondedAt: null,
      primary: { customer: { OR: [{ phone }, { phone: local }] } },
    },
    orderBy: { createdAt: "desc" },
    include: { primary: { include: { customer: true, staff: true } } },
  });
  if (!proposal) return false;
  const options: Opt[] = proposal.optionsJson ? JSON.parse(proposal.optionsJson) : [];
  const replyPhone = normalizeIsraeliPhone(proposal.primary.customer.phone);

  // Expired offer → close it politely; the agent can still rebook from scratch.
  if (proposal.expiresAt.getTime() < Date.now()) {
    await prisma.swapProposal.update({ where: { id: proposal.id }, data: { status: "expired" } }).catch(() => {});
    await prisma.slotHold.deleteMany({ where: { proposalId: proposal.id } }).catch(() => {});
    return false; // let the agent handle it as a normal rebooking (context says the appointment was cancelled)
  }

  if (isDecline(text)) {
    await prisma.$transaction([
      prisma.swapProposal.update({ where: { id: proposal.id }, data: { status: "rejected_by_customer", respondedAt: new Date(), rawResponse: text.slice(0, 500) } }),
      prisma.slotHold.deleteMany({ where: { proposalId: proposal.id } }),
    ]);
    await sendMessage({ businessId: bizId, customerPhone: replyPhone, kind: "move_proposal",
      body: `אין בעיה, הבנתי. אם תרצה בהמשך לקבוע מחדש — אני כאן, רק תכתוב לי.` }).catch(() => {});
    return true;
  }

  const pick = resolvePick(text, options, today);
  if (pick === null) return false; // free text → the agent, with closure context

  const chosen = options[pick];
  // Claim atomically (two replies racing), then point the proposal at the chosen option.
  const claim = await prisma.swapProposal.updateMany({
    where: { id: proposal.id, status: "pending_response" },
    data: {
      status: "accepted_by_customer", respondedAt: new Date(), rawResponse: text.slice(0, 500), chosenIndex: pick,
      targetStaffId: chosen.staffId, targetDate: new Date(chosen.date + "T00:00:00.000Z"), targetStartTime: chosen.startTime,
    },
  });
  if (claim.count === 0) return true;
  // Release our own holds first so the executor's re-check sees the slot as free.
  await prisma.slotHold.deleteMany({ where: { proposalId: proposal.id } }).catch(() => {});
  // The primary is currently cancelled_by_staff — restore it as confirmed at the new time.
  await prisma.appointment.update({ where: { id: proposal.primaryAppointmentId }, data: { status: "confirmed", cancelledAt: null } }).catch(() => {});
  const result = await executeApprovedProposal(proposal.id);
  if (!result.ok) {
    // Slot taken meanwhile → re-cancel, reopen the proposal without that option, let the agent offer the next one.
    await prisma.appointment.update({ where: { id: proposal.primaryAppointmentId }, data: { status: "cancelled_by_staff", cancelledAt: new Date() } }).catch(() => {});
    const rest = options.filter((_, i) => i !== pick);
    await prisma.swapProposal.update({ where: { id: proposal.id }, data: { status: "pending_response", respondedAt: null, chosenIndex: null, optionsJson: JSON.stringify(rest) } }).catch(() => {});
    const alt = rest[0] ? ` יש לי עדיין ${describeSlot(rest[0])} — מתאים? או תגיד לי שעה אחרת ואסדר.` : ` תגיד לי שעה או יום שנוח לך ואסדר.`;
    await sendMessage({ businessId: bizId, customerPhone: replyPhone, kind: "move_proposal", body: `אופס, השעה הזאת בדיוק נתפסה.${alt}` }).catch(() => {});
    return true;
  }
  return true; // swap-exec already sent the "appointment moved" confirmation
}
