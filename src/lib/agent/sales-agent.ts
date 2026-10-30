/**
 * Chator's WhatsApp (the demo shop's number): demo + sales agent, routed by
 * CODE on every message (spec: Claude Docs "תוכנית‑העל" › "סוכן המכירות",
 * decisions 9.10.2026).
 *
 *   Who writes                    → what happens
 *   ─────────────────────────────────────────────────────────────────────────
 *   "הסר"                         → opted out: no more automations, one line back
 *   owner of a Chator business    → not sold to: the rep is alerted, one line back
 *   a registered lead (CRM)       → the sales agent, continuing from his stage;
 *                                   "wants to try" → "a call or a demo booking?"
 *   anyone else (new thread)      → the demo: a barbershop like any other, told
 *                                   in the FIRST message that it is Chator's demo;
 *                                   after a booking, one question "אתה ספר?"
 *
 * The sales model only talks; code decides when to sell, books the call (on
 * "כן" to a fixed confirmation question), and sends the price / offer as fixed
 * strings. One model call per turn — a tool call is final.
 *
 * State lives in Conversation.salesState (JSON).
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone, phoneVariants } from "@/lib/messaging/phone";
import { notifyPlatformOwner, SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { recordAgentUsage } from "@/lib/agent/usage";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { runCustomerAgent, MODEL_SMART } from "@/lib/agent/customer-agent";
import { anthropicFor } from "@/lib/anthropic-clients";
import { SALES_KNOWLEDGE, FORBIDDEN_CLAIMS, OFFER_TEXT, PRICE_TEXT, SALES_KNOWLEDGE_V2, FORBIDDEN_CLAIMS_V2, PRICE_TEXT_V2, ALLOWED_AMOUNTS_V2 } from "@/lib/agent/sales-knowledge";
import { ensureCrmSeed, freeCallSlots, slotLabel, stageLabel, getCrmText } from "@/lib/crm/core";
import { bookCall, cancelCall, alertRep, setLeadStage } from "@/lib/crm/calls";
import { stopLeadAutomations } from "@/lib/crm/automations";
import { findChatorCustomer, loadChatorCustomer, runSupportTurn, tidy } from "@/lib/agent/chator-support";
import { generateFollowup, isPhoneLikeName } from "@/lib/agent/followup-shared";
import { SECRECY_RULE, guardReply } from "@/lib/agent/prompt-guard";
import { attributionFromOpening } from "@/lib/lead-attribution";
import { computeDayAvailability } from "@/lib/agent/availability";
import { getBusinessNow, addDaysISO } from "@/lib/utils";
import { hiddenChatPhones } from "@/lib/crm/json-settings";
import { withWaTrack, mergeWa, getFunnelConfig, fillFunnelText, WANTS_REP_RE, WANTS_DETAILS_RE, type WaTrack, type FunnelConfig } from "@/lib/crm/wa-funnel";

export type SalesMode = "demo" | "pitched" | "sales" | "lead" | "declined" | "lead_demo" | "choosing";
export type SalesState = {
  mode: SalesMode;
  taggedAt: string;
  source?: string;        // "landing" | "keywords" | "lead" | "open" | "intent" | "ad"
  pitchedAt?: string;
  leadId?: string;
  fullName?: string;
  businessName?: string;
  pendingCall?: { startsAt: string; label: string; repId: string };
  demoTurns?: number;     // v2: messages inside the demo since entering it
  demoNudged?: boolean;   // v2: the one "write 'סיימתי' to stop" line was sent
  channel?: "instagram";  // a DM on @chator.il (runInstagramSalesTurn)
  contactPhone?: string;  // Instagram: the mobile he gave for the call (972…)
  // Stage 4 (14.10.2026): the signup link was sent; two reminders at most.
  signupLinkAt?: string;
  signupReminders?: number;
  // The price question got the three bubbles (price, the plans, the free signup) (26.10.2026).
  priceShownAt?: string;
  // Stage 3: the one prep question before the call was already asked.
  prepAsked?: boolean;
  // After a booking in the demo (14.10.2026): when the question about him went
  // out, and whether the next one went out by itself after a few quiet minutes.
  afterDemoAt?: string;
  afterDemoNudged?: boolean;
  // Started booking in the demo and stopped: the demo shop's follow-up was sent.
  demoFollowedUp?: boolean;
  // Came to "try booking" (TRY_BOOK_RE): the demo opened without the explanation, which
  // comes after the booking; the two follow-ups if he never answered (21.10.2026).
  revealDeferred?: boolean;
  entryNudge1At?: string;
  entryNudge2At?: string;
  // The WhatsApp funnel (25.10.2026, src/lib/crm/wa-funnel.ts): stage, follow-ups sent, exit.
  wa?: WaTrack;
};

const LANDING_TEXT_RE = /ראיתי את הדמו באתר/;
/**
 * He wrote "רוצה לנסות לקבוע תור" (the site's demo button, the WhatsApp ad) or asked
 * for "תור לדוגמה" (21.10.2026, Yair: "לא לחפור לו... ביקש במילים לקבוע תור, אז לקבוע
 * לו תור ולהסביר שזה פשוט"). The demo just books; what it was comes after the booking.
 * Plain "רוצה לקבוע תור" keeps the explanation first (V2_ENTRY_INTENT, decision 9.10).
 */
const TRY_BOOK_RE = /לנסות\s+לקבוע\s+(לי\s+)?תור|תור\s+לדוגמה/;
const TRY_BOOK_ENTRY = ["היי! 👋 כאן המספרה של דני", "למתי תרצה לקבוע? היום, מחר או יום אחר?"];
// Meta's own line when the ad's buttons don't show (WhatsApp Web, an old app, a carousel card):
// "Link:\n\nHello! Can I get more info on this?". It came from our ad, so it opens the demo like
// a button and asks what to book, as the three buttons do (30.10.2026, the marketing manager).
const AD_DEFAULT_RE = /can i get more info(?:rmation)? on this|מידע נוסף על זה/i;
const AD_DEFAULT_ENTRY = [TRY_BOOK_ENTRY[0], "על מה לקבוע לך? ציפורניים, תספורת או גוונים?"];
const TRY_BOOK_AFTER = "זו הייתה מספרת הדגמה, התור לא אמיתי 😉 ככה צ'אטור עונה ללקוחות שלך. רוצה לראות איך זה עובד אצלך?";
/** Never answered after TRY_BOOK_ENTRY: after 2 hours a real free slot, the next day at 10:00 one more line, then stop. */
const ENTRY_NUDGE_1 = (when: string | null) => (when ? `נו, יש לי מקום ${when} 😄 לשריין לך?` : "נו, למתי לשריין לך? 😄");
const ENTRY_NUDGE_2 = "עדיין רוצה לנסות? תכתוב לי שעה ואני קובע.";
// ── Instagram (@chator.il, 12.10.2026; spec "ערוץ אינסטגרם" › "צ'אטור: סוכן מכירות באינסטגרם") ──
// No demo shop on Instagram: whoever wants to try gets a link to Chator's WhatsApp
// with this prefilled text, which opens the demo there (like the site's button).
const IG_DEMO_TEXT = "היי, הגעתי מאינסטגרם ורוצה לנסות את הדמו";
const IG_DEMO_TEXT_RE = /הגעתי מאינסטגרם ורוצה לנסות את הדמו/;
/** Decision 10.10: on Instagram the first message says it is the automated agent. */
const IG_HELLO = "היי, כאן הסוכן האוטומטי של צ'אטור.";
const DEMO_TAG_RE = /הדמו|דמו באתר|דמו של|chator|צ'אטור|צ׳אטור|לעסק שלי|בעל מספרה|אני ספר(?![א-ת])|יש לי מספרה|כמה עולה המערכת|הסוכן שלכם|המערכת שלכם/i;
/** Inside a demo: the customer is asking about the PRODUCT, not a haircut. */
const PROSPECT_RE = /מערכת|סוכן|בוט|לעסק שלי|אני ספר(?![א-ת])|בעל מספרה|יש לי מספרה|מצטרפ|להצטרף|chator|צ'אטור|צ׳אטור|מנוי|לרכוש|איך זה עובד אצל/i;
const PRICE_RE = /כמה זה עולה|מה המחיר|כמה עולה|מחיר/;
const ACK_RE = /^(תודה|תודה רבה|סבבה|אחלה|מעולה|אוקיי|אוקי|בסדר|👍|🙏)[\s!.👍🙏]*$/;
// A clear no only: "לא עכשיו", "לא כרגע", "אולי בהמשך" are not a no (27.10.2026: they ended the follow-ups).
const DECLINE_RE = /^(לא|לא תודה|לא מעוניין|לא רלוונטי|אין צורך|עזוב|לא צריך)(,?\s*(תודה|תודה רבה|אחי|בינתיים))*[\s!.]*$/;
const YES_RE = /^(כן|כן בטח|בטח|ברור|נכון|אני|כן אני|מתאים|סגור|יאללה|yes|yep|ok|אוקיי)[\s!.]*$/i;
const OPT_OUT_RE = /^(הסר|הסירו|להסיר|הסרה|stop|תסיר אותי|הסר אותי)[\s!.]*$/i;
/** "לבטל את התור", "תבטל לי את התור לדוגמה", "ביטול תור". */
const DEMO_CANCEL_RE = /(לבטל|תבטל|בטל|ביטול)[^?]*תור|תור[^?]*(לבטל|ביטול)/;

/** His upcoming appointments at the demo shop, cancelled; returns when the first was ("29.10 ב14:30"), or null. */
async function cancelDemoBookings(phone: string, sandbox: boolean): Promise<string | null> {
  const customers = await prisma.customer.findMany({ where: { businessId: DEMO_BUSINESS_ID, phone: { in: [phone, phone.replace(/^972/, "0")] } }, select: { id: true } });
  if (!customers.length) return null;
  const appts = await prisma.appointment.findMany({
    where: { businessId: DEMO_BUSINESS_ID, customerId: { in: customers.map(c => c.id) }, cancelledAt: null, status: { in: ["pending", "confirmed"] }, date: { gte: new Date(`${getBusinessNow().date}T00:00:00Z`) } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }], select: { id: true, date: true, startTime: true },
  });
  if (!appts.length) return null;
  if (!sandbox) await prisma.appointment.updateMany({ where: { id: { in: appts.map(a => a.id) } }, data: { status: "cancelled_by_customer", cancelledAt: new Date() } });
  const a = appts[0];
  return `${new Date(a.date).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: "UTC" })} ב${a.startTime}`;
}
/** A lead asking to try the product himself. "דמו" alone = straight in (the automation tells him to write it). */
const DEMO_ONLY_RE = /^(דמו|לנסות|רוצה לנסות|נסיון|ניסיון|תור דמו)[\s!.]*$/;
const WANTS_TRY_RE = /לנסות|דמו|לראות איך|איך זה עובד|לבדוק את|ניסיון/;
const CHOOSE_DEMO_RE = /דמו|לנסות|תור|קודם לנסות|בעצמי/;
const CHOOSE_CALL_RE = /שיחה|לדבר|טלפון|תתקשר|יאיר/;

