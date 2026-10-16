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
import { dayDistance } from "@/lib/day-distance";
import { randomUUID } from "crypto";
import { loadDayContext, findUpsell } from "@/lib/availability/visit";
import { prisma } from "@/lib/prisma";
import { holdSlot, releaseHolds, holderKeyForPhone } from "@/lib/slot-holds";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { resolvePick } from "@/lib/closures/reply";
import { getBusinessNow, addDaysISO } from "@/lib/utils";
import { isNightWindow, weekdayDate } from "@/lib/agent/night-window";
import { maybeStartMoveFlow, handleMoveReply } from "@/lib/agent/move-flow";

export const CONFIRM_TTL_MS = 2 * 3600_000;
export const NUDGE_TTL_MS = 5 * 86_400_000;
const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export type ExecTool = (name: string, input: Record<string, string>) => Promise<string>;

/** "היום" / "מחר" / "ביום שלישי 22.9" — the owner's wording for the confirmation line. */
export function dayLabelHe(iso: string): string {
  const today = getBusinessNow().date;
  if (isNightWindow()) return `ב${weekdayDate(iso)}${iso === today ? " (היום, אחרי שתקום)" : ""}`;
  if (iso === today) return "היום";
  if (iso === addDaysISO(today, 1)) return "מחר";
  const d = new Date(iso + "T00:00:00.000Z");
  return `ביום ${DAY[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

/** "ביום חמישי *הבא*, 2.10 (בעוד 8 ימים)" — the phrasing that stops a customer
 *  from turning up a week early. Bold is WhatsApp bold; the site formats its own. */
export function dayLabelWithDistance(iso: string): string {
  const today = getBusinessNow().date;
  const d = dayDistance(iso, today);
  // After midnight "היום"/"מחר"/"מחרתיים" alone are exactly what gets misread.
  if (isNightWindow() && d.days <= 2) return `ב${weekdayDate(iso)}${d.days === 0 ? " (היום, אחרי שתקום)" : ""}`;
  if (d.days <= 2) return d.label;
  const dt = new Date(iso + "T00:00:00.000Z");
  const dm = `${dt.getUTCDate()}.${dt.getUTCMonth() + 1}`;
  return `ביום ${d.weekday}${d.isNext ? " *הבא*" : ""}, ${dm} (${d.label})`;
}

// ── The customer's language (16.10.2026, Yair: "לענות בשפה שהלקוח מדבר בה, גם לגבי
// האישור בסוף"). Every fixed line the code sends has an English twin; the model's own
// replies already follow the customer's language (prompt-template, סגנון).
export type Lang = "he" | "en";
export const langOf = (text?: string | null): Lang => (text && /[A-Za-z]{2,}/.test(text) && !/[א-ת]/.test(text) ? "en" : "he");
/** The language of the customer's latest message in this conversation. */
export async function convLang(conversationId?: string | null): Promise<Lang> {
  if (!conversationId) return "he";
  const m = await prisma.conversationMessage.findFirst({ where: { conversationId, role: "user" }, orderBy: { createdAt: "desc" }, select: { content: true } });
  return langOf(m?.content);
}
/** "today" / "tomorrow" / "on Thursday 22.10 (in 8 days)". */
export function dayLabelEn(iso: string): string {
  const today = getBusinessNow().date;
  const dt = new Date(iso + "T00:00:00.000Z");
  const wd = dt.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const dm = `${dt.getUTCDate()}.${dt.getUTCMonth() + 1}`;
  const d = dayDistance(iso, today);
  if (isNightWindow() && d.days <= 2) return `on ${wd} ${dm}${d.days === 0 ? " (today, after you wake up)" : ""}`;
  if (d.days === 0) return "today";
  if (d.days === 1) return "tomorrow";
  return `on ${wd} ${dm}${d.days > 2 ? ` (in ${d.days} days)` : ""}`;
}
const dayIn = (iso: string, lang: Lang) => (lang === "en" ? dayLabelEn(iso) : dayLabelWithDistance(iso));
const andList = (items: string[], lang: Lang) => items.length < 2 ? items.join("") : lang === "en" ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items.length === 2 ? items.join(" ו") : `${items.slice(0, -1).join(", ")} ו${items[items.length - 1]}`;

export function firstNameOf(name: string | null | undefined): string {
  // WhatsApp names sometimes carry bidi control marks (\u202a…) — never echo them.
  return (name ?? "").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim().split(/\s+/)[0] || "";
}

/** The fixed closing line after a code-confirmed booking. */
export function bookedMessage(p: { staffName: string; date: string; startTime: string; originalRequest?: string | null; lang?: Lang }): string {
  if (p.lang === "en") {
    let en = `Done, you're booked with ${p.staffName} ${dayLabelEn(p.date)} at ${p.startTime}. See you 💈`;
    if (p.originalRequest) en += `\n\nBy the way, want me to let you know if ${p.originalRequest} opens up?`;
    return en;
  }
  let reply = `סגור, קבעתי לך אצל ${p.staffName} ${dayLabelWithDistance(p.date)} בשעה ${p.startTime}. נתראה 💈`;
  if (p.originalRequest) reply += `\n\nדרך אגב, רוצה שאעדכן אותך אם יתפנה ${p.originalRequest}?`;
  return reply;
}

