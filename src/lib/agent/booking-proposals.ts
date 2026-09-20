/**
 * Stage C of docs/PLAN-COST.md — bookings confirmed in CODE, not by the model.
 *
 * Two flows, both keyed by the customer's phone in booking_proposals:
 *
 *   "confirm": the agent has everything (barber, service, day, time, name) and
 *   calls the propose_booking tool. The CODE sends the owner's fixed
 *   confirmation question ("רגע לפני שאני קובע לך את זה סופית — … מאשר?") and
 *   the loop stops. The customer's next message:
 *     plain yes  → code books (same book_appointment executor, same guards),
 *                  sends "סגור, קבעתי לך…" — zero model calls;
 *     plain no   → proposal rejected, the agent takes over with that context;
 *     anything else → the agent, with the pending proposal as context.
 *   Measured before this: that "כן" turn cost 5 model calls (~40% of a booking).
 *
 *   "nudge": a rhythm nudge offered up to 3 real slots. A reply that picks one
 *   ("13", "מחר ב13:00", "הראשון") becomes a "confirm" proposal + the fixed
 *   question — still no model call. Free text goes to the agent as before.
 *
 * Everything the model used to do here is deterministic, so it is code.
 */
import { prisma } from "@/lib/prisma";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { resolvePick } from "@/lib/closures/reply";
import { getBusinessNow, addDaysISO } from "@/lib/utils";

export const CONFIRM_TTL_MS = 2 * 3600_000;
export const NUDGE_TTL_MS = 5 * 86_400_000;
const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export type ExecTool = (name: string, input: Record<string, string>) => Promise<string>;

