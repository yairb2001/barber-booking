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
  // WhatsApp names sometimes carry bidi control marks (\u202a…) — never echo them.
  return (name ?? "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim().split(/\s+/)[0] || "";
}

/** The fixed closing line after a code-confirmed booking. */
export function bookedMessage(p: { staffName: string; date: string; startTime: string; originalRequest?: string | null }): string {
  let reply = `סגור, קבעתי לך אצל ${p.staffName} ${dayLabelHe(p.date)} בשעה ${p.startTime}. נתראה 💈`;
  if (p.originalRequest) reply += `\n\nדרך אגב, רוצה שאעדכן אותך אם יתפנה ${p.originalRequest}?`;
  return reply;
}

/** The fixed final-confirmation question (owner's mandated phrasing). */
export function confirmationQuestion(p: { firstName?: string | null; serviceName: string; staffName: string; mentionStaff: boolean; date: string; startTime: string }): string {
  const who = p.firstName ? `${p.firstName}, ` : "";
  const at = p.mentionStaff ? ` אצל ${p.staffName}` : "";
  return `${who}רגע לפני שאני קובע לך את זה סופית — ${p.serviceName}${at} ${dayLabelHe(p.date)} בשעה ${p.startTime}\nמאשר?`;
}

// ── Reply classifier ────────────────────────────────────────────────────────
// Built from the real replies to "מאשר?" in DOMINANT's conversations (20.9.2026,
// 26 samples: כן ×11, מאשר ×9, מתאים, "מאשר👍🏼", "כן תודה", "פגז אחי תודה") plus the
// short replies seen elsewhere (חיובי, סבבה, "בסדר אחי", "yes please", "Yea it's
// fine", "וואלה אוקיי"). Token based: every word must be a YES stem or a filler;
// any NO stem, any question mark, any other word (a time, a barber, "אבל") means
// "not a plain yes" and the model takes it. Hebrew stems are matched as prefixes
// so מאשר/מאשרת/מאשרים/אישרתי all count. Never \W — it matches Hebrew letters.
const YES_STEMS = [
  "כן", "מאשר", "אשר", "אישר", "אישור", "מאושר", "מתאים", "סבבה", "סבב", "אוקי", "אוקיי", "אוקיה", "בסדר", "טוב", "מעולה", "אחלה", "יאללה", "יאלה",
  "בטח", "ברור", "כמובן", "חיובי", "מצוין", "מצויין", "סגור", "קבע", "תקבע", "נקבע", "תסגור", "תסגרי", "פגז", "מושלם", "בכיף", "מגניב", "אמן", "נלך", "קדימה", "לך", "תמשיך",
  "yes", "yep", "yeah", "yea", "ya", "sure", "fine", "ok", "okay", "okk", "confirm", "confirmed", "great", "perfect", "good", "deal", "alright",
  "👍", "👍🏻", "👍🏼", "👍🏽", "👍🏾", "👍🏿", "✅", "🙏", "🙏🏻", "🙏🏼", "👌", "💪", "🔥", "❤️", "🤙", "🤙🏼", "🤝",
];
const FILLER = ["יש", "תודה", "רבה", "אחי", "גבר", "בבקשה", "מותק", "כפרה", "אח", "אחלה", "לי", "אני", "זה", "בוא", "על", "ממש", "מאוד", "אז", "אה", "וואלה", "וואו", "נתראה", "להתראות", "ביי", "please", "thanks", "thank", "you", "bro", "it's", "its", "that's", "thats", "then", "man"];
const NO_STEMS = ["לא", "לאא", "פחות", "עזוב", "עזבי", "רגע", "אולי", "תחכה", "no", "nope", "nah", "wait", "hold", "maybe", "❌", "👎"];
// Cancel verbs mean "no" to a booking question but "yes" to a cancellation question.
const CANCEL_VERBS = ["בטל", "תבטל", "לבטל", "מבטל", "ביטול", "cancel"];
const MOVE_HINTS = /זיז|עביר|דחה|דחות|קדים|שנה|שנות|במקום|נוסף|עוד תור|move|resched|instead/i;
const CHANGE_HINTS = /אבל|רק|במקום|אחר|אחרת|יותר|פחות|מאוחר|מוקדם|אפשר|יש|מה|מתי|למה|איפה|אצל|עם|בלי|ספר|תספורת|זקן|מספריים/;
const stripEmojiSkin = (t: string) => t.replace(/\uD83C[\uDFFB-\uDFFF]/g, ""); // skin-tone modifiers, no u-flag (es5 target)
function tokens(text: string): string[] {
  return stripEmojiSkin(text.toLowerCase())
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "") // bidi/format marks WhatsApp adds ("‏מאושר" — real miss, 20.9.2026)
    .replace(/[\u0591-\u05C7]/g, "")                          // niqqud
    .replace(/['׳’]/g, "")                                  // apostrophes join (it's → its)
    .replace(/[,.!…"״\-–—()\[\]:;]+/g, " ")                  // punctuation (keep ? for the check below)
    .split(/\s+/).map(t => t.trim()).filter(Boolean);
}
const isYesToken = (t: string) => YES_STEMS.some(st => t === st || (/^[א-ת]/.test(st) && t.startsWith(st) && t.length - st.length <= 3) || (/^[a-z]/.test(st) && t === st));
const isNoToken = (t: string) => NO_STEMS.some(st => t === st || (/^[א-ת]/.test(st) && t.startsWith(st) && t.length - st.length <= 2));
const isCancelToken = (t: string) => CANCEL_VERBS.some(st => t === st || (/^[א-ת]/.test(st) && t.startsWith(st) && t.length - st.length <= 2));
export type ReplyClass = "yes" | "no" | "other";
/** `proposedTime` lets "כן, 15:00" count as a yes when 15:00 is exactly what was proposed.
 *  `mode` "cancel": the question was "לבטל את התור?", so "כן תבטל" / "בטל" are a yes. */
export function classifyReply(text: string, proposedTime?: string | null, mode: "confirm" | "cancel" = "confirm"): ReplyClass {
  const raw = text.trim();
  if (!raw) return "other";
  if (raw.includes("?") || raw.includes("؟")) return "other";
  let t = raw;
  if (proposedTime) { const hh = proposedTime.replace(/^0/, ""); t = t.replace(new RegExp("(^|[\\s,])(ב-?|ל-?)?(0?" + hh.replace(":", ":") + ")(?=$|[\\s,.!])", "g"), " "); }
  const toks = tokens(t);
  if (toks.length === 0) return proposedTime && raw !== t ? "yes" : "other";
  if (toks.length > 7) return "other";
  // "לא, תזיז" to a cancel question is a move request, not "keep it" → the model handles it
  if (mode === "cancel" && MOVE_HINTS.test(raw)) return "other";
  if (toks.some(isNoToken)) return "no";
  if (mode === "confirm" && toks.some(isCancelToken)) return "no";
  if (/\d/.test(toks.join(" "))) return "other";               // a time or a date → the model decides
  const yesTok = (x: string) => isYesToken(x) || (mode === "cancel" && isCancelToken(x));
  const meaningful = toks.filter(x => !FILLER.includes(x) && /[a-zA-Zא-ת0-9]/.test(x) || yesTok(x)); // symbol-only tokens (🤷🏻‍♂️) are filler
  if (!meaningful.length) return "other";                       // "תודה" alone is not a yes
  if (meaningful.every(yesTok)) return "yes";
  if (CHANGE_HINTS.test(raw)) return "other";
  // Lenient: a short reply that contains a yes word and nothing negative,
  // numeric or questioning ("כן קבעה", "אישור אחי") is a yes.
  if (meaningful.length <= 3 && meaningful.some(yesTok)) return "yes";
  return "other";
}
export const isPlainYes = (t: string, proposedTime?: string | null) => classifyReply(t, proposedTime) === "yes";
export const isPlainNo = (t: string) => classifyReply(t) === "no";

// ── Cancellation in code ─────────────────────────────────────────────────────
const CANCEL_INTENT = /לבטל|ביטול|תבטל|מבטל|בטל את|לבטלל|cancel/i;
const OTHER_INTENT = /לקבוע|להזיז|להעביר|לדחות|במקום|להקדים|לאחר|לשנות|ולקבוע|אחר|תור נוסף|עוד תור|reschedule|move|book/i;
/** "אני רוצה לבטל את התור" with exactly ONE upcoming appointment → the code asks
 *  the confirmation; anything richer (two appointments, "cancel and rebook",
 *  a day that doesn't match) stays with the model. */
export async function maybeStartCancelFlow(p: { businessId: string; phone: string; conversationId: string; text: string; customer: { id: string; name: string } | null }): Promise<ProposalOutcome> {
  const text = p.text.trim();
  if (!CANCEL_INTENT.test(text) || OTHER_INTENT.test(text) || text.split(/\s+/).length > 14 || !p.customer) return {};
  const nowBiz = getBusinessNow();
  const todayStart = new Date(nowBiz.date + "T00:00:00.000Z");
  const upcoming = (await prisma.appointment.findMany({
    where: { businessId: p.businessId, customerId: p.customer.id, date: { gte: todayStart }, status: { in: ["pending", "confirmed"] } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }], take: 3,
    select: { id: true, date: true, startTime: true, staff: { select: { name: true } }, service: { select: { name: true } } },
  })).filter(a => a.date.toISOString().slice(0, 10) !== nowBiz.date || Number(a.startTime.split(":")[0]) * 60 + Number(a.startTime.split(":")[1]) >= nowBiz.minutes);
  if (upcoming.length !== 1) return {};
  const a = upcoming[0];
  const phone = normalizeIsraeliPhone(p.phone);
  const dateISO = a.date.toISOString().slice(0, 10);
  await prisma.bookingProposal.updateMany({ where: { businessId: p.businessId, phone, status: "pending" }, data: { status: "superseded", respondedAt: new Date() } });
  await prisma.bookingProposal.create({
    data: { businessId: p.businessId, phone, conversationId: p.conversationId, kind: "cancel", date: a.date, startTime: a.startTime, note: JSON.stringify({ appointmentId: a.id, staffName: a.staff.name, serviceName: a.service.name }), expiresAt: new Date(Date.now() + CONFIRM_TTL_MS) },
  });
  return { reply: `${firstNameOf(p.customer.name) ? firstNameOf(p.customer.name) + ", " : ""}לבטל את התור ${dayLabelHe(dateISO)} בשעה ${a.startTime} אצל ${a.staff.name}?` };
}

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
  if (!pending) return maybeStartCancelFlow({ businessId: p.businessId, phone: p.phone, conversationId: p.conversationId, text: p.text, customer: p.customer });
  const text = p.text.trim();
  const meta = (() => { try { return JSON.parse(pending.note ?? "{}") as { note?: string | null; originalRequest?: string | null; staffName?: string; serviceName?: string }; } catch { return {}; } })();
  const dateISO = pending.date ? pending.date.toISOString().slice(0, 10) : "";

  if (pending.kind === "cancel") {
    const cm = (() => { try { return JSON.parse(pending.note ?? "{}") as { appointmentId?: string; staffName?: string }; } catch { return {}; } })();
    const what = `התור ${dayLabelHe(dateISO)} בשעה ${pending.startTime} אצל ${cm.staffName ?? ""}`;
    const cls = classifyReply(text, null, "cancel");
    if (cls === "yes" && cm.appointmentId) {
      const result = await p.execTool("cancel_appointment", { appointmentId: cm.appointmentId });
      const ok = p.sandbox || /✅|בוטל/.test(result);
      await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: ok ? "accepted" : "rejected", respondedAt: new Date() } });
      if (ok) return { reply: `בוטל. אם תרצה לקבוע מחדש, אני כאן 👍` };
      return { context: `הלקוח אישר לבטל את ${what} אבל הביטול נכשל: "${result.slice(0, 160)}". הסבר בכנות ועזור.` };
    }
    if (cls === "no") {
      await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: "rejected", respondedAt: new Date() } });
      return { reply: `סבבה, התור נשאר כמו שהוא 👍` };
    }
    return { context: `שאלת את הלקוח אם לבטל את ${what} והוא ענה משהו אחר: "${text.slice(0, 120)}". אם הוא רוצה להזיז במקום לבטל — request_appointment_move; אם רוצה לבטל בכל זאת — cancel_appointment עם המזהה שבהנחיות, אחרי אישור.` };
  }

  if (pending.kind === "confirm") {
    const what = `${meta.serviceName ?? ""} אצל ${meta.staffName ?? ""} ${dayLabelHe(dateISO)} בשעה ${pending.startTime}`;
    if (isPlainYes(text, pending.startTime)) {
      const result = await p.execTool("book_appointment", {
        staffId: pending.staffId ?? "", serviceId: pending.serviceId ?? "", date: dateISO, startTime: pending.startTime ?? "",
        customerName: pending.customerName ?? p.customer?.name ?? "", ...(meta.note ? { note: meta.note } : {}),
      });
      const ok = p.sandbox || result.startsWith("✅");
      if (ok) {
        await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: "accepted", respondedAt: new Date() } });
        return { reply: bookedMessage({ staffName: meta.staffName ?? "", date: dateISO, startTime: pending.startTime ?? "", originalRequest: meta.originalRequest }) };
      }
      // The slot was taken between the question and the yes — hand the agent a precise brief.
      await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: "rejected", respondedAt: new Date() } });
      return { context: `⚠️ הלקוח אישר את ההצעה (${what}) אבל הקביעה נכשלה: "${result.slice(0, 160)}". אמור לו בכנות שהשעה נתפסה ברגע האחרון והצע מיד את הקרובה שכן פנויה (בדוק עם הכלי), ואז propose_booking שוב.` };
    }
    if (isPlainNo(text)) {
      await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: "rejected", respondedAt: new Date() } });
      return { context: `הלקוח דחה את ההצעה (${what}). שאל בקצרה מה כן מתאים לו (יום/שעה/ספר) והצע חלופה; אם היום/השעה שרצה במקור לא היו פנויים — הצע רשימת המתנה.` };
    }
    return { context: `הצעת ללקוח תור (${what}) והוא עדיין לא אישר — ענה עכשיו: "${text.slice(0, 120)}". אם זו בעצם הסכמה במילים שלו ("מאושר", "יש אישור", "סגור", "קדימה") — קרא ל-propose_booking עם בדיוק אותם פרטים ו-customerConfirmed=true, והמערכת תקבע מיד בלי לשאול שוב. אם הוא מבקש שינוי (שעה/יום/ספר) — סדר את השינוי ואז propose_booking מחדש (בלי customerConfirmed). אם זו שאלה צדדית — ענה וחזור לשאלת האישור. אל תשלח שוב את אותה שאלת אישור.` };
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