/** Extra appointments booked in the same confirmation (owner, 14.10.2026: two
 *  customers came for two and found one — the second was never proposed). */
export type GroupItem = {
  staffId: string; staffName: string; startTime: string; forName: string;
  /** A visit (16.10.2026): another treatment for the same customer, right after
   *  the one before it, maybe with someone else. forName is empty then. */
  serviceId?: string; serviceName?: string;
};
const isVisit = (g?: GroupItem[]) => !!g?.some(x => x.serviceId);

/** One question for the whole visit: "לייזר ב-10:00 אצל דנה, ואחריו לק ג'ל ב-10:40 אצל שירן". */
export function visitConfirmationQuestion(p: { firstName?: string | null; serviceName: string; staffName: string; date: string; startTime: string; group: GroupItem[]; lang?: Lang }): string {
  const who = p.firstName ? `${p.firstName}, ` : "";
  if (p.lang === "en") return `${who}${who ? "just" : "Just"} before I lock it in, ${dayLabelEn(p.date)}: ${p.serviceName} at ${p.startTime} with ${p.staffName}, then ${p.group.map(g => `${g.serviceName} at ${g.startTime} with ${g.staffName}`).join(", then ")}\nConfirm?`;
  const rest = p.group.map(g => `${g.serviceName} ב-${g.startTime} אצל ${g.staffName}`);
  return `${who}רגע לפני שאני קובע סופית, ${dayLabelWithDistance(p.date)}: ${p.serviceName} ב-${p.startTime} אצל ${p.staffName}, ואחריו ${rest.join(", ואחריו ")}\nמאשר?`;
}

export function visitBookedMessage(p: { date: string; items: { serviceName: string; startTime: string; staffName: string }[]; lang?: Lang }): string {
  if (p.lang === "en") return `Done, you're booked ${dayLabelEn(p.date)}: ${p.items.map(i => `${i.serviceName} at ${i.startTime} with ${i.staffName}`).join(", then ")}. See you 💈`;
  return `סגור, קבעתי לך ${dayLabelWithDistance(p.date)}: ${p.items.map(i => `${i.serviceName} ב-${i.startTime} אצל ${i.staffName}`).join(", ואחריו ")}. נתראה 💈`;
}

const nameOf = (full?: string | null) => (full ?? "").trim().split(/\s+/)[0] || "";
/** One question for ALL the appointments, so one "כן" books all of them. */
export function groupConfirmationQuestion(p: { firstName?: string | null; mainName?: string | null; serviceName: string; staffName: string; date: string; startTime: string; group: GroupItem[]; lang?: Lang }): string {
  const sameStaff = p.group.every(g => g.staffId && g.staffName === p.staffName);
  if (p.lang === "en") {
    const atEn = (staff: string) => (sameStaff ? "" : ` with ${staff}`);
    const itemsEn = [`${nameOf(p.mainName) || "you"} at ${p.startTime}${atEn(p.staffName)}`, ...p.group.map(g => `${nameOf(g.forName)} at ${g.startTime}${atEn(g.staffName)}`)];
    return `${p.firstName ? `${p.firstName}, just` : "Just"} before I lock it in: ${itemsEn.length} appointments for ${p.serviceName}${sameStaff ? ` with ${p.staffName}` : ""} ${dayLabelEn(p.date)}: ${andList(itemsEn, "en")}\nConfirm?`;
  }
  const at = (staff: string) => (sameStaff ? "" : ` אצל ${staff}`);
  const items = [`${nameOf(p.mainName) || "אתה"} ב-${p.startTime}${at(p.staffName)}`, ...p.group.map(g => `${nameOf(g.forName)} ב-${g.startTime}${at(g.staffName)}`)];
  const list = items.length === 2 ? items.join(" ו") : `${items.slice(0, -1).join(", ")} ו${items[items.length - 1]}`;
  const who = p.firstName ? `${p.firstName}, ` : "";
  return `${who}רגע לפני שאני קובע סופית: ${items.length} תורים ל${p.serviceName}${sameStaff ? ` אצל ${p.staffName}` : ""} ${dayLabelWithDistance(p.date)}: ${list}\nמאשר?`;
}