/** "היום" / "מחר" / "ביום שלישי 22.9" — the owner's wording for the confirmation line. */
export function dayLabelHe(iso: string): string {
  const today = getBusinessNow().date;
  if (iso === today) return "היום";
  if (iso === addDaysISO(today, 1)) return "מחר";
  const d = new Date(iso + "T00:00:00.000Z");
  return `ביום ${DAY[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

export function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "";
}

/** The fixed final-confirmation question (owner's mandated phrasing). */
export function confirmationQuestion(p: { firstName?: string | null; serviceName: string; staffName: string; mentionStaff: boolean; date: string; startTime: string }): string {
  const who = p.firstName ? `${p.firstName}, ` : "";
  const at = p.mentionStaff ? ` אצל ${p.staffName}` : "";
  return `${who}רגע לפני שאני קובע לך את זה סופית — ${p.serviceName}${at} ${dayLabelHe(p.date)} בשעה ${p.startTime}\nמאשר?`;
}

// Punctuation only — NOT \W, which in JS also matches every Hebrew letter and
// would turn "לא, מחר" into a plain "no" (same trap as in closures/reply.ts).
const PUNCT = "[\\s,.!?…\"'׳״\\-]*";
const YES_WORDS = "כן+|מאשר(?:ת)?|סבבה|אוקיי|אוקי|יאללה|יאלה|בטח|מעולה|אחלה|טוב|בסדר|קבע|תקבע|מאושר|אישור|yes|ok|okay|sure|confirm(?:ed)?|👍|👍🏻|👍🏼|👍🏽|✅";
const NO_WORDS = "לא תודה|לא מתאים(?: לי)?|לא רוצה|לא|בטל|תבטל|no|nope|cancel";
const TAIL = "(?:תודה רבה|תודה|אחי|גבר|בבקשה)?";
const YES = new RegExp("^" + PUNCT + "(?:" + YES_WORDS + ")" + PUNCT + TAIL + PUNCT + "$", "i");
const NO = new RegExp("^" + PUNCT + "(?:" + NO_WORDS + ")" + PUNCT + TAIL + PUNCT + "$", "i");
export const isPlainYes = (t: string) => YES.test(t.trim());
export const isPlainNo = (t: string) => NO.test(t.trim());

export async function findPendingProposal(businessId: string, phone: string) {
  const p = normalizeIsraeliPhone(phone);
  return prisma.bookingProposal.findFirst({
    where: { businessId, phone: p, status: "pending", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

/** Called by the propose_booking tool executor: records the proposal (superseding
 *  any older pending one for this phone) and returns the question to send. */
export async function createConfirmProposal(p: {
  businessId: string; phone: string; conversationId: string;
  staffId: string; staffName: string; serviceId: string; serviceName: string;
  date: string; startTime: string; customerName?: string | null; note?: string | null;
  mentionStaff: boolean; originalRequest?: string | null; firstName?: string | null;
}): Promise<string> {
  const phone = normalizeIsraeliPhone(p.phone);
  await prisma.bookingProposal.updateMany({ where: { businessId: p.businessId, phone, status: "pending" }, data: { status: "superseded", respondedAt: new Date() } });
  await prisma.bookingProposal.create({
    data: {
      businessId: p.businessId, phone, conversationId: p.conversationId, kind: "confirm",
      staffId: p.staffId, serviceId: p.serviceId, date: new Date(p.date + "T00:00:00.000Z"), startTime: p.startTime,
      customerName: p.customerName ?? null, note: JSON.stringify({ note: p.note ?? null, originalRequest: p.originalRequest ?? null, staffName: p.staffName, serviceName: p.serviceName }),
      expiresAt: new Date(Date.now() + CONFIRM_TTL_MS),
    },
  });
  return confirmationQuestion({ firstName: p.firstName, serviceName: p.serviceName, staffName: p.staffName, mentionStaff: p.mentionStaff, date: p.date, startTime: p.startTime });
}

/** Called when a rhythm nudge goes out: remember what was offered, structured. */
export async function recordNudgeOffer(p: { businessId: string; phone: string; serviceId: string | null; options: { staffId: string; staffName: string; date: string; startTime: string }[] }) {
  if (!p.options.length) return;
  const phone = normalizeIsraeliPhone(p.phone);
  await prisma.bookingProposal.updateMany({ where: { businessId: p.businessId, phone, kind: "nudge", status: "pending" }, data: { status: "superseded", respondedAt: new Date() } });
  await prisma.bookingProposal.create({
    data: { businessId: p.businessId, phone, kind: "nudge", serviceId: p.serviceId, optionsJson: JSON.stringify(p.options), expiresAt: new Date(Date.now() + NUDGE_TTL_MS) },
  });
}

export type ProposalOutcome = { reply?: string; context?: string };

/**
 * Runs BEFORE the model on every incoming customer message. Returns a reply to
 * send instead of running the model, and/or a context line for the model.
 */
export async function handleIncomingForProposal(p: {
  businessId: string; phone: string; conversationId: string; text: string;
  customer: { id: string; name: string } | null;
  execTool: ExecTool; sandbox: boolean;
}): Promise<ProposalOutcome> {
  const pending = await findPendingProposal(p.businessId, p.phone);
  if (!pending) return {};
  const text = p.text.trim();
  const meta = (() => { try { return JSON.parse(pending.note ?? "{}") as { note?: string | null; originalRequest?: string | null; staffName?: string; serviceName?: string }; } catch { return {}; } })();
  const dateISO = pending.date ? pending.date.toISOString().slice(0, 10) : "";

  if (pending.kind === "confirm") {
    const what = `${meta.serviceName ?? ""} אצל ${meta.staffName ?? ""} ${dayLabelHe(dateISO)} בשעה ${pending.startTime}`;
    if (isPlainYes(text)) {
      const result = await p.execTool("book_appointment", {
        staffId: pending.staffId ?? "", serviceId: pending.serviceId ?? "", date: dateISO, startTime: pending.startTime ?? "",
        customerName: pending.customerName ?? p.customer?.name ?? "", ...(meta.note ? { note: meta.note } : {}),
      });
      const ok = p.sandbox || result.startsWith("✅");
      if (ok) {
        await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: "accepted", respondedAt: new Date() } });
        let reply = `סגור, קבעתי לך אצל ${meta.staffName ?? ""} ${dayLabelHe(dateISO)} בשעה ${pending.startTime}. נתראה 💈`;
        if (meta.originalRequest) reply += `\n\nדרך אגב, רוצה שאעדכן אותך אם יתפנה ${meta.originalRequest}?`;
        return { reply };
      }
      // The slot was taken between the question and the yes — hand the agent a precise brief.
      await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: "rejected", respondedAt: new Date() } });
      return { context: `⚠️ הלקוח אישר את ההצעה (${what}) אבל הקביעה נכשלה: "${result.slice(0, 160)}". אמור לו בכנות שהשעה נתפסה ברגע האחרון והצע מיד את הקרובה שכן פנויה (בדוק עם הכלי), ואז propose_booking שוב.` };
    }
    if (isPlainNo(text)) {
      await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: "rejected", respondedAt: new Date() } });
      return { context: `הלקוח דחה את ההצעה (${what}). שאל בקצרה מה כן מתאים לו (יום/שעה/ספר) והצע חלופה; אם היום/השעה שרצה במקור לא היו פנויים — הצע רשימת המתנה.` };
    }
    return { context: `הצעת ללקוח תור (${what}) והוא עדיין לא אישר — ענה עכשיו: "${text.slice(0, 120)}". אם הוא מבקש שינוי (שעה/יום/ספר) — סדר את השינוי ואז propose_booking מחדש; אם זו שאלה צדדית — ענה וחזור לשאלת האישור. אל תקבע בלי propose_booking.` };
  }

  if (pending.kind === "nudge") {
    const options = (() => { try { return JSON.parse(pending.optionsJson ?? "[]") as { staffId: string; staffName: string; date: string; startTime: string }[]; } catch { return []; } })();
    const today = getBusinessNow().date;
    const live = options.filter(o => o.date >= today);
    const pick = resolvePick(text, live.map(o => ({ ...o, sameStaff: true })), today);
    if (pick === null) return {}; // free text → the agent (it already has the nudge as context)
    const chosen = live[pick];
    // The offered slot must still be free — same guard as a booking.
    const [staff, service] = await Promise.all([
      prisma.staff.findFirst({ where: { id: chosen.staffId, businessId: p.businessId }, select: { id: true, name: true } }),
      pending.serviceId
        ? prisma.service.findFirst({ where: { id: pending.serviceId, businessId: p.businessId }, select: { id: true, name: true } })
        : prisma.service.findFirst({ where: { businessId: p.businessId, isVisible: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    ]);
    if (!staff || !service) return {};
    const { computeDayAvailability } = await import("@/lib/agent/availability");
    const avail = await computeDayAvailability(p.businessId, chosen.date, staff.id, service.id, { exemptHoldsCustomerId: p.customer?.id });
    const free = avail.find(a => a.staffId === staff.id)?.slots.includes(chosen.startTime) ?? false;
    await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: "superseded", respondedAt: new Date() } });
    if (!free) return { context: `הלקוח בחר מההצעה שלנו את ${dayLabelHe(chosen.date)} בשעה ${chosen.startTime} אצל ${staff.name}, אבל השעה כבר נתפסה. אמור לו בכנות והצע את הקרובה שכן פנויה באותו יום ובאותו טווח (בדוק עם הכלי), ואז propose_booking.` };
    const question = await createConfirmProposal({
      businessId: p.businessId, phone: p.phone, conversationId: p.conversationId,
      staffId: staff.id, staffName: staff.name, serviceId: service.id, serviceName: service.name,
      date: chosen.date, startTime: chosen.startTime, customerName: p.customer?.name ?? null,
      mentionStaff: true, firstName: firstNameOf(p.customer?.name),
    });
    return { reply: question };
  }
  return {};
}

/** Context for the turn AFTER a code-confirmed booking that offered the waitlist. */
export async function afterBookingWaitlistContext(businessId: string, phone: string): Promise<string | null> {
  const last = await prisma.bookingProposal.findFirst({
    where: { businessId, phone: normalizeIsraeliPhone(phone), kind: "confirm", status: "accepted", respondedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { respondedAt: "desc" },
  });
  if (!last) return null;
  const meta = (() => { try { return JSON.parse(last.note ?? "{}") as { originalRequest?: string | null }; } catch { return {}; } })();
  if (!meta.originalRequest) return null;
  return `אחרי שהתור נקבע הצענו לו: "רוצה שאעדכן אותך אם יתפנה ${meta.originalRequest}?". אם הוא עונה כן — join_waitlist למה שרצה במקור (${meta.originalRequest}); אם לא — תודה קצרה וזהו.`;
}