const REVEAL_TEXT = "היי! כאן המספרה של דני, מספרת ההדגמה של Chator. אפשר לקבוע פה תור כמו לקוח רגיל ולראות איך הסוכן עובד. התור לא אמיתי, אז אין לחץ.";
const PITCH_BUBBLES = [
  "שמת לב? קבעת תור בלי שאף אחד ענה לך. ככה זה עובד אצל מספרות שעובדות עם Chator, על הוואטסאפ של המספרה עצמה.",
  "אתה ספר או בעל מספרה? אם כן, אשמח להראות לך איך זה ייראה אצלך.",
];
/** Agent replies per chat per 24h on Chator's number (demo included). */
const REPLY_CAP_PER_DAY = 30;
const OPT_OUT_REPLY = "הוסרת. לא נשלח לך יותר הודעות.";
const OWNER_REPLY = "קיבלתי, מעביר לצוות של Chator ויחזרו אליך בהקדם.";
const LEAD_DEMO_OPENER = "מעולה. מעכשיו אני המספרה של דני, מספרת ההדגמה. תכתוב לי כמו לקוח, למשל \"יש תור מחר בערב?\", ותראה איך הלקוחות שלך יקבלו מענה.";
// ── Version 2 (spec "הסוכן של צ'אטור", decisions 10.10.2026) ──
// "כאן צ'אטור"; a stranger is a prospect first (not dropped into the demo);
// the demo is entered on request and left with one message; the warm ones
// get the signup link. Switched on by the CRM setting salesAgentV2 = "1"
// (sandbox: { v2: true }); until then everyone gets version 1 above.
const GREETING_RE = /^(היי|הי|שלום|שלום לך|אהלן|הלו|מה נשמע|ערב טוב|בוקר טוב|hello|hi|hey)[\s!.,?]*$/i;
const DONE_RE = /^(סיימתי|סיימנו|די|מספיק|הבנתי את הרעיון|הבנתי|יצאתי)[\s!.]*$/;
/** Inside the demo: a question about what the PRODUCT can do ("איך זה יכול להחליף בין לקוחות?"). */
const PRODUCT_Q_RE = /(איך|האם|מה|אפשר ש)\s*(זה|הוא|המערכת|הסוכן|הבוט)\s+(יכול|יודע|עובד|מחליף|עושה|מטפל|שולח|מזכיר|קובע)|זה יכול ל|הוא יכול ל|מה עוד (הוא|זה)|(להחליף|החלפה|החלפות) בין לקוחות|אצלי במספרה|במספרה שלי|ללקוחות שלי/;
const FROM_DEMO_NOTE = "הוא היה בתוך הדמו ושאל שאלה על המערכת עצמה. ענה עליה ישירות ובקצרה מתוך הידע, בלי להגיד שהוא יצא מהדמו, ואז הצע להמשיך לנסות או שיחה עם יאיר.";
const HANDOFF_WAIT = "השיחה אצל טיפול אנושי, יחזרו אליך בהקדם.";
const SIGNUP_URL = `${process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app"}/signup`;
const V2_ENTRY_LANDING = "היי, כאן צ'אטור. מעכשיו אני המספרה של דני, מספרת ההדגמה. תכתוב לי כמו לקוח, למשל \"יש תור מחר בערב?\", ותראה מה הלקוחות שלך יקבלו. התור לא אמיתי.";
const V2_ENTRY = "מעולה. מעכשיו אני המספרה של דני, מספרת ההדגמה. תכתוב לי כמו לקוח, למשל \"יש תור מחר בערב?\". התור לא אמיתי, וכשתסיים פשוט תכתוב \"סיימתי\".";
// A first message that sounds like a customer booking a haircut opens the demo
// shop right away; one about the product starts the getting-to-know questions
// (Yair, 14.10.2026: "אם ההקשר הוא היי אני רוצה לקבוע תור לתספורת, זה מפעיל את
// הסוכן של המספרה של דני"). Since 28.10.2026 the demo shop is also a beauty salon.
const BOOKING_INTENT_RE = /תור|תספורת|להסתפר|זקן|יש מקום|פנוי|פנויה|לק ג['׳]?ל|ציפורניים|גבות|גוונים|שעווה|טיפול פנים/;
const ABOUT_SYSTEM_RE = /מערכת|צ['׳]אטור|chator|סוכן|בוט|פרטים|מחיר|עולה|לעסק|יש לי מספרה|המספרה שלי|אני ספר(?![א-ת])|בעל מספרה/i;
const V2_ENTRY_INTENT = "היי, כאן המספרה של דני, מספרת ההדגמה של צ'אטור. התור לא אמיתי, וככה בדיוק הלקוחות שלך יקבלו מענה.";
/** The first question (27.10.2026, Yair: "לצאת מנקודת הנחה שיש לו מספרה ... ולא להשאיר את השאלה פתוחה"). */
const HOW_Q = "איך אתה מתנהל היום עם הוואטסאפ של המספרה? עונה לבד בין תספורות, מישהו מהצוות, או מערכת תורים?";
const V2_OPEN_STRANGER = `היי, כאן צ'אטור. ${HOW_Q}`;
const V2_SIGNUP = `נרשמים בחינם, ותוך 15 דקות אתה רואה איך זה עובד במספרה שלך:\n${SIGNUP_URL}\nהחודש החינמי מתחיל רק כשאתה לוחץ "הפעל". אם תיתקע באמצע, תכתוב לי כאן.`;
const v2Opener = (state: SalesState): string | null => {
  const first = (state.fullName ?? "").trim().split(/\s+/)[0];
  if (state.channel === "instagram" && state.mode !== "lead") return `${IG_HELLO} ${HOW_Q}`;
  if (state.mode === "lead") return `היי${first ? ` ${first}` : ""}, כאן צ'אטור. ראיתי שהשארת פרטים${state.businessName ? ` לגבי ${state.businessName}` : " לגבי המספרה שלך"}. כמה ספרים עובדים אצלך?`;
  return state.source === "keywords" ? null : V2_OPEN_STRANGER; // an ad / product words → the model opens from what he wrote
};
async function salesV2On(sandbox?: DemoSandbox): Promise<boolean> {
  if (sandbox) return !!sandbox.v2;
  return (await getCrmText("salesAgentV2")).text === "1";
}

const declineReply = (state: SalesState) => state.pitchedAt
  ? "סבבה, בלי לחץ. ואם תרצה לשמוע עוד, אני כאן."
  : "סבבה, בלי לחץ. אפשר להמשיך לנסות את הדמו כרגיל, ואם תרצה לשמוע עוד, אני כאן.";

export function parseSalesState(raw: string | null | undefined): SalesState | null {
  if (!raw) return null;
  try { const s = JSON.parse(raw) as SalesState; return s && typeof s.mode === "string" ? s : null; } catch { return null; }
}

async function saveState(conversationId: string, state: SalesState): Promise<void> {
  // The WhatsApp funnel (25.10.2026): its stage moves with the chat, and the follow-ups it
  // already sent are kept even when this turn started from an older copy of the state.
  const cur = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { salesState: true } }).catch(() => null);
  const dbWa = parseSalesState(cur?.salesState)?.wa;
  const next = withWaTrack(dbWa ? { ...state, wa: mergeWa(dbWa, state.wa) } : state);
  await prisma.conversation.update({ where: { id: conversationId }, data: { salesState: JSON.stringify(next) } });
}

/** The funnel's switch: in the sandbox only when the test asks for it. */
async function funnelFor(sandbox?: DemoSandbox): Promise<FunnelConfig | null> {
  const cfg = await getFunnelConfig();
  return (sandbox ? sandbox.funnel : cfg.enabled) ? cfg : null;
}
const LANDING_URL = `${process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app"}/for-business`;
/**
 * "כמה זה עולה?" (Yair, 26.10.2026: "ליצור כמה בועות, ולהניע לפעולה ... תמיד לחתוך לנקודה שנרשם
 * או שיקבע שיחה"): the price with the plans page, and the free signup; two bubbles (27.10: "מינימום").
 */
const PRICE_BUBBLES = [
  `${PRICE_TEXT_V2} כל המסלולים: ${LANDING_URL}#plans`,
  `נרשמים בחינם, ותוך 15 דקות זה עובד במספרה שלך:\n${SIGNUP_URL}`,
];

/** True when a message would open a demo/prospect conversation (kept for the tests and the source tag). */
export function looksLikeDemoOpener(text: string): { tagged: boolean; source?: "landing" | "keywords" } {
  if (LANDING_TEXT_RE.test(text) || IG_DEMO_TEXT_RE.test(text)) return { tagged: true, source: "landing" };
  if (DEMO_TAG_RE.test(text)) return { tagged: true, source: "keywords" };
  return { tagged: false };
}

export function looksLikeProspect(text: string, mode: SalesMode): boolean {
  if (mode === "sales" || mode === "lead") return true;
  if (mode === "declined") return false;
  if (PROSPECT_RE.test(text)) return true;
  if (mode === "pitched") return PRICE_RE.test(text) || !ACK_RE.test(text);
  return false;
}

export type DemoTurnResult = { handled: boolean; mode?: SalesMode; replies?: string[] };
export type DemoSandbox = { replies: string[]; toolLog: string[]; asLead?: boolean; v2?: boolean; asCustomerId?: string; funnel?: boolean };

type LeadRow = { id: string; name: string | null; businessName: string | null; stage: string; repId: string | null; optedOut: boolean };