export function groupBookedMessage(p: { staffName: string; date: string; booked: { name: string; startTime: string; staffName: string }[]; lang?: Lang }): string {
  const sameStaff = p.booked.every(b => b.staffName === p.staffName);
  if (p.lang === "en") return `Done, booked ${p.booked.length} appointments${sameStaff ? ` with ${p.staffName}` : ""} ${dayLabelEn(p.date)}: ${p.booked.map(b => `${b.name === "אתה" ? "you" : b.name} at ${b.startTime}${sameStaff ? "" : ` with ${b.staffName}`}`).join(", ")}. See you 💈`;
  const list = p.booked.map(b => `${b.name} ב-${b.startTime}${sameStaff ? "" : ` אצל ${b.staffName}`}`).join(", ");
  return `סגור, קבעתי ${p.booked.length} תורים${sameStaff ? ` אצל ${p.staffName}` : ""} ${dayLabelWithDistance(p.date)}: ${list}. נתראה 💈`;
}

/** The fixed final-confirmation question (owner's mandated phrasing). */
export function confirmationQuestion(p: { firstName?: string | null; serviceName: string; staffName: string; mentionStaff: boolean; date: string; startTime: string; lang?: Lang }): string {
  const who = p.firstName ? `${p.firstName}, ` : "";
  if (p.lang === "en") return `${who}${who ? "just" : "Just"} before I lock it in: ${p.serviceName}${p.mentionStaff ? ` with ${p.staffName}` : ""} ${dayLabelEn(p.date)} at ${p.startTime}\nConfirm?`;
  const at = p.mentionStaff ? ` אצל ${p.staffName}` : "";
  return `${who}רגע לפני שאני קובע לך את זה סופית: ${p.serviceName}${at} ${dayLabelWithDistance(p.date)} בשעה ${p.startTime}\nמאשר?`;
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
  const who = firstNameOf(p.customer.name) ? firstNameOf(p.customer.name) + ", " : "";
  if (langOf(text) === "en") return { reply: `${who}Cancel your appointment ${dayLabelEn(dateISO)} at ${a.startTime} with ${a.staff.name}?` };
  return { reply: `${who}לבטל את התור ${dayLabelHe(dateISO)} בשעה ${a.startTime} אצל ${a.staff.name}?` };
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
  /** New customer without a full name: the system asks for it and continues on its own. */
  awaitingName?: boolean; partialName?: string | null;
  /** false = sandbox replay: never leave a real hold on the calendar. */
  hold?: boolean;
  /** More appointments the same day for people he books for (brother, son…). */
  group?: GroupItem[];
  /** The extra treatment offered right after a booking (16.10.2026): its own question, offered once. */
  upsell?: boolean; question?: string;
}): Promise<string> {
  const phone = normalizeIsraeliPhone(p.phone);
  await prisma.bookingProposal.updateMany({ where: { businessId: p.businessId, phone, status: "pending" }, data: { status: "superseded", respondedAt: new Date() } });
  const created = await prisma.bookingProposal.create({
    data: {
      businessId: p.businessId, phone, conversationId: p.conversationId, kind: "confirm",
      staffId: p.staffId, serviceId: p.serviceId, date: new Date(p.date + "T00:00:00.000Z"), startTime: p.startTime,
      customerName: p.customerName ?? null, note: JSON.stringify({ note: p.note ?? null, originalRequest: p.originalRequest ?? null, staffName: p.staffName, serviceName: p.serviceName, mentionStaff: p.mentionStaff, awaitingName: !!p.awaitingName, partialName: p.partialName ?? null, ...(p.group?.length ? { group: p.group } : {}), ...(p.upsell ? { upsell: true } : {}) }),
      expiresAt: new Date(Date.now() + CONFIRM_TTL_MS),
    },
  });
  // The conversation has narrowed to ONE slot and we're waiting for a "כן":
  // keep it off the site / other chats for 5 minutes (owner's spec, 6.10.2026).
  // Listing many free times (get_available_slots) holds nothing.
  if (p.hold !== false) {
    try {
      const [ss, svc, cust] = await Promise.all([
        prisma.staffService.findFirst({ where: { staffId: p.staffId, serviceId: p.serviceId }, select: { customDuration: true } }),
        prisma.service.findUnique({ where: { id: p.serviceId }, select: { durationMinutes: true } }),
        prisma.customer.findFirst({ where: { businessId: p.businessId, OR: [{ phone }, { phone: phone.replace(/^972/, "0") }] }, select: { id: true } }),
      ]);
      const dur = ss?.customDuration ?? svc?.durationMinutes ?? 30;
      const [h, m] = p.startTime.split(":").map(Number);
      const endMin = h * 60 + m + dur;
      const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
      await holdSlot({ businessId: p.businessId, staffId: p.staffId, dateISO: p.date, startTime: p.startTime, endTime, holderKey: holderKeyForPhone(phone), customerId: cust?.id ?? null, proposalId: created.id });
      // Every extra appointment is held too (same customer → he's exempt from his own holds).
      for (let i = 0; i < (p.group ?? []).length; i++) {
        const g = p.group![i];
        const gSvc = g.serviceId ?? p.serviceId;
        const gs = await prisma.staffService.findFirst({ where: { staffId: g.staffId, serviceId: gSvc }, select: { customDuration: true } });
        const gd = gs?.customDuration ?? (g.serviceId ? (await prisma.service.findUnique({ where: { id: g.serviceId }, select: { durationMinutes: true } }))?.durationMinutes : svc?.durationMinutes) ?? 30;
        const [gh, gm] = g.startTime.split(":").map(Number);
        const ge = gh * 60 + gm + gd;
        await holdSlot({ businessId: p.businessId, staffId: g.staffId, dateISO: p.date, startTime: g.startTime, endTime: `${String(Math.floor(ge / 60)).padStart(2, "0")}:${String(ge % 60).padStart(2, "0")}`, holderKey: `${holderKeyForPhone(phone)}#g${i}`, customerId: cust?.id ?? null, proposalId: created.id });
      }
    } catch (err) { console.error("[proposal] hold failed", err); }
  }
  const lang = await convLang(p.conversationId);
  if (p.awaitingName) return nameQuestion(lang, !!p.partialName);
  if (p.question) return p.question;
  if (isVisit(p.group)) return visitConfirmationQuestion({ firstName: p.firstName, serviceName: p.serviceName, staffName: p.staffName, date: p.date, startTime: p.startTime, group: p.group!, lang });
  if (p.group?.length) return groupConfirmationQuestion({ firstName: p.firstName, mainName: p.customerName, serviceName: p.serviceName, staffName: p.staffName, date: p.date, startTime: p.startTime, group: p.group, lang });
  return confirmationQuestion({ firstName: p.firstName, serviceName: p.serviceName, staffName: p.staffName, mentionStaff: p.mentionStaff, date: p.date, startTime: p.startTime, lang });
}