/** Context for the turns AFTER a code-confirmed booking (24h): the booking is
 *  done — the model must not propose it again (with the availability snapshot in
 *  the context it once did, treating the still-listed slot as "not booked"),
 *  and if the waitlist was offered, "כן" means join_waitlist. */
export async function afterBookingWaitlistContext(businessId: string, phone: string): Promise<string | null> {
  const last = await prisma.bookingProposal.findFirst({
    where: { businessId, phone: normalizeIsraeliPhone(phone), kind: "confirm", status: "accepted", respondedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { respondedAt: "desc" },
  });
  if (!last) return null;
  const meta = (() => { try { return JSON.parse(last.note ?? "{}") as { originalRequest?: string | null; staffName?: string; serviceName?: string }; } catch { return {}; } })();
  const dateISO = last.date ? last.date.toISOString().slice(0, 10) : "";
  const ago = Math.round((Date.now() - (last.respondedAt?.getTime() ?? Date.now())) / 60_000);
  let ctx = `המערכת כבר קבעה לו לפני ${ago < 1 ? "רגע" : `${ago} דק׳`} את התור: ${meta.serviceName ?? ""} אצל ${meta.staffName ?? ""} ${dayLabelHe(dateISO)} בשעה ${last.startTime} — הוא קבוע וסגור, גם אם השעה עדיין מופיעה בזמינות שבהנחיות. אל תציע אותו שוב ואל תקרא ל-propose_booking עליו; "תודה"/"סבבה" = סגירת שיחה קצרה.`;
  if (meta.originalRequest) ctx += ` אחרי הקביעה הצענו לו: "רוצה שאעדכן אותך אם יתפנה ${meta.originalRequest}?" — אם הוא עונה כן → join_waitlist למה שרצה במקור (${meta.originalRequest}); אם לא → תודה קצרה.`;
  return ctx;
}