async function findLead(phone: string): Promise<LeadRow | null> {
  const local = phone.replace(/^972/, "0");
  return prisma.lead.findFirst({
    where: { phone: { in: [phone, local] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, businessName: true, stage: true, repId: true, optedOut: true },
  });
}

/** A Chator customer (owner of a business other than the demo/platform ones) writing to Chator's number. */
async function isChatorCustomer(phone: string): Promise<boolean> {
  const local = phone.replace(/^972/, "0");
  const biz = await prisma.business.findFirst({
    where: {
      id: { notIn: [DEMO_BUSINESS_ID, SUPER_ADMIN_BUSINESS_ID] },
      OR: [{ phone: { in: [phone, local] } }, { settings: { contains: `"ownerLoginPhone":"${local}"` } }, { settings: { contains: `"ownerLoginPhone":"${phone}"` } }],
    },
    select: { id: true },
  });
  return !!biz;
}

/**
 * One incoming message on Chator's number. Returns handled=false only for an
 * old thread that predates the demo (it stays with a human, as before). With
 * `sandbox` nothing is sent, no lead or call is written and nobody is alerted.
 */
export async function runDemoTurn(p: {
  phone: string;
  text: string;
  senderName?: string | null;
  alreadyPersisted?: boolean;
  sandbox?: DemoSandbox;
}): Promise<DemoTurnResult> {
  const phone = normalizeIsraeliPhone(p.phone);
  const text = p.text.trim();
  if (!text) return { handled: false };
  if (!p.sandbox) await ensureCrmSeed().catch(() => {});

  let conv = await prisma.conversation.findFirst({
    where: { businessId: DEMO_BUSINESS_ID, phone, agentType: { not: "owner" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, salesState: true, escalatedAt: true, _count: { select: { messages: true } } },
  });
  let state = parseSalesState(conv?.salesState);
  // A hidden chat (small talk with someone Yair knows, 27.10.2026): the agent never writes; the message is already saved.
  if (!p.sandbox && conv && (await hiddenChatPhones()).has(phone)) return { handled: true, mode: state?.mode, replies: [] };
  // A person (a rep from the CRM, or the phone itself) took this chat over in the
  // last 24 hours → the agent stays quiet; the message is already saved.
  if (!p.sandbox && conv?.escalatedAt && Date.now() - conv.escalatedAt.getTime() < 24 * 3600_000 && !OPT_OUT_RE.test(text)) {
    // v2 (Yair, 10.10: "שלא ישתוק"): the lead hears once that a person has the chat,
    // unless a person already answered him here.
    if (await salesV2On()) {
      const last = await prisma.conversationMessage.findFirst({ where: { conversationId: conv.id, role: "assistant" }, orderBy: { createdAt: "desc" }, select: { content: true, source: true } });
      if (last && last.source === "agent" && last.content !== HANDOFF_WAIT) {
        await reply(conv.id, phone, [HANDOFF_WAIT], p.sandbox);
        return { handled: true, mode: state?.mode, replies: [HANDOFF_WAIT] };
      }
    }
    return { handled: true, mode: state?.mode, replies: [] };
  }
  const lead: LeadRow | null = p.sandbox
    ? (p.sandbox.asLead ? { id: "sandbox-lead", name: "בדיקה כהן", businessName: "מספרת בדיקה", stage: "chatting", repId: null, optedOut: false } : null)
    : await findLead(phone);

  // ── Opt-out, at any point ──
  if (OPT_OUT_RE.test(text)) {
    if (lead && !p.sandbox) {
      await prisma.lead.update({ where: { id: lead.id }, data: { optedOut: true, lastInboundAt: new Date() } });
      await stopLeadAutomations(lead.id, "opted_out");
    }
    conv = conv ?? await createConv(phone);
    if (state) await saveState(conv.id, { ...state, wa: { ...state.wa, out: "opted_out", outAt: new Date().toISOString() } });
    await reply(conv.id, phone, [OPT_OUT_REPLY], p.sandbox);
    return { handled: true, mode: state?.mode, replies: [OPT_OUT_REPLY] };
  }

  if (lead && !p.sandbox) {
    await prisma.lead.update({ where: { id: lead.id }, data: { lastInboundAt: new Date() } });
    if (lead.stage === "new") await setLeadStage(lead.id, "chatting");
  }

  // ── Cap (Yair, 10.10.2026): 30 agent replies per chat per 24 hours, demo
  // included (a full journey is ~15). At the cap: one line, Yair is alerted,
  // and the chat goes quiet for a day (the escalatedAt check above).
  if (conv && !p.sandbox) {
    const sent = await prisma.conversationMessage.count({ where: { conversationId: conv.id, role: "assistant", source: "agent", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
    if (sent >= REPLY_CAP_PER_DAY) {
      const line = "מעביר לטיפול אנושי, יאיר יחזור אליך.";
      await prisma.conversation.update({ where: { id: conv.id }, data: { escalatedAt: new Date() } });
      await alertRep(lead?.repId ?? null, `💬 ${lead?.name || phone.replace(/^972/, "0")} הגיע ל־${REPLY_CAP_PER_DAY} תשובות של הסוכן ביממה. כנראה חם, שווה להתקשר.`, { kind: "lead", leadId: lead?.id ?? null, push: true });
      await reply(conv.id, phone, [line], p.sandbox);
      return { handled: true, mode: state?.mode, replies: [line] };
    }
  }

  // ── Stages 5–6 (14.10.2026): a number that owns a shop is a customer: setup help
  // or support, never sales. Wins over a lead and over any sales state.
  if (await salesV2On(p.sandbox)) {
    const customer = p.sandbox ? (p.sandbox.asCustomerId ? await loadChatorCustomer(p.sandbox.asCustomerId) : null) : await findChatorCustomer(phone);
    if (customer) {
      conv = conv ?? await createConv(phone);
      if (!p.alreadyPersisted) {
        await prisma.conversationMessage.create({ data: { conversationId: conv.id, role: "user", content: text } });
        await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
      }
      const out = await runSupportTurn({ conversationId: conv.id, phone, text, biz: customer, sandbox: p.sandbox });
      return { handled: true, mode: state?.mode, replies: out.replies };
    }
  }

  // ── A Chator customer: not a sales conversation ──
  if (!lead && !state && !p.sandbox && await isChatorCustomer(phone)) {
    conv = conv ?? await createConv(phone);
    await alertRep(null, `לקוח של Chator כתב למספר של צ'אטור (${phone.replace(/^972/, "0")}): ${text.slice(0, 200)}`, { kind: "customer", push: true });
    await reply(conv.id, phone, [OWNER_REPLY], p.sandbox);
    return { handled: true, replies: [OWNER_REPLY] };
  }

  const v2 = await salesV2On(p.sandbox);
  if (!state) {
    // An old thread at this number that never was a demo stays with a human, as before.
    if (!lead && conv && conv._count.messages > 6) return { handled: false };
    conv = conv ?? await createConv(phone);
    if (lead) {
      state = { mode: "lead", taggedAt: new Date().toISOString(), source: "lead", leadId: lead.id, fullName: lead.name ?? undefined, businessName: lead.businessName ?? undefined };
    } else if (v2) {
      // v2: the site's "try it" button goes straight into the demo; anyone else is a prospect.
      const opener = looksLikeDemoOpener(text);
      const fromAd = AD_DEFAULT_RE.test(text);
      if (fromAd || TRY_BOOK_RE.test(text)) {
        state = { mode: "demo", taggedAt: new Date().toISOString(), source: fromAd ? "ad" : opener.source ?? "intent", demoTurns: 0, revealDeferred: true };
        await saveState(conv.id, state);
        if (!p.alreadyPersisted) await prisma.conversationMessage.create({ data: { conversationId: conv.id, role: "user", content: text } });
        const entry = fromAd ? AD_DEFAULT_ENTRY : TRY_BOOK_ENTRY;
        await reply(conv.id, phone, entry, p.sandbox);
        return { handled: true, mode: state.mode, replies: entry };
      }
      if (opener.source === "landing") {
        state = { mode: "demo", taggedAt: new Date().toISOString(), source: "landing", demoTurns: 0 };
        await saveState(conv.id, state);
        if (!p.alreadyPersisted) await prisma.conversationMessage.create({ data: { conversationId: conv.id, role: "user", content: text } });
        const funnel = await funnelFor(p.sandbox);
        const entry = funnel?.repLineFirstReply && funnel.repLine ? `${V2_ENTRY_LANDING}\n\n${funnel.repLine}` : V2_ENTRY_LANDING;
        await reply(conv.id, phone, [entry], p.sandbox);
        return { handled: true, mode: state.mode, replies: [entry] };
      }
      if (BOOKING_INTENT_RE.test(text) && !ABOUT_SYSTEM_RE.test(text) && !PRICE_RE.test(text)) {
        state = { mode: "demo", taggedAt: new Date().toISOString(), source: "intent", demoTurns: 0 };
        await saveState(conv.id, state);
        if (!p.alreadyPersisted) {
          await prisma.conversationMessage.create({ data: { conversationId: conv.id, role: "user", content: text } });
          await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
        }
        await reply(conv.id, phone, [V2_ENTRY_INTENT], p.sandbox);
        const out = await runDemoBooking(conv.id, phone, text, state, p, false, v2, lead);
        return { handled: true, mode: out.mode ?? state.mode, replies: [V2_ENTRY_INTENT, ...(out.replies ?? [])] };
      }
      state = { mode: "sales", taggedAt: new Date().toISOString(), source: opener.source ?? "open" };
    } else {
      const opener = looksLikeDemoOpener(text);
      state = { mode: "demo", taggedAt: new Date().toISOString(), source: opener.source ?? "open" };
      await saveState(conv.id, state);
      // Decision 9.10: say it is Chator's demo already in the first message.
      await reply(conv.id, phone, [REVEAL_TEXT], p.sandbox);
    }
    await saveState(conv.id, state);
  } else if (lead && !state.leadId) {
    state = { ...state, leadId: lead.id };
  }
  if (!conv) return { handled: false };

  if (!p.alreadyPersisted) {
    await prisma.conversationMessage.create({ data: { conversationId: conv.id, role: "user", content: text } });
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
  }

  // ── The WhatsApp funnel (25.10.2026): "נציג" gets two times for a call with the rep; asking
  // for details or a call makes him a real lead too (Yair). Either way he leaves the funnel
  // for the leads tab, stage "new", and the rep is alerted. Not inside the demo shop, where
  // "פרטים" is a customer's word; "נציג" works everywhere.
  if (v2 && state.channel !== "instagram") {
    const wantsRep = text.length <= 60 && WANTS_REP_RE.test(text);
    const wantsDetails = !wantsRep && state.mode !== "demo" && state.mode !== "lead_demo" && WANTS_DETAILS_RE.test(text);
    const funnel = wantsRep || wantsDetails ? await funnelFor(p.sandbox) : null;
    if (funnel) {
      const isLeadNow = !!lead || !!state.leadId || state.mode === "lead" || state.mode === "lead_demo" || state.mode === "choosing";
      const name = state.fullName || (p.senderName && !isPhoneLikeName(p.senderName) ? p.senderName.trim() : "");
      if (!isLeadNow) {
        p.sandbox?.toolLog.push(`funnel_lead(${wantsRep ? "נציג" : "פרטים"})`);
        const leadId = p.sandbox ? "sandbox" : await createLead({ phone, conversationId: conv.id, fullName: name, businessName: state.businessName ?? "", businessType: null, source: state.source ?? null, stage: "new", why: wantsRep ? "כתב נציג" : `ביקש: ${text.slice(0, 80)}` });
        state = { ...state, mode: "lead", leadId, fullName: name || undefined, wa: { ...state.wa, out: "lead", outAt: new Date().toISOString(), outBy: "keyword" } };
        await saveState(conv.id, state);
      }
      if (wantsRep) {
        const rep = await repName(lead?.repId ?? null);
        if (isLeadNow && !p.sandbox) await alertRep(lead?.repId ?? null, `🙋 ${name || phone.replace(/^972/, "0")} כתב "נציג" בוואטסאפ: ${text.slice(0, 120)}`, { kind: "lead", leadId: lead?.id ?? state.leadId ?? null, push: true });
        if (state.mode !== "lead" && state.mode !== "sales") { state = { ...state, mode: "lead" }; await saveState(conv.id, state); }
        const call = state.leadId && !p.sandbox ? await prisma.salesCall.findFirst({ where: { leadId: state.leadId, status: "booked" }, orderBy: { startsAt: "asc" } }) : null;
        const line = call
          ? `${rep} כבר מעודכן ויחזור אליך כאן. השיחה שלכם נשארת ${slotLabel(call.startsAt)}.`
          : fillFunnelText(funnel.repReply, { rep, callSlots: await twoSlotsSentence(), landing: LANDING_URL, signup: SIGNUP_URL, name: name.split(/\s+/)[0] || null });
        await reply(conv.id, phone, [line], p.sandbox);
        return { handled: true, mode: state.mode, replies: [line] };
      }
    }
  }

  // ── Lead, a call is waiting for "כן" ──
  if (state.pendingCall && (state.mode === "lead" || state.mode === "sales")) {
    const pending = state.pendingCall;
    state = { ...state, pendingCall: undefined };
    await saveState(conv.id, state);
    if (YES_RE.test(text) && state.leadId) {
      if (p.sandbox) {
        p.sandbox.toolLog.push(`book_call(${pending.startsAt})`);
        const line = `סגור, קבעתי. ${pending.label} מתקשרים אליך לשיחת אפיון קצרה.`;
        await reply(conv.id, phone, [line], p.sandbox);
        return { handled: true, mode: state.mode, replies: [line] };
      }
      const r = await bookCall({ leadId: state.leadId, startsAt: new Date(pending.startsAt), repId: pending.repId, bookedBy: "agent" });
      const lines = r.ok
        ? [`סגור, קבעתי. ${r.repName} יתקשר אליך ${r.label} למספר הזה, שיחת אפיון קצרה. אם משהו משתנה, תכתוב לי כאן.`]
        : [`אוי, השעה הזאת בדיוק נתפסה. ${await twoSlotsSentence()}`];
      await reply(conv.id, phone, lines, p.sandbox);
      return { handled: true, mode: state.mode, replies: lines };
    }
    // Anything else → the model answers it below (the question is dropped).
  }

  // "לבטל את התור לדוגמה" outside the demo itself (after the pitch, or as a lead): cancelled here. The
  // sales agent has no tool for it, and once only wrote "ביטלתי" while the appointment stayed and its
  // reminder went out (Yair, 28.10.2026: "קבע תור ואז ביטל, ובסופו של דבר הוא עדיין קיבל תזכורת").
  if (state.mode !== "demo" && state.mode !== "lead_demo" && DEMO_CANCEL_RE.test(text)) {
    const when = await cancelDemoBookings(phone, !!p.sandbox);
    if (when) {
      const line = `ביטלתי את התור לדוגמה (${when}).`;
      await reply(conv.id, phone, [line], p.sandbox);
      return { handled: true, mode: state.mode, replies: [line] };
    }
  }

  // ── Lead ──
  if (state.mode === "lead" || state.mode === "choosing" || state.mode === "lead_demo") {
    if (state.mode === "lead_demo") {
      // v2: "סיימתי" or a question about the product ends the demo, back to the sale.
      if (v2 && (DONE_RE.test(text) || PROSPECT_RE.test(text) || PRODUCT_Q_RE.test(text))) {
        state = { ...state, mode: "lead" };
        await saveState(conv.id, state);
        const out = await runSalesTurn({ conversationId: conv.id, phone, text, state, senderName: p.senderName ?? null, sandbox: p.sandbox, lead, v2, note: DONE_RE.test(text) ? undefined : FROM_DEMO_NOTE });
        return { handled: true, mode: out.state.mode, replies: out.replies };
      }
      return runDemoBooking(conv.id, phone, text, state, p, true, v2, lead);
    }
    if (v2) {
      // v2: the model offers the demo (enter_demo); "דמו" alone still goes straight in.
      if (DEMO_ONLY_RE.test(text)) return enterLeadDemo(conv.id, phone, state, p, v2);
      const out = await runSalesTurn({ conversationId: conv.id, phone, text, state: state.mode === "choosing" ? { ...state, mode: "lead" } : state, senderName: p.senderName ?? null, sandbox: p.sandbox, lead, v2 });
      return { handled: true, mode: out.state.mode, replies: out.replies };
    }
    if (state.mode === "choosing") {
      if (CHOOSE_DEMO_RE.test(text) && !CHOOSE_CALL_RE.test(text)) return enterLeadDemo(conv.id, phone, state, p);
      state = { ...state, mode: "lead" };
      await saveState(conv.id, state);
    } else if (DEMO_ONLY_RE.test(text)) {
      return enterLeadDemo(conv.id, phone, state, p);
    } else if (WANTS_TRY_RE.test(text) && !PRICE_RE.test(text)) {
      state = { ...state, mode: "choosing" };
      await saveState(conv.id, state);
      const rep = await repName(lead?.repId ?? null);
      const line = `רוצה לקבוע שיחה של 10 דקות עם ${rep}, או קודם לנסות בעצמך לקבוע תור כמו לקוח?`;
      await reply(conv.id, phone, [line], p.sandbox);
      return { handled: true, mode: state.mode, replies: [line] };
    }
    const out = await runSalesTurn({ conversationId: conv.id, phone, text, state, senderName: p.senderName ?? null, sandbox: p.sandbox, lead });
    return { handled: true, mode: out.state.mode, replies: out.replies };
  }

  // ── Demo visitor ──
  if ((state.mode === "pitched" || state.mode === "sales") && DECLINE_RE.test(text)) {
    state = { ...state, mode: "declined" };
    await saveState(conv.id, state);
    const line = declineReply(state);
    await reply(conv.id, phone, [line], p.sandbox);
    return { handled: true, mode: state.mode, replies: [line] };
  }
  if (state.mode === "pitched" && ACK_RE.test(text)) return { handled: true, mode: state.mode, replies: [] };
  // v2: outside the demo every message is the sale; inside it "סיימתי" ends it.
  const toSales = v2
    ? state.mode !== "demo" || DONE_RE.test(text) || PRODUCT_Q_RE.test(text) || looksLikeProspect(text, state.mode)
    : looksLikeProspect(text, state.mode) || (state.mode === "pitched" && YES_RE.test(text));
  if (toSales) {
    const wasDemo = state.mode === "demo";
    if (state.mode !== "sales") { state = { ...state, mode: "sales" }; await saveState(conv.id, state); }
    const out = await runSalesTurn({ conversationId: conv.id, phone, text, state, senderName: p.senderName ?? null, sandbox: p.sandbox, lead, v2, note: v2 && wasDemo && !DONE_RE.test(text) ? FROM_DEMO_NOTE : undefined });
    return { handled: true, mode: out.state.mode, replies: out.replies };
  }
  return runDemoBooking(conv.id, phone, text, state, p, false, v2, lead);
}

async function createConv(phone: string): Promise<{ id: string; salesState: string | null; escalatedAt: Date | null; _count: { messages: number } }> {
  const c = await prisma.conversation.create({ data: { businessId: DEMO_BUSINESS_ID, phone, agentType: "customer", status: "active" }, select: { id: true } });
  return { id: c.id, salesState: null, escalatedAt: null, _count: { messages: 0 } };
}

async function repName(repId: string | null): Promise<string> {
  const rep = repId ? await prisma.salesRep.findUnique({ where: { id: repId }, select: { name: true } }) : await prisma.salesRep.findFirst({ where: { active: true }, orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }], select: { name: true } });
  return rep?.name ?? "יאיר";
}

async function twoSlotsSentence(): Promise<string> {
  const slots = await freeCallSlots({ limit: 2 });
  if (!slots.length) return "כרגע אין שעות פנויות ביומן, אני מעדכן את הצוות שיחזרו אליך.";
  return slots.length === 1 ? `יש לי ${slotLabel(slots[0].startsAt)}, מתאים?` : `יש לי ${slotLabel(slots[0].startsAt)} או ${slotLabel(slots[1].startsAt)}, מה נוח לך?`;
}

async function enterLeadDemo(convId: string, phone: string, state: SalesState, p: { sandbox?: DemoSandbox }, v2 = false): Promise<DemoTurnResult> {
  const next: SalesState = { ...state, mode: state.mode === "sales" ? "demo" : "lead_demo", pitchedAt: undefined, demoTurns: 0, demoNudged: false };
  await saveState(convId, next);
  const line = v2 ? V2_ENTRY : LEAD_DEMO_OPENER;
  await reply(convId, phone, [line], p.sandbox);
  return { handled: true, mode: next.mode, replies: [line] };
}

/** The ordinary booking agent of the demo shop; after a booking, the one-time follow-up. */
async function runDemoBooking(convId: string, phone: string, text: string, state: SalesState, p: { sandbox?: DemoSandbox; senderName?: string | null }, isLead: boolean, v2 = false, lead: LeadRow | null = null): Promise<DemoTurnResult> {
  const started = new Date();
  await runCustomerAgent({
    businessId: DEMO_BUSINESS_ID, phone, incomingText: text, alreadyPersisted: true,
    sandbox: p.sandbox ? { replies: p.sandbox.replies, toolLog: p.sandbox.toolLog, usageKind: "sandbox" } : undefined,
  });
  if (state.pitchedAt && !v2) return { handled: true, mode: state.mode };
  const booked = p.sandbox
    ? p.sandbox.toolLog.some(t => t.startsWith("book_appointment(") || (t.startsWith("propose_booking(") && /customerConfirmed/.test(t))) || p.sandbox.replies.some(r => /^סגור, קבעתי לך/.test(r))
    : !!(await prisma.appointment.findFirst({ where: { businessId: DEMO_BUSINESS_ID, createdAt: { gte: started }, customer: { phone: { in: [phone, phone.replace(/^972/, "0")] } } }, select: { id: true } }));
  if (v2) {
    const askedChator = p.sandbox
      ? p.sandbox.toolLog.some(t => t.startsWith("escalate_to_human") || t.startsWith("ask_owner"))
      : !!(await prisma.conversationMessage.findFirst({ where: { conversationId: convId, role: "tool", toolName: { in: ["escalate_to_human", "ask_owner"] }, createdAt: { gte: started } }, select: { id: true } }));
    if (askedChator && !booked) {
      const next: SalesState = { ...state, mode: isLead ? "lead" : "sales", demoTurns: undefined, demoNudged: undefined };
      await saveState(convId, next);
      const out = await runSalesTurn({ conversationId: convId, phone, text, state: next, senderName: p.senderName ?? null, sandbox: p.sandbox, lead, v2, note: FROM_DEMO_NOTE });
      return { handled: true, mode: out.state.mode, replies: out.replies };
    }
    return demoAfterTurnV2(convId, phone, state, p, isLead, booked);
  }
  if (!booked) return { handled: true, mode: state.mode };
  if (!p.sandbox) await new Promise(r => setTimeout(r, 3000));
  if (isLead) {
    // A lead who tried it → back to the sale, with the call on the table.
    const next: SalesState = { ...state, mode: "lead", pitchedAt: new Date().toISOString() };
    await saveState(convId, next);
    const lines = ["זה בדיוק מה שהלקוחות שלך יקבלו, על הוואטסאפ של המספרה שלך.", `נקבע שיחה של 10 דקות? ${await twoSlotsSentence()}`];
    await reply(convId, phone, lines, p.sandbox);
    return { handled: true, mode: next.mode, replies: lines };
  }
  const next: SalesState = { ...state, mode: "pitched", pitchedAt: new Date().toISOString() };
  await saveState(convId, next);
  await reply(convId, phone, PITCH_BUBBLES, p.sandbox);
  return { handled: true, mode: next.mode, replies: PITCH_BUBBLES };
}

/** After a booking in the demo (14.10.2026, Yair): the line in bold, then a
 *  question about him, not a call yet ("לשאול אותו שאלה ולא ישר לדחוף לו שיחה"). */
const AFTER_DEMO_LINE = "*ככה הלקוחות של המספרה שלך יוכלו לקבוע תור אצלנו בצ'אטור*\nאיך אתה מתנהל היום? יש לך מערכת תורים?";
/** The next question, also sent by itself when the one above gets no answer for a few minutes. */
const AI_QUESTION = "היית רוצה שסוכן AI ינהל לך את הוואטסאפ במקומך?";
/** The choice comes with the offer (Yair, 14.10.2026: "לציין שיש לו חודש חינם והקמה בחינם"). */
const CHOICE_QUESTION = (rep: string) => `מה מתאים לך: שיחת אפיון קצרה של כמה דקות עם ${rep}, או להקים לבד ולראות איך זה עובד? החודש הראשון חינם, וגם ההקמה.`;
/** After the demo shop's follow-up to someone who stopped mid-booking. */
const ABANDON_LINE = "*ככה הלקוחות שלך יקבלו כשהם ינסו לקבוע ולא יסיימו*";

/**
 * v2, after each demo message: a booking ends the demo with ONE message back
 * to the sale ("the moment after 'wow, it booked me'"); three messages without
 * a booking bring one gentle line on how to stop.
 */
async function demoAfterTurnV2(convId: string, phone: string, state: SalesState, p: { sandbox?: DemoSandbox }, isLead: boolean, booked: boolean): Promise<DemoTurnResult> {
  if (booked) {
    if (!p.sandbox) await new Promise(r => setTimeout(r, 3000));
    const next: SalesState = { ...state, mode: isLead ? "lead" : "sales", pitchedAt: new Date().toISOString(), afterDemoAt: new Date().toISOString(), demoTurns: undefined, demoNudged: undefined, demoFollowedUp: undefined };
    await saveState(convId, next);
    const line = state.revealDeferred ? TRY_BOOK_AFTER : AFTER_DEMO_LINE;
    await reply(convId, phone, [line], p.sandbox);
    return { handled: true, mode: next.mode, replies: [line] };
  }
  const turns = (state.demoTurns ?? 0) + 1;
  const next: SalesState = { ...state, demoTurns: turns };
  // Not while the demo is in the middle of a booking (it just offered times or asked for a name).
  const lastDemo = await prisma.conversationMessage.findFirst({ where: { conversationId: convId, role: "assistant" }, orderBy: { createdAt: "desc" }, select: { content: true } });
  const midBooking = !!lastDemo && /\d{1,2}:\d{2}|שם|מאשר|לאשר|כרגיל|תספורת|זקן|שירות|טיפול|איזו שעה|איזה שעה|מתי/.test(lastDemo.content);
  if (turns >= 3 && !state.demoNudged && !midBooking) {
    next.demoNudged = true;
    await saveState(convId, next);
    const line = `אגב, כשתרצה לעצור את הדמו פשוט תכתוב "סיימתי", ונראה מה הכי מתאים לך מכאן.`;
    await reply(convId, phone, [line], p.sandbox);
    return { handled: true, mode: next.mode, replies: [line] };
  }
  await saveState(convId, next);
  return { handled: true, mode: next.mode };
}

// ─── The sales model ─────────────────────────────────────────────────────────

const CAPTURE_TOOL: Anthropic.Tool = {
  name: "capture_lead",
  description: "קרא ברגע שיש לך את השם שלו. שם המספרה לא חובה: אם אמר אותו, העבר; אל תשאל עליו בנפרד. המערכת רושמת אותו ומציעה לו שעות לשיחה. פעם אחת בשיחה.",
  input_schema: {
    type: "object",
    properties: {
      fullName: { type: "string", description: "שם מלא כפי שכתב" },
      businessName: { type: "string", description: "שם המספרה או העסק, אם נתן" },
      businessType: { type: "string", enum: ["barber_men", "barber_women", "nails", "cosmetics", "other"], description: "סוג העסק אם ברור (ברירת מחדל barber_men)" },
    },
    required: ["fullName"],
  },
};
const PROPOSE_CALL_TOOL: Anthropic.Tool = {
  name: "propose_call",
  description: "הלקוח בחר שעה לשיחה (או ביקש להזיז שיחה קיימת לשעה אחרת). העבר את startsAt של השעה מהרשימה \"שעות פנויות לשיחה\" בדיוק כפי שכתוב שם. המערכת שולחת לו שאלת אישור, והשיחה נקבעת רק אחרי \"כן\". אל תכתוב בעצמך את שאלת האישור.",
  input_schema: { type: "object", properties: { startsAt: { type: "string", description: "ה-ISO מהרשימה" } }, required: ["startsAt"] },
};
const CANCEL_CALL_TOOL: Anthropic.Tool = {
  name: "cancel_call",
  description: "הלקוח ביקש לבטל את השיחה שנקבעה (בלי שעה חלופית). המערכת מבטלת ומעדכנת את הנציג.",
  input_schema: { type: "object", properties: {} },
};
const HANDOFF_TOOL: Anthropic.Tool = {
  name: "handoff_to_rep",
  description: "הלקוח ביקש בן אדם, שאל משהו שאין לו תשובה במידע למטה, ביקש הנחה או הצעה מיוחדת, או כועס. המערכת מעבירה לנציג עם סיכום.",
  input_schema: { type: "object", properties: { summary: { type: "string", description: "משפט אחד: מה הוא צריך" } }, required: ["summary"] },
};
const NOT_INTERESTED_TOOL: Anthropic.Tool = {
  name: "not_interested",
  description: "אמר בבירור שלא מעניין אותו (\"לא עכשיו\" או \"אחשוב על זה\" זה לא סירוב). המערכת מפסיקה למכור.",
  input_schema: { type: "object", properties: {} },
};
// v2
const ENTER_DEMO_TOOL: Anthropic.Tool = {
  name: "enter_demo",
  description: "הוא רוצה לנסות בעצמו לקבוע תור כמו לקוח. המערכת שולחת את משפט הכניסה לדמו ומעבירה אותו למספרת ההדגמה. אל תכתוב בעצמך את משפט הכניסה.",
  input_schema: { type: "object", properties: {} },
};
// Instagram: no phone in the chat, so the call needs his mobile too.
const CAPTURE_TOOL_IG: Anthropic.Tool = {
  name: "capture_lead",
  description: "קרא ברגע שיש לך את השם שלו ומספר נייד (באינסטגרם אין לנו את המספר שלו, והשיחה היא טלפון). שם המספרה לא חובה: אם אמר אותו, העבר. המערכת בודקת את המספר, רושמת אותו ומציעה לו שעות לשיחה. פעם אחת בשיחה.",
  input_schema: {
    type: "object",
    properties: {
      fullName: { type: "string", description: "שם כפי שכתב" },
      phone: { type: "string", description: "מספר הנייד כפי שכתב" },
      businessName: { type: "string", description: "שם המספרה או העסק, אם נתן" },
      businessType: { type: "string", enum: ["barber_men", "barber_women", "nails", "cosmetics", "other"], description: "סוג העסק אם ברור (ברירת מחדל barber_men)" },
    },
    required: ["fullName", "phone"],
  },
};
const DEMO_LINK_TOOL: Anthropic.Tool = {
  name: "send_demo_link",
  description: "הוא רוצה לנסות בעצמו. המערכת שולחת לו קישור לוואטסאפ של צ'אטור, ושם הוא קובע תור כמו לקוח במספרת ההדגמה. אל תכתוב בעצמך קישור.",
  input_schema: { type: "object", properties: {} },
};
const PREP_NOTE_TOOL: Anthropic.Tool = {
  name: "save_prep_note",
  description: "שמירת תשובה שלו לשאלת הכנה לשיחה (כמה ספרים, מערכת נוכחית, איזה מספר וואטסאפ), בכרטיס הליד ליאיר.",
  input_schema: { type: "object", properties: { note: { type: "string", description: "התשובה, קצר" } }, required: ["note"] },
};
const SIGNUP_TOOL: Anthropic.Tool = {
  name: "send_signup_link",
  description: "הוא כבר חם ורוצה להתחיל או להירשם לבד, בלי שיחה. המערכת שולחת לו את קישור ההרשמה (בחירת מסלול, חודש ראשון חינם). אל תכתוב בעצמך קישור.",
  input_schema: { type: "object", properties: {} },
};

/** v2 system prompt (spec "הסוכן של צ'אטור", 10.10.2026). */
function salesSystemV2(state: SalesState, senderName: string | null, rep: string, ctx: string, knowledge: string, firstTurn: boolean): string {
  const known = [state.fullName ? `שם: ${state.fullName}` : "", state.businessName ? `מספרה: ${state.businessName}` : "", state.contactPhone ? `נייד: ${state.contactPhone.replace(/^972/, "0")}` : ""].filter(Boolean).join(", ");
  const isLead = state.mode === "lead";
  const ig = state.channel === "instagram";
  const hello = ig ? IG_HELLO : "היי, כאן צ'אטור.";
  const opener = !firstTurn ? "" : isLead && state.source === "lead"
    ? `זו ההודעה הראשונה שלך אליו. המערכת כבר מוסיפה לפני ההודעה שלך "${hello}", אז אל תפתח בברכה. ענה במשפט על מה שכתב, הזכר שהשאיר פרטים לגבי המספרה שלו, וסיים בשאלה אחת על המספרה. אתה צ'אטור, לא המספרה שלו.`
    : state.source === "keywords"
      ? `זו ההודעה הראשונה שלך אליו (כנראה הגיע ממודעה או שמע עלינו). המערכת כבר מוסיפה לפני ההודעה שלך "${hello}", אז אל תפתח בברכה. משפט אחד מה זה, למשל "אנחנו שמים סוכן שעונה ללקוחות וקובע תורים בוואטסאפ של המספרה, גם כשאתה באמצע תספורת". אם שאל משהו, ענה עליו קודם בקצרה. סיים ב"${HOW_Q}".`
      : `זו ההודעה הראשונה שלך אליו. המערכת כבר מוסיפה לפני ההודעה שלך "${hello}", אז אל תפתח בברכה. אם שאל משהו, ענה עליו בקצרה. סיים ב"${HOW_Q}".`;
  return `אתה צ'אטור. מערכת תורים למספרות עם סוכן שעונה ללקוחות וקובע תורים בוואטסאפ של המספרה. ${ig ? "אתה מתכתב בהודעות ישירות באינסטגרם של צ'אטור (@chator.il), לא בוואטסאפ" : "אתה מתכתב בוואטסאפ על המספר של צ'אטור"}, ואתה עצמך ההדגמה הכי טובה למוצר.
זהות: אתה מציג את עצמך "כאן צ'אטור", בגוף ראשון. בלי שם של בן אדם${ig ? ". בהודעה הראשונה המערכת כבר כתבה שאתה הסוכן האוטומטי של צ'אטור, אל תחזור על זה" : ", ולא קורא לעצמך בוט מיוזמתך"}. שואלים אם אתה בוט או בן אדם: עונים בפשטות "כן, אני הסוכן של צ'אטור, וזה בדיוק מה שהלקוחות שלך יקבלו בוואטסאפ של המספרה." בלי להתפתל.

${isLead
  ? `מולך ליד רשום. המטרה: שישאר איתנו, באחת משתי דרכים, והוא בוחר: שיחת אפיון קצרה של כמה דקות עם ${rep} (${rep} מתקשר אליו), או להקים לבד ולראות איך זה עובד (send_signup_link). אם יש לו שיחה קבועה, עזור לו להזיז או לבטל, אל תציע שיחה חדשה.`
  : ig
    ? `מולך מישהו שכתב לאינסטגרם של צ'אטור. המטרה: להבין איך המספרה שלו מתנהלת היום (יש לו מספרה, לא שואלים), ואז לשאול מה מתאים לו: שיחת אפיון קצרה של כמה דקות עם ${rep}, או להקים לבד ולראות איך זה עובד (send_signup_link). באינסטגרם אין לנו את המספר שלו, ו${rep} מתקשר אליו: לשיחה צריך את השם שלו ומספר נייד, ואז capture_lead. אפשר לבקש את שניהם בשאלה אחת ("איך קוראים לך ומה המספר שלך, כדי ש${rep} יתקשר?"). שם המספרה לא חובה, אל תשאל עליו.`
    : `מולך מישהו שכתב למספר של צ'אטור. המטרה: להבין איך המספרה שלו מתנהלת היום (יש לו מספרה, לא שואלים), ואז לשאול מה מתאים לו: שיחת אפיון קצרה של כמה דקות עם ${rep}, או להקים לבד ולראות איך זה עובד (send_signup_link). לשיחה צריך רק את השם שלו, ואז capture_lead. שם המספרה לא חובה, אל תשאל עליו.`}
${known ? `ידוע: ${known}.` : ""}${senderName ? ` השם ${ig ? "באינסטגרם" : "בוואטסאפ"}: ${senderName}.` : ""}
${state.pitchedAt ? `הוא כבר ניסה את הדמו וקבע בו תור, ואחרי זה שאלת אותו איך הוא מתנהל היום ואם יש לו מערכת תורים. מכאן, במקום שלבים 1 עד 3 למטה, שאלה אחת בכל הודעה ורק מה שעוד לא נשאל:
(א) על מה שענה: משפט קצר אחד שמתחבר לזה, ואז "${AI_QUESTION}" (אם כבר נשאלה, אל תשאל שוב)
(ב) ענה כן: "${CHOICE_QUESTION(rep)}"
(ג) בחר שיחה (או "כן"): ${isLead ? "הצע שתי שעות או propose_call אם בחר" : "שאל רק איך קוראים לו"}. בחר להקים לבד: send_signup_link.
מתלבט: שאלה סגורה אחת על מה שמעכב (המחיר, הזמן, או שלא בטוח שזה יעבוד אצלו). אומר לא בבירור: not_interested.` : ""}
${opener}

מהלך השיחה:
1. שאלת היכרות אחת, רק אם עוד לא ידוע: "${HOW_Q}". אחריה לכל היותר עוד שאלה אחת (כמה ספרים אתם). כל שאלה עם אפשרויות לבחירה, לא פתוחה. לא שואלים אם יש לו מספרה.
2. אחרי שסיפר: שניים־שלושה משפטים קצרים על מה שצ'אטור פותרת בדיוק לו, מחוברים למה שסיפר (למשל מה שלא מסתדר לו היום): הסוכן שעונה ללקוחות וקובע להם תורים בוואטסאפ של המספרה, ואפליקציית הניהול (יומן לכל ספר, כרטיס לקוח, תזכורות ואישורים אוטומטיים, דשבורד הכנסות). לא רשימת פיצ'רים.
3. שאלה אחת, שתי דרכים, והוא בוחר: "רוצה שנקבע שיחת אפיון קצרה של כמה דקות עם ${rep}, או שתנסה להקים לבד ולראות איך זה עובד? החודש הראשון חינם, וגם ההקמה." בחר שיחה: שתי שעות קונקרטיות מהרשימה. בחר להקים לבד: send_signup_link. רוצה לראות קודם איך זה נראה מצד הלקוח: ${ig ? "send_demo_link (המערכת שולחת קישור)" : "enter_demo"}.
4. מי שכבר חם ואומר שהוא רוצה להתחיל, להירשם או שהוא מסתדר לבד: send_signup_link (ואפשר להציע שגם ${rep} ילווה אותו בשיחה).

${ctx}

התנגדויות, הקו לתשובה (במילים שלך, קצר):
- "יקר": תור אחד שלא הלך לאיבוד בשבוע מכסה את זה, והחודש הראשון חינם. מבקש הנחה: handoff_to_rep.
- "הלקוחות שלי אוהבים לדבר איתי": הסוכן כותב בסגנון שלך, ואתה רואה כל שיחה ויכול לקחת אותה בכל רגע.
- "מה אם הוא יטעה?": תור נקבע רק אחרי "מאשר?" של הלקוח, על היומן האמיתי. שיחה שמסתבכת עוברת אליך.
- "יש לי כבר מערכת תורים": צ'אטור היא מערכת מלאה עם יומן, והסוכן בוואטסאפ הוא מה שעושה את ההבדל. מעבר ממערכת אחרת: שיחה עם ${rep}.
- "אני לא טכני": מקימים יחד, כ־10 דקות, סריקה אחת מהטלפון.
- "לא רוצה שייגעו לי בוואטסאפ": המספר נשאר שלך, הכל נראה אצלך בטלפון, ואפשר לכבות את הסוכן בכל רגע.
- "תן לי לחשוב" / "לא עכשיו" / "אולי בהמשך": זה לא סירוב. משפט אחד, ואז send_signup_link כדי שינסה כשנוח לו. לא not_interested.

רוצה לדבר עם בן אדם: הצע שיחה עם ${rep} עם שתי שעות מהרשימה, זו המטרה. מעבירים ל${rep} (handoff_to_rep) רק כשמתעקש שיחזרו אליו עכשיו או כשאין שעות פנויות, וגם כשמבקש הנחה, שואל שאלה שאין עליה תשובה בידע למטה, מתלונן, או לקוח קיים עם בעיה.

גבולות:
- הודעה אחת קצרה, עד שני משפטים. מינימום מילים: לא מסבירים יותר ממה ששאל. בלי רשימות, בלי מקפים, בלי כוכביות, כמעט בלי אימוג'ים, בלי מילים באנגלית כשכותבים אליך בעברית. אל תפתח ב"היי" אם כבר דיברתם.
- כשאתה מציע שיחה, תמיד עם שתי שעות מהרשימה למעלה, במילים של העמודה "איך לומר". "הראשונה" / "השנייה" = לפי הסדר שבו הצעת: propose_call מיד. propose_call רק אחרי שבחר שעה שהצעת או זמן שקיים ברשימה.
- כל הודעה נגמרת בדבר אחד בלבד: שאלה אחת, או הצעה אחת (להירשם בחינם עם send_signup_link, או שיחה קצרה). לא שניהם, ולא אותה הצעה פעמיים ברצף.
- מחיר: אם שואל, אמור במילים האלה: "${PRICE_TEXT_V2}" את המסלולים הגדולים (367, 467) תזכיר רק אם שואל על מספרה גדולה או על המסלולים. אף מספר אחר, אף הנחה.
- אין לך דרך לקבוע או לבטל תורים במספרת ההדגמה: לעולם אל תכתוב שקבעת, הזזת או ביטלת תור.
- לא ממציא פיצ'רים, מספרים, לקוחות או תוצאות. פיצ'ר שלא כתוב בידע: אמור בכנות שזה לא קיים היום. לא משווה למתחרים בשם.
- לא חוזר על שאלה שכבר נשאלה, לא נכנס ללופים, ולא מנחש שכתבו לך בטעות. לא שואל אם יש לו מספרה.
- שאל שוב משהו שכבר ענית עליו: לא חוזרים על ההסבר. משפט אחד, ואז הרשמה בחינם (send_signup_link).
- "לא מעוניין" או "לא עכשיו": not_interested ומשפט אדיב אחד.
- אל תגיד שמישהו יתקשר אליו או שנקבעה שיחה, אלא אם כתוב למעלה "שיחה קבועה". אין שיחה: הצע לקבוע.

${knowledge}

${FORBIDDEN_CLAIMS_V2}`;
}

async function salesContext(state: SalesState, lead: LeadRow | null): Promise<{ block: string; slots: { iso: string; label: string; repId: string }[]; callBooked: boolean }> {
  const slots = (await freeCallSlots({ limit: 6 })).map(s => ({ iso: s.startsAt.toISOString(), label: slotLabel(s.startsAt), repId: s.repId }));
  const leadId = state.leadId ?? lead?.id;
  const call = leadId ? await prisma.salesCall.findFirst({ where: { leadId, status: "booked" }, orderBy: { startsAt: "asc" } }) : null;
  const lines = [
    lead ? `שלב ב-CRM: ${stageLabel(lead.stage)}` : "",
    call ? `שיחה קבועה: ${slotLabel(call.startsAt)}` : "אין שיחה קבועה.",
    slots.length ? `שעות פנויות לשיחה (startsAt | איך לומר):\n${slots.map(s => `${s.iso} | ${s.label}`).join("\n")}` : "אין כרגע שעות פנויות לשיחה. הצע שהצוות יחזור אליו (handoff_to_rep).",
  ].filter(Boolean);
  // Stage 3: a booked call → every message is about the call (14.10.2026).
  if (call) lines.push(state.prepAsked
    ? "יש לו שיחת אפיון קבועה. אל תמכור ואל תציע שיחה חדשה: עזור להזיז או לבטל, ענה בקצרה על שאלות (\"נרחיב בשיחה\"). אם ענה על שאלת הכנה, שמור את התשובה (save_prep_note) ואל תשאל עוד."
    : "יש לו שיחת אפיון קבועה. אל תמכור ואל תציע שיחה חדשה. בסוף התשובה שאל שאלת הכנה אחת שעוד לא ידועה: כמה ספרים ומי עונה היום בוואטסאפ, באיזו מערכת הוא היום, או איזה מספר וואטסאפ יחבר (של המספרה, לא הפרטי). אם כבר ענה: save_prep_note.");
  // Stage 4: the signup link was sent and he hasn't signed up yet.
  if (state.signupLinkAt) lines.push(`שלחת לו קישור הרשמה (${new Date(state.signupLinkAt).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" })}) והוא עוד לא נרשם. עזור לו להתחיל: ענה על שאלות על ההרשמה וההקמה, שלח שוב את הקישור אם צריך (send_signup_link), ואם הוא מתלבט הצע שיחת אפיון קצרה.`);
  return { block: lines.join("\n"), slots, callBooked: !!call };
}

function salesSystem(state: SalesState, senderName: string | null, rep: string, ctx: string): string {
  const known = [state.fullName ? `שם: ${state.fullName}` : "", state.businessName ? `מספרה: ${state.businessName}` : ""].filter(Boolean).join(", ");
  const isLead = state.mode === "lead";
  return `אתה נציג המכירות של Chator (צ'אטור): מערכת ניהול תורים למספרות עם סוכן AI שעונה ללקוחות בוואטסאפ של המספרה. אתה מתכתב בוואטסאפ, על המספר של Chator.
${isLead
  ? `מולך ליד רשום. המטרה: לקבוע לו שיחה של 10 דקות עם ${rep} (הנציג מתקשר אליו). אם יש לו שיחה קבועה, עזור לו להזיז או לבטל, אל תציע שיחה חדשה.`
  : `מולך מישהו שניסה את מספרת ההדגמה ("המספרה של דני"). המטרה: השם שלו, ואז capture_lead (שם המספרה לא חובה). שאלה אחת בכל הודעה.`}
${known ? `ידוע: ${known}.` : ""}${senderName ? ` השם בוואטסאפ: ${senderName}.` : ""}

${ctx}

סגנון: כמו בן אדם שכותב בוואטסאפ. קצר, חם, ישיר. 1–3 משפטים. בלי כוכביות, בלי רשימות, בלי מקפים, בלי אימוג'ים, בלי ביטויים קבועים. אל תפתח ב"היי" אם כבר דיברתם.

חוקים קשיחים:
- כשאתה מציע שיחה, תמיד עם שתי שעות קונקרטיות מהרשימה למעלה (הראשונות, אלא אם ביקש יום או שעה אחרים), במילים של העמודה "איך לומר". לא "מתי נוח לך?" בלי שעות.
- "הראשונה" / "השנייה" / "המוקדמת" = לפי הסדר שבו הצעת אותן בהודעה האחרונה שלך. זו בחירה: propose_call מיד, בלי לשאול שוב.
- propose_call רק אחרי שהוא בחר אחת מהשעות שהצעת או ציין בעצמו זמן שקיים ברשימה. שאל "מתי אפשר?" → עוד לא בחר: הצע שתיים, בלי propose_call.
- ענה רק מתוך "מה Chator עושה" למטה. פיצ'ר שלא כתוב שם: אמור בכנות שזה לא קיים היום.
- מחיר: אם שואל, המחיר היחיד שמותר להגיד, מילה במילה: "${PRICE_TEXT}". אף מספר אחר, אף הנחה. מבקש הנחה → handoff_to_rep.
- אל תשווה למתחרים בשם. אל תמציא לקוחות, מספרים או תוצאות.
- "לא עכשיו" או לא מעוניין → not_interested ומשפט אדיב אחד.
${isLead ? "" : `- אישר שהוא ספר או בעל מספרה → שאל רק איך קוראים לו.
- קיבלת שם ומספרה → משפט קצר אחד ("מעולה דני, נעים מאוד!") + capture_lead. ההצעה והשעות נשלחות מהמערכת אחריך.`}

${SALES_KNOWLEDGE}

${FORBIDDEN_CLAIMS}`;
}

/** One short sentence that shows we heard how he works today; no question (the caller adds it). */
async function bridgeSentence(answer: string, sandbox?: DemoSandbox): Promise<string> {
  try {
    const res = await anthropicFor(sandbox ? "test" : "prod").messages.create({
      model: MODEL_SMART, max_tokens: 80,
      system: "אתה צ'אטור, מתכתב בוואטסאפ עם בעל מספרה. הוא סיפר עכשיו איך הוא מתנהל היום עם התורים. כתוב משפט אחד קצר (עד 15 מילים) בעברית מדוברת ופשוטה, בגובה העיניים, שמראה שהבנת ומתחבר למה שסיפר. למשל: 'מכיר את זה, הוואטסאפ לא מפסיק אפילו באמצע תספורת.' בלי שאלה ובלי סימן שאלה, בלי מקף ארוך, בלי אימוג'י, בלי לפנות בשם, בלי ביטויים מליציים. החזר רק את המשפט.",
      messages: [{ role: "user", content: answer }],
    });
    void recordAgentUsage({ businessId: DEMO_BUSINESS_ID, provider: "anthropic", model: MODEL_SMART, kind: sandbox ? "sandbox" : "sales", usage: res.usage });
    const t = res.content.map(b => (b.type === "text" ? b.text : "")).join("").trim().replace(/\s*[—–]\s*/g, ", ").split("\n")[0];
    return t && !t.includes("?") && t.length <= 140 ? t : "";
  } catch { return ""; }
}

async function runSalesTurn(p: { conversationId: string; phone: string; text: string; state: SalesState; senderName: string | null; sandbox?: DemoSandbox; lead: LeadRow | null; v2?: boolean; note?: string }): Promise<{ replies: string[]; state: SalesState }> {
  let state = p.state;
  const v2 = !!p.v2;
  const history = await prisma.conversationMessage.findMany({
    where: { conversationId: p.conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" }, take: 16, select: { role: true, content: true },
  });
  const msgs: Anthropic.MessageParam[] = [];
  for (const m of history.reverse()) {
    const role = m.role === "user" ? "user" : "assistant";
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content = `${last.content as string}\n${m.content}`;
    else msgs.push({ role, content: m.content });
  }
  if (!msgs.length || msgs[msgs.length - 1].role !== "user" || !(msgs[msgs.length - 1].content as string).includes(p.text)) msgs.push({ role: "user", content: p.text });
  if (msgs[0].role !== "user") msgs.unshift({ role: "user", content: "(תחילת השיחה)" });
  const firstTurn = !history.some(m => m.role === "assistant");
  // v2: a bare "היי" as the first message gets the fixed opener (0 tokens).
  if (v2 && firstTurn && GREETING_RE.test(p.text.trim())) {
    const opener = v2Opener(state);
    if (opener) {
      const funnel = state.mode !== "lead" && state.channel !== "instagram" ? await funnelFor(p.sandbox) : null;
      const first = funnel?.repLineFirstReply && funnel.repLine ? `${opener}\n\n${funnel.repLine}` : opener;
      await saveState(p.conversationId, state);
      await reply(p.conversationId, p.phone, [first], p.sandbox);
      return { replies: [first], state };
    }
  }

  if (v2 && PRICE_RE.test(p.text) && !state.priceShownAt) {
    const out = [...PRICE_BUBBLES];
    if (firstTurn) out[0] = `${state.channel === "instagram" ? IG_HELLO : "היי, כאן צ'אטור."} ${out[0]}`;
    const funnel = firstTurn && state.mode !== "lead" && state.channel !== "instagram" ? await funnelFor(p.sandbox) : null;
    if (funnel?.repLineFirstReply && funnel.repLine) out.push(funnel.repLine);
    const now = new Date().toISOString();
    // The signup link went out: the signup reminders follow (remindSignupLinks).
    state = { ...state, priceShownAt: now, signupLinkAt: state.signupLinkAt ?? now, signupReminders: state.signupReminders ?? 0 };
    await saveState(p.conversationId, state);
    await reply(p.conversationId, p.phone, out, p.sandbox);
    return { replies: out, state };
  }

  const rep = await repName(p.lead?.repId ?? null);
  // After a demo booking the next two steps are fixed (14.10.2026, Yair). Left to
  // the general flow the model drifted back to "כמה ספרים אתם?".
  const lastAgent = [...history].reverse().find(m => m.role === "assistant")?.content ?? "";
  // His answer to "איך אתה מתנהל היום?" (not a question of his own): one short
  // sentence that connects to it, then the AI question, always (the model alone
  // sometimes asked "איזו מערכת?" instead).
  if (v2 && state.afterDemoAt && lastAgent.includes("איך אתה מתנהל היום") && !p.text.includes("?")) {
    const bridge = await bridgeSentence(p.text, p.sandbox);
    const out = [bridge ? `${bridge} ${AI_QUESTION}` : AI_QUESTION];
    state = { ...state, afterDemoNudged: true };
    await saveState(p.conversationId, state);
    await reply(p.conversationId, p.phone, out, p.sandbox);
    return { replies: out, state };
  }
  let stepNote = "";
  if (v2 && state.afterDemoAt) {
    if (lastAgent.includes("איך אתה מתנהל היום")) stepNote = `הוא ענה על השאלה איך הוא מתנהל היום. כתוב משפט קצר אחד שמתחבר למה שענה, ואז שאל בדיוק: "${AI_QUESTION}". בלי שאלות אחרות (לא כמה ספרים ולא איזו מערכת).`;
    else if (lastAgent.includes(AI_QUESTION)) stepNote = `הוא ענה על השאלה אם היה רוצה שסוכן AI ינהל לו את הוואטסאפ. ענה כן או משהו חיובי: שאל בדיוק "${CHOICE_QUESTION(rep)}". אמר לא או מתלבט: שאל בעדינות ובפשטות מה גורם לו להתלבט (למשל "מה גורם לך להתלבט?"), בלי להציע שיחה.`;
  }
  const ctx = await salesContext(state, p.lead);
  const isLead = state.mode === "lead";
  const ig = state.channel === "instagram";
  const tools = isLead ? [PROPOSE_CALL_TOOL, CANCEL_CALL_TOOL, HANDOFF_TOOL, NOT_INTERESTED_TOOL] : [ig ? CAPTURE_TOOL_IG : CAPTURE_TOOL, HANDOFF_TOOL, NOT_INTERESTED_TOOL];
  if (v2) { if (!state.pitchedAt || WANTS_TRY_RE.test(p.text)) tools.push(ig ? DEMO_LINK_TOOL : ENTER_DEMO_TOOL); tools.push(SIGNUP_TOOL); }
  if (v2 && ctx.callBooked) tools.push(PREP_NOTE_TOOL);
  const knowledge = v2 ? ((await getCrmText("salesKnowledge")).text.trim() || SALES_KNOWLEDGE_V2) : "";
  const system = (v2 ? salesSystemV2(state, p.senderName, rep, ctx.block, knowledge, firstTurn) + (p.note ? `\n\nעכשיו: ${p.note}` : "") + (stepNote ? `\n\nעכשיו: ${stepNote}` : "") : salesSystem(state, p.senderName, rep, ctx.block)) + `\n\n${SECRECY_RULE}`;
  // The leak check compares with the instructions only, not the product guide or his details.
  const instructions = system.replace(knowledge, "").replace(ctx.block, "");
  const res = await anthropicFor(p.sandbox ? "test" : "prod").messages.create({ model: MODEL_SMART, max_tokens: 500, system, tools, messages: msgs });
  void recordAgentUsage({ businessId: DEMO_BUSINESS_ID, provider: "anthropic", model: MODEL_SMART, kind: p.sandbox ? "sandbox" : "sales", usage: res.usage });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("\n").trim();
  const replies: string[] = text ? bubbles(text) : [];
  const tool = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

  // Instagram: the mobile he gave must be an Israeli mobile, or he is asked again.
  const igPhone = ig && tool?.name === "capture_lead" && !isLead ? normalizeIsraeliPhone(String((tool.input as { phone?: string }).phone ?? "")) : null;
  if (igPhone !== null && !/^9725\d{8}$/.test(igPhone)) {
    p.sandbox?.toolLog.push(`capture_lead(bad phone: ${JSON.stringify(tool?.input ?? {})})`);
    replies.length = 0;
    replies.push("המספר לא נראה לי כמו נייד ישראלי. אפשר לשלוח אותו שוב? למשל 0501234567.");
  } else if (tool?.name === "capture_lead" && !isLead) {
    const input = tool.input as { fullName?: string; businessName?: string; businessType?: string };
    const fullName = (input.fullName ?? "").trim();
    const businessName = (input.businessName ?? "").trim();
    p.sandbox?.toolLog.push(`capture_lead(${JSON.stringify(tool.input)})`);
    const leadId = p.sandbox ? "sandbox" : await createLead({ phone: igPhone ?? p.phone, conversationId: p.conversationId, fullName, businessName, businessType: input.businessType ?? null, source: ig ? "instagram" : state.source ?? null });
    state = { ...state, mode: "lead", leadId, fullName: fullName || state.fullName, businessName: businessName || state.businessName, ...(igPhone ? { contactPhone: igPhone } : {}) };
    if (v2) {
      // One message: thanks + the call with two slots.
      replies.length = 0;
      replies.push(`מעולה${fullName ? `, ${fullName.split(/\s+/)[0]}` : ""}. הצעד הבא הוא שיחת אפיון קצרה של כמה דקות עם ${rep}. ${await twoSlotsSentence()}`);
    } else {
      if (!replies.length) replies.push(`מעולה${fullName ? `, ${fullName.split(/\s+/)[0]}` : ""}!`);
      replies.push(OFFER_TEXT);
      replies.push(`הצעד הבא הוא שיחת אפיון קצרה של כמה דקות עם ${rep}. ${await twoSlotsSentence()}`);
    }
  } else if (tool?.name === "propose_call") {
    const iso = String((tool.input as { startsAt?: string }).startsAt ?? "");
    const slot = ctx.slots.find(s => s.iso === iso);
    p.sandbox?.toolLog.push(`propose_call(${iso})`);
    if (slot) {
      state = { ...state, pendingCall: { startsAt: slot.iso, label: slot.label, repId: slot.repId } };
      replies.length = 0; // the confirmation question is code's
      replies.push(`לקבוע לך שיחת אפיון קצרה עם ${rep} ${slot.label}? (כן / לא)`);
    } else if (!replies.length) replies.push(await twoSlotsSentence());
  } else if (tool?.name === "cancel_call") {
    p.sandbox?.toolLog.push("cancel_call()");
    const call = state.leadId && !p.sandbox ? await prisma.salesCall.findFirst({ where: { leadId: state.leadId, status: "booked" }, orderBy: { startsAt: "asc" } }) : null;
    if (call) await cancelCall(call.id, "lead");
    if (!replies.length) replies.push("ביטלתי. אם תרצה לקבוע שוב, אני כאן.");
  } else if (tool?.name === "handoff_to_rep") {
    const summary = String((tool.input as { summary?: string }).summary ?? "").slice(0, 300);
    p.sandbox?.toolLog.push(`handoff_to_rep(${summary})`);
    if (!p.sandbox) await alertRep(p.lead?.repId ?? null, `🙋 ${state.fullName || p.lead?.name || (ig ? "פונה מאינסטגרם" : p.phone.replace(/^972/, "0"))} מבקש נציג${ig ? " (באינסטגרם)" : ""}: ${summary}`, { kind: "lead", leadId: p.lead?.id ?? state.leadId ?? null, push: true });
    // v2: the agent stays quiet in this chat for 24 hours (runDemoTurn checks escalatedAt).
    if (v2 && !p.sandbox) await prisma.conversation.update({ where: { id: p.conversationId }, data: { escalatedAt: new Date() } }).catch(() => {});
    // The WhatsApp funnel: asking for a person makes him a real lead (the rep was just alerted).
    if (v2 && !isLead && !ig && await funnelFor(p.sandbox)) {
      const name = state.fullName || (p.senderName && !isPhoneLikeName(p.senderName) ? p.senderName.trim() : "");
      const leadId = p.sandbox ? "sandbox" : await createLead({ phone: p.phone, conversationId: p.conversationId, fullName: name, businessName: state.businessName ?? "", businessType: null, source: state.source ?? null, stage: "new", quiet: true });
      state = { ...state, mode: "lead", leadId, wa: { ...state.wa, out: "lead", outAt: new Date().toISOString(), outBy: "agent" } };
    }
    replies.length = 0;
    replies.push(v2 ? `מעביר לטיפול אנושי, ${rep} יחזור אליך.` : `מעביר ל${rep}, הוא יחזור אליך בהקדם.`);
  } else if (v2 && tool?.name === "enter_demo") {
    p.sandbox?.toolLog.push("enter_demo()");
    state = { ...state, mode: isLead ? "lead_demo" : "demo", pitchedAt: undefined, demoTurns: 0, demoNudged: false };
    replies.length = 0;
    replies.push(V2_ENTRY);
  } else if (v2 && tool?.name === "send_demo_link") {
    p.sandbox?.toolLog.push("send_demo_link()");
    replies.length = 0;
    replies.push(await demoLinkLine());
  } else if (v2 && tool?.name === "send_signup_link") {
    p.sandbox?.toolLog.push("send_signup_link()");
    // His answer stays (up to two bubbles), and the link is the last bubble (26.10.2026).
    replies.splice(2);
    replies.push(V2_SIGNUP);
    // Stage 4: two reminders if he doesn't sign up (remindSignupLinks).
    state = { ...state, signupLinkAt: new Date().toISOString(), signupReminders: 0 };
  } else if (v2 && tool?.name === "save_prep_note") {
    const note = String((tool.input as { note?: string }).note ?? "").trim();
    p.sandbox?.toolLog.push(`save_prep_note(${note})`);
    if (note && state.leadId && !p.sandbox) await prisma.leadNote.create({ data: { leadId: state.leadId, author: "הסוכן", body: `הכנה לשיחה: ${note}` } }).catch(() => {});
  } else if (tool?.name === "not_interested") {
    p.sandbox?.toolLog.push("not_interested()");
    state = { ...state, mode: isLead ? "lead" : "declined" };
    if (isLead && state.leadId && !p.sandbox) { await stopLeadAutomations(state.leadId, "not_interested"); await setLeadStage(state.leadId, "not_relevant", { lostReason: "אמר לא בוואטסאפ" }); }
    if (!replies.length) replies.push(declineReply(state));
  }
  if (!replies.length) replies.push("רגע, בודק ומיד חוזר אליך.");
  if (v2 && ctx.callBooked && !state.prepAsked) state = { ...state, prepAsked: true };

  await saveState(p.conversationId, state);
  // v2: one WhatsApp message a turn (27.10.2026, Yair: "הוא לא מפסיק לחפור ... צריך מינימום"; for a day
  // it was up to three bubbles); only allowed amounts.
  const parts = v2 ? [replies.join("\n\n")].filter(Boolean) : replies;
  // v2: the first reply always says who is writing (on Instagram: that it is the automated agent).
  if (v2 && firstTurn && parts.length && !/כאן (הסוכן האוטומטי של )?צ['׳]אטור/.test(parts.join(" "))) {
    const first = (state.fullName ?? "").trim().split(/\s+/)[0];
    parts[0] = ig ? `${IG_HELLO} ${parts[0]}` : `היי${state.mode === "lead" && first ? ` ${first}` : ""}, כאן צ'אטור. ${parts[0]}`;
  }
  const who = { agent: "sales" as const, label: `${ig ? "אינסטגרם" : p.phone}${state.fullName ? ` · ${state.fullName}` : ""}` };
  const out = v2 ? parts.map(r => tidy(guardPriceV2(guardReply(r, instructions, who)))).filter(Boolean) : guardPrice(replies.map(r => guardReply(r, instructions, who)));
  // The WhatsApp funnel: the first reply says a person is one word away ("נציג"), as its own bubble.
  if (v2 && firstTurn && state.mode !== "lead" && !ig && out.length) {
    const funnel = await funnelFor(p.sandbox);
    if (funnel?.repLineFirstReply && funnel.repLine && !out.some(r => r.includes("נציג"))) out.push(funnel.repLine);
  }
  await reply(p.conversationId, p.phone, out, p.sandbox);
  return { replies: out, state };
}

function guardPriceV2(r: string): string {
  const amounts = Array.from(r.matchAll(/(\d[\d,.]*)\s*(?:₪|ש["״]ח|שקל)/g)).map(m => m[1].replace(/[,.]/g, ""));
  return amounts.some(a => !ALLOWED_AMOUNTS_V2.includes(a)) ? PRICE_TEXT_V2 : r;
}

function bubbles(text: string): string[] {
  return text.replace(/\*\*/g, "").replace(/^\s*[-•]\s+/gm, "").split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
}

/** The only shekel amounts the agent may write are the launch price and the setup fee. */
function guardPrice(replies: string[]): string[] {
  return replies.map(r => {
    const amounts = Array.from(r.matchAll(/(\d[\d,.]*)\s*(?:₪|ש["״]ח|שקל)/g)).map(m => m[1].replace(/[,.]/g, ""));
    return amounts.some(a => a !== "287" && a !== "997") ? PRICE_TEXT : r;
  });
}

async function reply(conversationId: string, phone: string, texts: string[], sandbox?: DemoSandbox): Promise<void> {
  for (const body of texts) {
    // Saved in the sandbox too (its conversation is wiped by the test cleanup), so the
    // next turn sees what was already said, as in a real chat.
    await prisma.conversationMessage.create({ data: { conversationId, role: "assistant", content: body, source: "agent" } });
    if (sandbox) { sandbox.replies.push(body); continue; }
    await sendMessage({ businessId: DEMO_BUSINESS_ID, customerPhone: phone, kind: "sales_reply", body }).catch(e => console.error("[sales-agent] send failed", e));
  }
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }).catch(() => {});
}

// ─── Instagram (@chator.il) ──────────────────────────────────────────────────

/** A link to Chator's WhatsApp with the prefilled text that opens the demo there. */
async function demoLinkLine(): Promise<string> {
  const biz = await prisma.business.findUnique({ where: { id: DEMO_BUSINESS_ID }, select: { whatsappNumber: true } });
  const n = normalizeIsraeliPhone(biz?.whatsappNumber ?? "");
  if (!n) return `כרגע אין לי קישור לדמו. רוצה שיחת אפיון קצרה עם ${await repName(null)} במקום?`;
  return `הנה הקישור לוואטסאפ של צ'אטור. לוחצים, שולחים את ההודעה שכבר כתובה, ושם קובעים תור כמו לקוח במספרת ההדגמה: https://wa.me/${n}?text=${encodeURIComponent(IG_DEMO_TEXT)}`;
}

/**
 * One DM on Chator's Instagram (@chator.il, 12.10.2026; spec "ערוץ אינסטגרם" ›
 * "צ'אטור: סוכן מכירות באינסטגרם"). The v2 sales agent with Instagram's changes
 * (state.channel = "instagram"): no demo shop here, whoever wants to try gets a
 * link to Chator's WhatsApp (send_demo_link); a call needs his name AND mobile,
 * because Instagram has no phone; the first message says it is the automated
 * agent. The conversation key is "ig:<IGSID>", so every reply goes out on
 * Instagram. The webhook already saved the message.
 */
export async function runInstagramSalesTurn(p: { conversationId: string; key: string; text: string; senderName?: string | null; sandbox?: DemoSandbox }): Promise<DemoTurnResult> {
  const text = p.text.trim();
  if (!text) return { handled: false };
  if (!p.sandbox) await ensureCrmSeed().catch(() => {});
  const conv = await prisma.conversation.findUnique({ where: { id: p.conversationId }, select: { id: true, phone: true, salesState: true, escalatedAt: true } });
  if (!conv) return { handled: false };
  let state = parseSalesState(conv.salesState);
  if (!p.sandbox && (await hiddenChatPhones()).has(conv.phone)) return { handled: true, mode: state?.mode, replies: [] };

  // A person took this chat over in the last 24 hours (the CRM, or the Instagram app): quiet, said once.
  if (!p.sandbox && conv.escalatedAt && Date.now() - conv.escalatedAt.getTime() < 24 * 3600_000 && !OPT_OUT_RE.test(text)) {
    const last = await prisma.conversationMessage.findFirst({ where: { conversationId: conv.id, role: "assistant" }, orderBy: { createdAt: "desc" }, select: { content: true, source: true } });
    if (last && last.source === "agent" && last.content !== HANDOFF_WAIT) {
      await reply(conv.id, p.key, [HANDOFF_WAIT], p.sandbox);
      return { handled: true, mode: state?.mode, replies: [HANDOFF_WAIT] };
    }
    return { handled: true, mode: state?.mode, replies: [] };
  }

  const lead: LeadRow | null = state?.leadId && !p.sandbox
    ? await prisma.lead.findUnique({ where: { id: state.leadId }, select: { id: true, name: true, businessName: true, stage: true, repId: true, optedOut: true } })
    : null;

  if (OPT_OUT_RE.test(text)) {
    if (lead && !p.sandbox) {
      await prisma.lead.update({ where: { id: lead.id }, data: { optedOut: true, lastInboundAt: new Date() } });
      await stopLeadAutomations(lead.id, "opted_out");
    }
    await reply(conv.id, p.key, [OPT_OUT_REPLY], p.sandbox);
    return { handled: true, mode: state?.mode, replies: [OPT_OUT_REPLY] };
  }
  if (lead && !p.sandbox) {
    await prisma.lead.update({ where: { id: lead.id }, data: { lastInboundAt: new Date() } });
    if (lead.stage === "new") await setLeadStage(lead.id, "chatting");
  }

  // Same cap as WhatsApp: 30 agent replies per chat per 24 hours, then a person.
  if (!p.sandbox) {
    const sent = await prisma.conversationMessage.count({ where: { conversationId: conv.id, role: "assistant", source: "agent", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } });
    if (sent >= REPLY_CAP_PER_DAY) {
      const line = "מעביר לטיפול אנושי, יאיר יחזור אליך.";
      await prisma.conversation.update({ where: { id: conv.id }, data: { escalatedAt: new Date() } });
      await alertRep(lead?.repId ?? null, `💬 ${lead?.name || p.senderName || "פונה מאינסטגרם"} הגיע ל־${REPLY_CAP_PER_DAY} תשובות של הסוכן ביממה באינסטגרם. כנראה חם, שווה לענות לו.`, { kind: "lead", leadId: lead?.id ?? null, push: true });
      await reply(conv.id, p.key, [line], p.sandbox);
      return { handled: true, mode: state?.mode, replies: [line] };
    }
  }

  if (!state) {
    state = { mode: "sales", taggedAt: new Date().toISOString(), source: "instagram", channel: "instagram" };
    await saveState(conv.id, state);
  } else if (state.channel !== "instagram") {
    state = { ...state, channel: "instagram" };
  }

  // A call is waiting for "כן".
  if (state.pendingCall && state.mode === "lead") {
    const pending = state.pendingCall;
    state = { ...state, pendingCall: undefined };
    await saveState(conv.id, state);
    if (YES_RE.test(text) && state.leadId) {
      if (p.sandbox) {
        p.sandbox.toolLog.push(`book_call(${pending.startsAt})`);
        const line = `סגור, קבעתי. ${pending.label} מתקשרים אליך לשיחת אפיון קצרה.`;
        await reply(conv.id, p.key, [line], p.sandbox);
        return { handled: true, mode: state.mode, replies: [line] };
      }
      const r = await bookCall({ leadId: state.leadId, startsAt: new Date(pending.startsAt), repId: pending.repId, bookedBy: "agent" });
      const lines = r.ok
        ? [`סגור, קבעתי. ${r.repName} יתקשר אליך ${r.label} למספר ששלחת, שיחת אפיון קצרה. אם משהו משתנה, תכתוב לי כאן.`]
        : [`אוי, השעה הזאת בדיוק נתפסה. ${await twoSlotsSentence()}`];
      await reply(conv.id, p.key, lines, p.sandbox);
      return { handled: true, mode: state.mode, replies: lines };
    }
    // Anything else: the model answers it below (the question is dropped).
  }

  if (state.mode === "sales" && DECLINE_RE.test(text)) {
    state = { ...state, mode: "declined" };
    await saveState(conv.id, state);
    const line = "סבבה, בלי לחץ. ואם תרצה לשמוע עוד, אני כאן.";
    await reply(conv.id, p.key, [line], p.sandbox);
    return { handled: true, mode: state.mode, replies: [line] };
  }
  // Writing again after a "no" reopens the conversation.
  if (state.mode !== "lead") state = { ...state, mode: "sales" };
  const out = await runSalesTurn({ conversationId: conv.id, phone: p.key, text, state, senderName: p.senderName ?? null, sandbox: p.sandbox, lead, v2: true });
  return { handled: true, mode: out.state.mode, replies: out.replies };
}

// ─── Leads ───────────────────────────────────────────────────────────────────

async function createLead(p: { phone: string; conversationId: string; fullName: string; businessName: string; businessType: string | null; source: string | null; stage?: "new" | "chatting"; quiet?: boolean; why?: string }): Promise<string> {
  const userMsgs = await prisma.conversationMessage.findMany({ where: { conversationId: p.conversationId, role: "user" }, orderBy: { createdAt: "asc" }, take: 12, select: { content: true } });
  const summary = userMsgs.map(m => m.content.replace(/\s+/g, " ").trim()).filter(Boolean).join(" · ").slice(0, 600);
  const localPhone = p.phone.replace(/^972/, "0");
  const ig = p.source === "instagram";
  const recent = await prisma.lead.findFirst({ where: { phone: { in: phoneVariants(p.phone) } }, orderBy: { createdAt: "desc" }, select: { id: true, source: true, conversationId: true, stage: true, attribution: true } });
  // Which ad or button opened the chat (its prefilled text), for the CRM (16.10.2026).
  const attribution = attributionFromOpening(userMsgs[0]?.content);
  const rep = await prisma.salesRep.findFirst({ where: { active: true }, orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }], select: { id: true } });
  const data = {
    name: p.fullName || undefined, phone: localPhone, source: ig ? "instagram" : p.source === "landing" ? "whatsapp_demo" : "whatsapp_keywords", status: p.stage === "new" ? "new" : "contacted", stage: p.stage ?? "chatting",
    businessName: p.businessName || null, businessType: p.businessType && p.businessType !== "other" ? p.businessType : "barber_men",
    conversationId: p.conversationId, summary, lastInboundAt: new Date(),
    ...(attribution ? { attribution } : {}),
  };
  // A lead we already had (the website form, or the number he typed on Instagram) keeps where he
  // first came from, how far he got (a booked call or a trial doesn't fall back to "בשיחה"), and,
  // from Instagram, his WhatsApp chat (12.10.2026).
  const keep = recent ? {
    source: recent.source,
    ...(recent.attribution ? { attribution: recent.attribution } : {}),
    ...(recent.stage && recent.stage !== "new" ? { stage: recent.stage } : {}),
    ...(ig ? { conversationId: recent.conversationId ?? p.conversationId } : {}),
  } : {};
  const lead = recent
    ? await prisma.lead.update({ where: { id: recent.id }, data: { ...data, name: p.fullName || undefined, ...keep }, select: { id: true } })
    : await prisma.lead.create({ data: { ...data, repId: rep?.id ?? null }, select: { id: true } });

  if (recent) await prisma.leadNote.create({ data: { leadId: recent.id, author: "מערכת", body: ig ? "פנה גם באינסטגרם" : "פנה גם בוואטסאפ, לסוכן של צ'אטור" } }).catch(() => {});
  const body = `🎯 ליד חדש ${ig ? "מאינסטגרם" : "מוואטסאפ הדמו"}${recent ? " (כבר היה ליד עם המספר הזה, נשאר כרטיס אחד)" : ""}\nשם: ${p.fullName || "—"}\nמספרה: ${p.businessName || "—"}\nטלפון: ${localPhone}\n${p.why ? `למה: ${p.why}\n` : ""}${ig ? "מה כתב" : "מה ניסה"}: ${summary.slice(0, 200) || "—"}\nCRM: /admin/crm`;
  if (!p.quiet) notifyPlatformOwner(body, { kind: "lead", leadId: lead.id, push: true }).catch(() => {});
  return lead.id;
}

/** Leads nobody touched for 24h → one reminder to the owner. Runs from the minute cron. */
export async function remindStaleLeads(now: Date = new Date()): Promise<number> {
  const stale = await prisma.lead.findMany({
    where: { stage: "new", remindedAt: null, createdAt: { lte: new Date(now.getTime() - 24 * 3600_000) }, source: { in: ["whatsapp_demo", "whatsapp_keywords", "landing"] } },
    select: { id: true, name: true, phone: true, businessName: true, createdAt: true }, take: 10,
  });
  for (const l of stale) {
    await prisma.lead.update({ where: { id: l.id }, data: { remindedAt: now } });
    notifyPlatformOwner(`⏰ ליד מחכה כבר יום: ${l.name || "—"} (${l.businessName || "מספרה"}) · ${l.phone}\nCRM: /admin/crm`, { kind: "lead", leadId: l.id, push: false }).catch(() => {});
  }
  return stale.length;
}

// ─── Stage 4 (14.10.2026): the signup link was sent and not used ─────────────
// Yair: after 3 hours, then the next day at 10:00, then stop. Never at night or
// on Shabbat, and only while he hasn't written back (a reply means a live chat).
const SIGNUP_R1 = (first: string) => `היי${first ? ` ${first}` : ""}, ראיתי שעוד לא התחלת להקים את צ'אטור. רוצה שנעבור על זה יחד? זה לוקח בערך 10 דקות, ואם משהו לא ברור פשוט תכתוב לי כאן.\n${SIGNUP_URL}`;
const SIGNUP_R2 = "ואם נוח לך יותר, אפשר גם שיחת אפיון קצרה של כמה דקות עם יאיר, והוא יעשה את זה יחד איתך. רוצה שנקבע?";

function israelClock(d: Date): { day: string; weekday: number; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(d).map(x => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.weekday));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday: wd, hour: Number(parts.hour) % 24 };
}
/** Sunday–Thursday 9:00–21:00, Friday until 14:00, never on Saturday. */
function okToRemind(d: Date): boolean {
  const c = israelClock(d);
  if (c.weekday === 6) return false;
  if (c.weekday === 5) return c.hour >= 9 && c.hour < 14;
  return c.hour >= 9 && c.hour < 21;
}

/**
 * Demo follow-ups (14.10.2026, Yair), from the drip job every 5 minutes:
 *  - Started booking in the demo and stopped: after 10 quiet minutes the demo
 *    shop sends the same follow-up a real shop sends (generateFollowup), then
 *    one bold line saying that's what his customers get.
 *  - The question after a demo booking went unanswered for 5 minutes: the
 *    next one goes out by itself ("היית רוצה שסוכן AI...").
 * Once each per chat, only while the chat is fresh (under an hour), never on
 * Saturday. Sandbox numbers (972000…) are skipped, except in a dry run (tests:
 * nothing is sent or saved, the planned messages are returned).
 */
export async function followUpDemos(now: Date = new Date(), dryRun?: { phone: string; out: { phone: string; texts: string[] }[] }): Promise<number> {
  if (!dryRun && (!(await salesV2On()) || israelClock(now).weekday === 6)) return 0;
  const convs = await prisma.conversation.findMany({
    where: { businessId: DEMO_BUSINESS_ID, lastMessageAt: { gte: new Date(now.getTime() - 3600_000), lte: new Date(now.getTime() - 5 * 60_000) }, salesState: { not: null }, ...(dryRun ? { phone: dryRun.phone } : {}) },
    select: { id: true, phone: true, salesState: true, escalatedAt: true, whatsappName: true }, take: 50,
  });
  let sent = 0;
  for (const c of convs) {
    const st = parseSalesState(c.salesState);
    if (!st || (!dryRun && c.phone.startsWith("972000")) || c.phone.startsWith("ig:")) continue;
    const send = async (texts: string[], next: SalesState) => {
      if (dryRun) { dryRun.out.push({ phone: c.phone, texts }); return; }
      await saveState(c.id, next);
      if (texts.length) await reply(c.id, c.phone, texts);
    };
    if (c.escalatedAt && now.getTime() - c.escalatedAt.getTime() < 24 * 3600_000) continue;
    // Our turn only: he wrote last → the agent is on it.
    const last = await prisma.conversationMessage.findFirst({ where: { conversationId: c.id, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "desc" }, select: { role: true, createdAt: true } });
    if (!last || last.role !== "assistant") continue;
    const quiet = now.getTime() - last.createdAt.getTime();

    if (st.afterDemoAt && !st.afterDemoNudged && (st.mode === "sales" || st.mode === "lead")) {
      if (now.getTime() - new Date(st.afterDemoAt).getTime() < 5 * 60_000) continue;
      const answered = await prisma.conversationMessage.findFirst({ where: { conversationId: c.id, role: "user", createdAt: { gt: new Date(st.afterDemoAt) } }, select: { id: true } });
      await send(answered ? [] : [AI_QUESTION], { ...st, afterDemoNudged: true });
      if (!answered) sent++;
      continue;
    }

    if ((st.mode === "demo" || st.mode === "lead_demo") && !st.demoFollowedUp && (st.demoTurns ?? 0) >= 1 && quiet >= 10 * 60_000) {
      const msgs = await prisma.conversationMessage.findMany({ where: { conversationId: c.id, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "desc" }, take: 12, select: { role: true, content: true } });
      const transcript = msgs.reverse().map(m => `${m.role === "user" ? "לקוח" : "סוכן"}: ${m.content}`).join("\n");
      const raw = st.fullName || c.whatsappName || "";
      const name = raw && !isPhoneLikeName(raw) ? raw.trim().split(/\s+/)[0] : null;
      const nudge = await generateFollowup(transcript, name);
      // He closed it himself ("לא צריך", "תודה"): mark it and send nothing.
      await send(nudge ? [nudge, ABANDON_LINE] : [], { ...st, demoFollowedUp: true });
      if (nudge) sent++;
    }
  }
  sent += await followUpTryBook(now, dryRun);
  return sent;
}

/**
 * Came to "try booking" and never answered (21.10.2026): two messages at most, never at
 * night or on Shabbat (okToRemind). Only chats opened by TRY_BOOK_RE, so a student of the
 * academy writing to this number does not get them.
 */
async function followUpTryBook(now: Date, dryRun?: { phone: string; out: { phone: string; texts: string[] }[] }): Promise<number> {
  if (!dryRun && (!(await salesV2On()) || !okToRemind(now))) return 0;
  // The WhatsApp funnel sends these now ("ניסה את הדמו", wa-funnel-run.ts).
  if (!dryRun && (await getFunnelConfig()).enabled) return 0;
  const convs = await prisma.conversation.findMany({
    where: { businessId: DEMO_BUSINESS_ID, escalatedAt: null, salesState: { contains: '"revealDeferred":true' }, lastMessageAt: { gte: new Date(now.getTime() - 3 * 86_400_000), lte: new Date(now.getTime() - 2 * 3600_000) }, ...(dryRun ? { phone: dryRun.phone } : {}) },
    select: { id: true, phone: true, salesState: true }, take: 50,
  });
  let sent = 0;
  for (const c of convs) {
    const st = parseSalesState(c.salesState);
    if (!st || st.mode !== "demo" || !st.revealDeferred || (st.demoTurns ?? 0) > 0 || st.entryNudge2At) continue;
    if ((!dryRun && c.phone.startsWith("972000")) || c.phone.startsWith("ig:")) continue;
    // He wrote anything since the entry → a live chat, not a silence.
    const answered = await prisma.conversationMessage.findFirst({ where: { conversationId: c.id, role: "user", createdAt: { gt: new Date(new Date(st.taggedAt).getTime() + 1000) } }, select: { id: true } });
    if (answered) continue;
    const send = async (texts: string[], next: SalesState) => {
      if (dryRun) { dryRun.out.push({ phone: c.phone, texts }); return; }
      await saveState(c.id, next);
      await reply(c.id, c.phone, texts);
    };
    if (!st.entryNudge1At) {
      await send([ENTRY_NUDGE_1(await demoFreeSlot())], { ...st, entryNudge1At: now.toISOString() });
      sent++;
    } else if (israelClock(now).day > israelClock(new Date(st.entryNudge1At)).day && israelClock(now).hour >= 10) {
      await send([ENTRY_NUDGE_2], { ...st, entryNudge2At: now.toISOString() });
      sent++;
    }
  }
  return sent;
}

/** A real free time in the demo shop: today at least an hour from now (the evening first), else tomorrow. */
async function demoFreeSlot(): Promise<string | null> {
  const now = getBusinessNow();
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  for (const [i, label] of [[0, "היום"], [1, "מחר"]] as const) {
    const date = addDaysISO(now.date, i);
    const avail = await computeDayAvailability(DEMO_BUSINESS_ID, date).catch(() => [] as { slots: string[] }[]);
    const times = Array.from(new Set(avail.flatMap(a => a.slots))).sort().filter(t => i > 0 || toMin(t) >= now.minutes + 60);
    const pick = times.find(t => toMin(t) >= 16 * 60) ?? times[0];
    if (pick) return `${label} ב ${pick}`;
  }
  return null;
}

export async function remindSignupLinks(now: Date = new Date()): Promise<number> {
  if (!(await salesV2On()) || !okToRemind(now)) return 0;
  // With the WhatsApp funnel on, it reminds whoever isn't a lead ("קיבל קישור הרשמה"); leads stay here.
  const funnelOn = (await getFunnelConfig()).enabled;
  const convs = await prisma.conversation.findMany({
    where: { businessId: DEMO_BUSINESS_ID, salesState: { contains: "signupLinkAt" }, lastMessageAt: { gte: new Date(now.getTime() - 4 * 86400_000) } },
    select: { id: true, phone: true, salesState: true, escalatedAt: true }, take: 50,
  });
  let sent = 0;
  for (const c of convs) {
    const st = parseSalesState(c.salesState);
    if (!st?.signupLinkAt || c.phone.startsWith("972000")) continue;
    const done = (n: number) => saveState(c.id, { ...st, signupReminders: n });
    const n = st.signupReminders ?? 0;
    if (n >= 2 || st.mode === "declined") continue;
    if (c.escalatedAt && now.getTime() - c.escalatedAt.getTime() < 24 * 3600_000) continue;
    // Signed up → stage 5 takes over; stop scanning this chat.
    if (await findChatorCustomer(c.phone)) { await saveState(c.id, { ...st, signupLinkAt: undefined, signupReminders: undefined }); continue; }
    const lead = c.phone.startsWith("ig:") ? null : await findLead(c.phone);
    if (funnelOn && !lead && !st.leadId) continue;
    if (lead?.optedOut || lead?.stage === "not_relevant") { await done(2); continue; }
    // He wrote since the link: a live chat, the agent is on it; no reminders.
    const lastUser = await prisma.conversationMessage.findFirst({ where: { conversationId: c.id, role: "user" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const lastAgent = await prisma.conversationMessage.findFirst({ where: { conversationId: c.id, role: "assistant" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const linkAt = new Date(st.signupLinkAt);
    if (lastUser && lastUser.createdAt > linkAt) continue;
    let text: string | null = null;
    if (n === 0 && now.getTime() - linkAt.getTime() >= 3 * 3600_000) text = SIGNUP_R1((st.fullName ?? lead?.name ?? "").trim().split(/\s+/)[0] ?? "");
    else if (n === 1 && !c.phone.startsWith("ig:") && israelClock(now).day > israelClock(linkAt).day && israelClock(now).hour >= 10 && (!lastAgent || now.getTime() - lastAgent.createdAt.getTime() >= 3 * 3600_000)) text = SIGNUP_R2;
    if (!text) continue;
    await reply(c.id, c.phone, [text]);
    await done(n + 1);
    sent++;
  }
  return sent;
}

// For the WhatsApp funnel engine (src/lib/agent/wa-funnel-run.ts).
export { reply as salesReply, saveState as saveSalesState, createLead, repName, demoFreeSlot, SIGNUP_URL, LANDING_URL };