// A single booking in a conversation that talked about more than one person →
// don't end on "סגור" (that is how the second appointment got lost, 5.10.2026).
// ("בשביל אחי" alone = one appointment for someone else — not a match.)
const MULTI_ASK = /(^|[\s,])(2|שני|שתי)\s*תור|לשנינו|אחד (בשבילי|לי)|(^|\s)ו(גם )?(בשביל|ל)\s?(ה?אח|ה?בן|ה?ילד|אבא|חבר|אחי|בני)|(2|שני|שתי)\s*(ילדים|אנשים|ילדות)/;

/**
 * Book what the customer just confirmed — one appointment, or the whole group —
 * and say exactly what was booked. Never a partial "סגור": if any appointment
 * failed, the agent gets a precise brief instead (what was booked, what wasn't).
 */
export async function bookConfirmedProposal(p: {
  pending: { id: string; staffId: string | null; serviceId: string | null; date: Date | null; startTime: string | null; customerName: string | null; note: string | null; conversationId: string | null };
  execTool: ExecTool;
  sandbox?: boolean; fallbackName: string | null; noteOverride?: string | null;
}): Promise<{ reply?: string; context?: string; booked: number }> {
  const { pending } = p;
  const meta = (() => { try { return JSON.parse(pending.note ?? "{}") as { note?: string | null; originalRequest?: string | null; staffName?: string; serviceName?: string; group?: GroupItem[]; upsell?: boolean }; } catch { return {}; } })();
  // A visit: every treatment booked under one visit id (16.10.2026).
  const visit = isVisit(meta.group);
  const visitId = visit ? randomUUID() : null;
  const dateISO = pending.date ? pending.date.toISOString().slice(0, 10) : "";
  const mainName = pending.customerName ?? p.fallbackName ?? "";
  const jobs = [
    { staffId: pending.staffId ?? "", staffName: meta.staffName ?? "", startTime: pending.startTime ?? "", name: nameOf(mainName) || "אתה", note: p.noteOverride || meta.note || null, serviceId: pending.serviceId ?? "", serviceName: meta.serviceName ?? "" },
    ...(meta.group ?? []).map(g => g.serviceId
      ? { staffId: g.staffId, staffName: g.staffName, startTime: g.startTime, name: nameOf(mainName) || "אתה", note: null as string | null, serviceId: g.serviceId, serviceName: g.serviceName ?? "" }
      : { staffId: g.staffId, staffName: g.staffName, startTime: g.startTime, name: nameOf(g.forName) || g.forName, note: `התור בפועל עבור: ${g.forName}`, serviceId: pending.serviceId ?? "", serviceName: meta.serviceName ?? "" }),
  ];
  const booked: typeof jobs = [], failed: { job: (typeof jobs)[number]; why: string }[] = [];
  await releaseHolds({ proposalId: pending.id });
  for (const j of jobs) {
    const res = await p.execTool("book_appointment", { staffId: j.staffId, serviceId: j.serviceId, date: dateISO, startTime: j.startTime, customerName: mainName, ...(j.note ? { note: j.note } : {}), ...(visitId ? { visitId } : {}) });
    if (p.sandbox || res.startsWith("✅")) booked.push(j); else failed.push({ job: j, why: res.slice(0, 120) });
  }
  await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: booked.length ? "accepted" : "rejected", respondedAt: new Date() } });
  const what = (j: (typeof jobs)[number]) => visit ? `${j.serviceName} ב-${j.startTime} אצל ${j.staffName}` : `${j.name} ב-${j.startTime} אצל ${j.staffName}`;
  if (failed.length) {
    return { booked: booked.length, context: `⚠️ הלקוח אישר ${jobs.length > 1 ? `${jobs.length} תורים` : "את התור"} ${dayLabelHe(dateISO)}. ${booked.length ? `נקבעו: ${booked.map(what).join(", ")}. ` : ""}לא נקבעו (השעה נתפסה ברגע האחרון): ${failed.map(f => what(f.job)).join(", ")}. אמור לו בדיוק מה נקבע ומה לא — אף פעם לא "סגור" כללי — והצע מיד חלופה פנויה למה שלא נקבע (בדוק עם הכלי), ואז propose_booking.` };
  }
  const lang = await convLang(pending.conversationId);
  if (visit) return { booked: booked.length, reply: visitBookedMessage({ date: dateISO, items: booked, lang }) };
  if (jobs.length > 1) return { booked: booked.length, reply: groupBookedMessage({ staffName: meta.staffName ?? "", date: dateISO, booked: booked.map(b => ({ name: b.name, startTime: b.startTime, staffName: b.staffName })), lang }) };
  let reply = bookedMessage({ staffName: meta.staffName ?? "", date: dateISO, startTime: pending.startTime ?? "", originalRequest: meta.originalRequest, lang });
  // The extra treatment right after it (16.10.2026), never after an offer that was itself extra.
  if (!meta.upsell && !meta.originalRequest) {
    const q = await offerUpsell({ proposalId: pending.id, dateISO, mainName, sandbox: !!p.sandbox }).catch(e => { console.error("[upsell]", e); return null; });
    if (q) return { booked: booked.length, reply: `${reply}\n\n${q}` };
  }
  // Safety net: the conversation was about more than one appointment → ask about the rest.
  if (pending.conversationId && !p.sandbox) {
    const recent = await prisma.conversationMessage.findMany({
      where: { conversationId: pending.conversationId, role: "user", createdAt: { gte: new Date(Date.now() - 3 * 3600_000) } },
      select: { content: true }, take: 20,
    }).catch(() => [] as { content: string }[]);
    // …unless this IS the second one (another booking in this conversation in the last 3h).
    const bookedHere = await prisma.bookingProposal.count({ where: { conversationId: pending.conversationId, kind: "confirm", status: "accepted", respondedAt: { gte: new Date(Date.now() - 3 * 3600_000) } } }).catch(() => 2);
    if (bookedHere < 2 && recent.some(m => MULTI_ASK.test(m.content || ""))) reply += (await convLang(pending.conversationId)) === "en" ? "\n\nWe also talked about another appointment, want me to book that one too?" : `\n\nודיברנו גם על תור נוסף — לקבוע גם אותו?`;
  }
  return { booked: booked.length, reply };
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

export type ProposalOutcome = { reply?: string; context?: string; silent?: boolean };

// ── "תודה" → nothing (owner's decision, 20.9.2026) ────────────────────────────
// A bare acknowledgement right after a closing message from the agent gets no
// reply and no model call — the way a barber just reads "תודה 🙏" and moves on.
const ACK_WORDS = ["תודה", "תודהה", "רבה", "אחלה", "סבבה", "מעולה", "מושלם", "פגז", "יאללה", "ביי", "להתראות", "נתראה", "אוקי", "אוקיי", "בסדר", "טוב", "מצוין", "מצויין", "אלוף", "גבר", "אחי", "כפרה", "מלך", "תותח", "נשמה", "בכיף", "אמן", "ok", "okay", "okk", "thanks", "thank", "you", "ty", "thx", "tnx", "cool", "great", "perfect", "bye", "good", "nice", "awesome", "10x", "top"];
const EMOJI_ONLY = /^(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF\u2B00-\u2BFF]|[\uFE0F\u200D\u20E3])+$/;
export function isPureAck(text: string): boolean {
  const raw = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();
  if (!raw || /[?؟\d]/.test(raw)) return false;
  const toks = tokens(raw);
  if (!toks.length || toks.length > 6) return false;
  return toks.every(t => ACK_WORDS.includes(t) || EMOJI_ONLY.test(t));
}
/** The agent's last message left nothing open: no question, no offered time, no "מתאים/רוצה". */
export function leavesNothingOpen(assistantText: string): boolean {
  if (/[?؟]/.test(assistantText)) return false;
  if (/קבעתי לך|^בוטל|נרשמת|רשמתי אותך|you're booked|^cancelled|stays as it is/i.test(assistantText)) return true;   // the system's own closings (Hebrew and English)
  return !/\d{1,2}:\d{2}/.test(assistantText) && !/פנוי|מתאים|רוצה|אפשר|איזה|איזו|מתי|תגיד|תרצה|מה השם|available|free|want|which|when|your name/i.test(assistantText);
}
const ACK_WINDOW_MS = 3 * 60 * 60 * 1000;

// ── Full name in code ─────────────────────────────────────────────────────────
// Real data (2–20.9.2026): 9 name questions, 8 answered with a full name in the
// next message, 1 answered a previous question ("בוקר"). So: a 2–4 word answer
// made of letters only, that is not a yes/no/greeting/time word, IS the name.
export const NAME_QUESTION = "רגע לפני שאני סוגר את התור, מה השם המלא שלך?";
export const FAMILY_NAME_QUESTION = "ושם המשפחה?";
export const nameQuestion = (lang: Lang, partial = false) => (lang === "en" ? (partial ? "And your last name?" : "Just before I book it, what's your full name?") : partial ? FAMILY_NAME_QUESTION : NAME_QUESTION);
const NOT_NAME = new Set<string>([...YES_STEMS, ...NO_STEMS, ...FILLER, ...ACK_WORDS, ...CANCEL_VERBS,
  "היי", "הי", "הלו", "אהלן", "בוקר", "צהריים", "צהרים", "ערב", "לילה", "מחר", "היום", "מחרתיים", "שבוע", "הבא", "ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת",
  "תור", "תספורת", "זקן", "שעה", "מתי", "איפה", "כמה", "מה", "מי", "למה", "איך", "אפשר", "רוצה", "בשעה", "אצל", "עם", "בלי", "רק", "גם", "לא", "כן", "אותו", "אותה",
  "hi", "hello", "hey", "today", "tomorrow", "morning", "evening", "name"]);
export function looksLikeName(text: string): { full?: string; partial?: string } | null {
  let raw = text.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();
  if (!raw || /[?؟\d]/.test(raw)) return null;
  raw = raw.replace(/^(שמי|השם שלי|השם הוא|קוראים לי|אני|זה|my name is|i am|i'm|it's|its)\s+/i, "").replace(/\s+(קוראים לי)$/, "");
  const toks = raw.replace(/[,.!…"״()\[\]:;]+/g, " ").split(/\s+/).filter(Boolean);
  if (toks.length < 1 || toks.length > 4) return null;
  if (!toks.every(t => /^[A-Za-zא-ת][A-Za-zא-ת'׳’\-]*$/.test(t) && t.replace(/[^A-Za-zא-ת]/g, "").length >= 2)) return null;
  if (toks.some(t => NOT_NAME.has(t.toLowerCase().replace(/['׳’]/g, "")))) return null;
  const norm = toks.map(t => /^[a-z]/i.test(t) ? t[0].toUpperCase() + t.slice(1).toLowerCase() : t).join(" ");
  return toks.length === 1 ? { partial: norm } : { full: norm };
}

/**
 * Runs BEFORE the model on every incoming customer message. Returns a reply to
 * send instead of running the model, and/or a context line for the model.
 */
export async function handleIncomingForProposal(p: {
  businessId: string; phone: string; conversationId: string; text: string;
  customer: { id: string; name: string } | null;
  execTool: ExecTool; sandbox: boolean;
  /** The agent's last message (for the "תודה" → silence rule). */
  lastAssistant?: { content: string; createdAt: Date } | null;
}): Promise<ProposalOutcome> {
  const pending = await findPendingProposal(p.businessId, p.phone);
  if (!pending) {
    if (p.lastAssistant && isPureAck(p.text) && leavesNothingOpen(p.lastAssistant.content) && Date.now() - p.lastAssistant.createdAt.getTime() < ACK_WINDOW_MS) return { silent: true };
    const cancel = await maybeStartCancelFlow({ businessId: p.businessId, phone: p.phone, conversationId: p.conversationId, text: p.text, customer: p.customer });
    if (cancel.reply || cancel.context) return cancel;
    return maybeStartMoveFlow({ businessId: p.businessId, phone: p.phone, conversationId: p.conversationId, text: p.text, customer: p.customer });
  }
  const text = p.text.trim();
  const meta = (() => { try { return JSON.parse(pending.note ?? "{}") as { note?: string | null; originalRequest?: string | null; staffName?: string; serviceName?: string; mentionStaff?: boolean; awaitingName?: boolean; partialName?: string | null }; } catch { return {}; } })();
  const dateISO = pending.date ? pending.date.toISOString().slice(0, 10) : "";

  if (pending.kind === "move") return handleMoveReply(p, pending);

  if (pending.kind === "cancel") {
    const cm = (() => { try { return JSON.parse(pending.note ?? "{}") as { appointmentId?: string; staffName?: string }; } catch { return {}; } })();
    const what = `התור ${dayLabelHe(dateISO)} בשעה ${pending.startTime} אצל ${cm.staffName ?? ""}`;
    const cls = classifyReply(text, null, "cancel");
    if (cls === "yes" && cm.appointmentId) {
      const result = await p.execTool("cancel_appointment", { appointmentId: cm.appointmentId });
      const ok = p.sandbox || /✅|בוטל/.test(result);
      await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: ok ? "accepted" : "rejected", respondedAt: new Date() } });
      if (ok) return { reply: langOf(text) === "en" ? "Cancelled. If you want to book again, I'm here 👍" : `בוטל. אם תרצה לקבוע מחדש, אני כאן 👍` };
      return { context: `הלקוח אישר לבטל את ${what} אבל הביטול נכשל: "${result.slice(0, 160)}". הסבר בכנות ועזור.` };
    }
    if (cls === "no") {
      await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: "rejected", respondedAt: new Date() } });
      return { reply: langOf(text) === "en" ? "Sure, your appointment stays as it is 👍" : `סבבה, התור נשאר כמו שהוא 👍` };
    }
    return { context: `שאלת את הלקוח אם לבטל את ${what} והוא ענה משהו אחר: "${text.slice(0, 120)}". אם הוא רוצה להזיז במקום לבטל — request_appointment_move; אם רוצה לבטל בכל זאת — cancel_appointment עם המזהה שבהנחיות, אחרי אישור.` };
  }

  if (pending.kind === "confirm") {
    const what = `${meta.serviceName ?? ""} אצל ${meta.staffName ?? ""} ${dayLabelHe(dateISO)} בשעה ${pending.startTime}`;
    if (meta.awaitingName) {
      // We asked "מה השם המלא שלך?" — the answer IS the name unless it clearly isn't.
      const nm = looksLikeName(text);
      const finish = async (full: string): Promise<ProposalOutcome> => {
        await prisma.bookingProposal.update({ where: { id: pending.id }, data: { customerName: full, note: JSON.stringify({ ...meta, awaitingName: false, partialName: null }) } });
        const grp = (meta as { group?: GroupItem[] }).group;
        return { reply: grp?.length
          ? groupConfirmationQuestion({ firstName: firstNameOf(full), mainName: full, serviceName: meta.serviceName ?? "", staffName: meta.staffName ?? "", date: dateISO, startTime: pending.startTime ?? "", group: grp, lang: await convLang(pending.conversationId) })
          : confirmationQuestion({ firstName: firstNameOf(full), serviceName: meta.serviceName ?? "", staffName: meta.staffName ?? "", mentionStaff: !!meta.mentionStaff, date: dateISO, startTime: pending.startTime ?? "", lang: await convLang(pending.conversationId) }) };
      };
      if (nm?.full) return finish(nm.full);
      if (nm?.partial && meta.partialName) return finish(`${meta.partialName} ${nm.partial}`);
      if (nm?.partial) {
        await prisma.bookingProposal.update({ where: { id: pending.id }, data: { note: JSON.stringify({ ...meta, partialName: nm.partial }) } });
        return { reply: nameQuestion(await convLang(pending.conversationId), true) };
      }
      return { context: `ביקשת מהלקוח שם מלא כדי לסגור תור (${what}) והוא ענה משהו שאינו שם: "${text.slice(0, 120)}". טפל במה שכתב, ואז בקש שוב שם מלא (פרטי + משפחה); כשיש שם מלא קרא ל-propose_booking עם אותם פרטים ו-customerName.` };
    }
    if (isPlainYes(text, pending.startTime)) {
      const r = await bookConfirmedProposal({ pending, execTool: p.execTool, sandbox: p.sandbox, fallbackName: p.customer?.name ?? null });
      return r.reply ? { reply: r.reply } : { context: r.context };
    }
    if (isPlainNo(text)) {
      await prisma.bookingProposal.update({ where: { id: pending.id }, data: { status: "rejected", respondedAt: new Date() } });
      await releaseHolds({ proposalId: pending.id });
      return { context: `הלקוח דחה את ההצעה (${what}). שאל בקצרה מה כן מתאים לו (יום/שעה/ספר) והצע חלופה; אם היום/השעה שרצה במקור לא היו פנויים — הצע רשימת המתנה.` };
    }
    return { context: `הצעת ללקוח תור (${what}) והוא עדיין לא אישר — ענה עכשיו: "${text.slice(0, 120)}". אם זו בעצם הסכמה במילים שלו ("מאושר", "יש אישור", "סגור", "קדימה") — קרא ל-propose_booking עם בדיוק אותם פרטים ו-customerConfirmed=true, והמערכת תקבע מיד בלי לשאול שוב. אם הוא מבקש שינוי (שעה/יום/ספר) — סדר את השינוי ואז propose_booking מחדש (בלי customerConfirmed). אם הוא מוסיף העדפה שלא משנה את התור ("רק תספורת בלי זקן", "בלי מכונה") — כתוב משפט קצר שמאשר לו ("אין בעיה, רק תספורת, אותו מחיר") ובאותה תשובה קרא ל-propose_booking עם אותם פרטים, customerConfirmed=true ו-note עם ההעדפה; המשפט שלך יישלח לפני הודעת הקביעה. אם זו שאלה צדדית — ענה וחזור לשאלת האישור. אל תשלח שוב את אותה שאלת אישור.` };
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
    const avail = await computeDayAvailability(p.businessId, chosen.date, staff.id, service.id, { exemptHoldsCustomerId: p.customer?.id, exemptHoldsHolderKey: holderKeyForPhone(p.phone) });
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

/** The business offers an extra treatment after a booking: settings.agentUpsell,
 *  on by default for every type but a men's barbershop. */
export function upsellOn(biz: { businessType?: string | null; settings?: string | null } | null | undefined): boolean {
  try { const v = biz?.settings ? (JSON.parse(biz.settings) as { agentUpsell?: unknown }).agentUpsell : undefined; if (typeof v === "boolean") return v; } catch { /* default */ }
  return (biz?.businessType ?? "barber_men") !== "barber_men";
}

/**
 * The extra treatment right after a booking (16.10.2026, Yair: "אם לקוחה קבעה
 * תור במכון רק ללייזר, כשהיא מסיימת לייזר אפשר לשריין לה אצל הנותנת שירות
 * השניה לק"). What the owner set to offer after this treatment, else what she
 * herself usually adds; someone must be free for it within 15 minutes of the
 * end. Once per conversation. Returns the question (a pending proposal holds the
 * slot, so her "כן" books it) or null.
 */
async function offerUpsell(p: { proposalId: string; dateISO: string; mainName: string; sandbox: boolean }): Promise<string | null> {
  const prop = await prisma.bookingProposal.findUnique({ where: { id: p.proposalId }, select: { businessId: true, phone: true, conversationId: true, serviceId: true, startTime: true } });
  if (!prop?.serviceId || !prop.conversationId || !prop.startTime) return null;
  const biz = await prisma.business.findUnique({ where: { id: prop.businessId }, select: { businessType: true, settings: true } });
  if (!upsellOn(biz)) return null;
  const offered = await prisma.bookingProposal.count({ where: { conversationId: prop.conversationId, note: { contains: `"upsell":true` }, createdAt: { gte: new Date(Date.now() - 3 * 3600_000) } } });
  if (offered) return null;
  const customer = await prisma.customer.findFirst({ where: { businessId: prop.businessId, OR: [{ phone: prop.phone }, { phone: prop.phone.replace(/^972/, "0") }] }, select: { id: true } });
  const svc = await prisma.service.findUnique({ where: { id: prop.serviceId }, select: { upsellIds: true } });
  let cands: string[] = [];
  try { const x = svc?.upsellIds ? JSON.parse(svc.upsellIds) : []; if (Array.isArray(x)) cands = x.filter((v): v is string => typeof v === "string"); } catch { /* none */ }
  if (!cands.length && customer) {
    const past = await prisma.appointment.findMany({ where: { customerId: customer.id, serviceId: { not: prop.serviceId }, status: { notIn: ["cancelled_by_customer", "cancelled_by_staff", "no_show"] }, date: { gte: new Date(Date.now() - 365 * 86_400_000) } }, select: { serviceId: true } });
    const count = new Map<string, number>();
    for (const a of past) count.set(a.serviceId, (count.get(a.serviceId) ?? 0) + 1);
    cands = Array.from(count.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => id);
  }
  const date = new Date(p.dateISO + "T00:00:00.000Z");
  const sameDay = customer ? await prisma.appointment.findMany({ where: { customerId: customer.id, date, status: { in: ["pending", "confirmed"] } }, select: { serviceId: true, startTime: true, endTime: true } }) : [];
  cands = cands.filter(id => id !== prop.serviceId && !sameDay.some(a => a.serviceId === id));
  const booked = sameDay.find(a => a.serviceId === prop.serviceId && a.startTime === prop.startTime);
  if (!cands.length || !booked) return null;
  const ctx = await loadDayContext(prop.businessId, p.dateISO, { customerId: customer?.id ?? null, holderKeys: [holderKeyForPhone(prop.phone)] });
  const [eh, em] = booked.endTime.split(":").map(Number);
  const it = findUpsell(ctx, cands, eh * 60 + em);
  if (!it) return null;
  const question = `ורוצה שאשריין לך גם ${it.serviceName} אצל ${it.staffName} מיד אחרי, ב-${it.startTime}?`;
  await createConfirmProposal({
    businessId: prop.businessId, phone: prop.phone, conversationId: prop.conversationId,
    staffId: it.staffId, staffName: it.staffName, serviceId: it.serviceId, serviceName: it.serviceName,
    date: p.dateISO, startTime: it.startTime, customerName: p.mainName || null, mentionStaff: true,
    hold: !p.sandbox, upsell: true, question,
  });
  return question;
}
