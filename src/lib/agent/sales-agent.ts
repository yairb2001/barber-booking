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
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { notifyPlatformOwner, SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { pushToOwner } from "@/lib/native/push";
import { recordAgentUsage } from "@/lib/agent/usage";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { runCustomerAgent, MODEL_SMART } from "@/lib/agent/customer-agent";
import { anthropicFor } from "@/lib/anthropic-clients";
import { SALES_KNOWLEDGE, FORBIDDEN_CLAIMS, OFFER_TEXT, PRICE_TEXT } from "@/lib/agent/sales-knowledge";
import { ensureCrmSeed, freeCallSlots, slotLabel, stageLabel } from "@/lib/crm/core";
import { bookCall, cancelCall, alertRep, setLeadStage } from "@/lib/crm/calls";
import { stopLeadAutomations } from "@/lib/crm/automations";

export type SalesMode = "demo" | "pitched" | "sales" | "lead" | "declined" | "lead_demo" | "choosing";
export type SalesState = {
  mode: SalesMode;
  taggedAt: string;
  source?: string;        // "landing" | "keywords" | "lead" | "open"
  pitchedAt?: string;
  leadId?: string;
  fullName?: string;
  businessName?: string;
  pendingCall?: { startsAt: string; label: string; repId: string };
};

const LANDING_TEXT_RE = /ראיתי את הדמו באתר/;
const DEMO_TAG_RE = /הדמו|דמו באתר|דמו של|chator|צ'אטור|צ׳אטור|לעסק שלי|בעל מספרה|אני ספר(?![א-ת])|יש לי מספרה|כמה עולה המערכת|הסוכן שלכם|המערכת שלכם/i;
/** Inside a demo: the customer is asking about the PRODUCT, not a haircut. */
const PROSPECT_RE = /מערכת|סוכן|בוט|לעסק שלי|אני ספר(?![א-ת])|בעל מספרה|יש לי מספרה|מצטרפ|להצטרף|chator|צ'אטור|צ׳אטור|מנוי|לרכוש|איך זה עובד אצל/i;
const PRICE_RE = /כמה זה עולה|מה המחיר|כמה עולה|מחיר/;
const ACK_RE = /^(תודה|תודה רבה|סבבה|אחלה|מעולה|אוקיי|אוקי|בסדר|👍|🙏)[\s!.👍🙏]*$/;
const DECLINE_RE = /^(לא|לא תודה|לא עכשיו|לא מעוניין|לא רלוונטי|אין צורך|לא כרגע|אולי בהמשך|עזוב|לא צריך)(,?\s*(תודה|תודה רבה|אחי|בינתיים))*[\s!.]*$/;
const YES_RE = /^(כן|כן בטח|בטח|ברור|נכון|אני|כן אני|מתאים|סגור|יאללה|yes|yep|ok|אוקיי)[\s!.]*$/i;
const OPT_OUT_RE = /^(הסר|הסירו|להסיר|הסרה|stop|תסיר אותי|הסר אותי)[\s!.]*$/i;
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
const OPT_OUT_REPLY = "הוסרת. לא נשלח לך יותר הודעות.";
const OWNER_REPLY = "קיבלתי, מעביר לצוות של Chator ויחזרו אליך בהקדם.";
const LEAD_DEMO_OPENER = "מעולה. מעכשיו אני המספרה של דני, מספרת ההדגמה. תכתוב לי כמו לקוח, למשל \"יש תור מחר בערב?\", ותראה איך הלקוחות שלך יקבלו מענה.";
const declineReply = (state: SalesState) => state.pitchedAt
  ? "סבבה, בלי לחץ. ואם תרצה לשמוע עוד, אני כאן."
  : "סבבה, בלי לחץ. אפשר להמשיך לנסות את הדמו כרגיל, ואם תרצה לשמוע עוד, אני כאן.";

export function parseSalesState(raw: string | null | undefined): SalesState | null {
  if (!raw) return null;
  try { const s = JSON.parse(raw) as SalesState; return s && typeof s.mode === "string" ? s : null; } catch { return null; }
}

async function saveState(conversationId: string, state: SalesState): Promise<void> {
  await prisma.conversation.update({ where: { id: conversationId }, data: { salesState: JSON.stringify(state) } });
}

/** True when a message would open a demo/prospect conversation (kept for the tests and the source tag). */
export function looksLikeDemoOpener(text: string): { tagged: boolean; source?: "landing" | "keywords" } {
  if (LANDING_TEXT_RE.test(text)) return { tagged: true, source: "landing" };
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
export type DemoSandbox = { replies: string[]; toolLog: string[]; asLead?: boolean };

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
  // A person (a rep from the CRM, or the phone itself) took this chat over in the
  // last 24 hours → the agent stays quiet; the message is already saved.
  if (!p.sandbox && conv?.escalatedAt && Date.now() - conv.escalatedAt.getTime() < 24 * 3600_000 && !OPT_OUT_RE.test(text)) {
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
    await reply(conv.id, phone, [OPT_OUT_REPLY], p.sandbox);
    return { handled: true, mode: state?.mode, replies: [OPT_OUT_REPLY] };
  }

  if (lead && !p.sandbox) {
    await prisma.lead.update({ where: { id: lead.id }, data: { lastInboundAt: new Date() } });
    if (lead.stage === "new") await setLeadStage(lead.id, "chatting");
  }

  // ── A Chator customer: not a sales conversation ──
  if (!lead && !state && !p.sandbox && await isChatorCustomer(phone)) {
    conv = conv ?? await createConv(phone);
    await alertRep(null, `לקוח של Chator כתב למספר של צ'אטור (${phone.replace(/^972/, "0")}): ${text.slice(0, 200)}`);
    await reply(conv.id, phone, [OWNER_REPLY], p.sandbox);
    return { handled: true, replies: [OWNER_REPLY] };
  }

  if (!state) {
    // An old thread at this number that never was a demo stays with a human, as before.
    if (!lead && conv && conv._count.messages > 6) return { handled: false };
    conv = conv ?? await createConv(phone);
    if (lead) {
      state = { mode: "lead", taggedAt: new Date().toISOString(), source: "lead", leadId: lead.id, fullName: lead.name ?? undefined, businessName: lead.businessName ?? undefined };
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

  // ── Lead, a call is waiting for "כן" ──
  if (state.pendingCall && (state.mode === "lead" || state.mode === "sales")) {
    const pending = state.pendingCall;
    state = { ...state, pendingCall: undefined };
    await saveState(conv.id, state);
    if (YES_RE.test(text) && state.leadId) {
      if (p.sandbox) {
        p.sandbox.toolLog.push(`book_call(${pending.startsAt})`);
        const line = `סגור, קבעתי. ${pending.label} מתקשרים אליך לשיחה של 10 דקות.`;
        await reply(conv.id, phone, [line], p.sandbox);
        return { handled: true, mode: state.mode, replies: [line] };
      }
      const r = await bookCall({ leadId: state.leadId, startsAt: new Date(pending.startsAt), repId: pending.repId, bookedBy: "agent" });
      const lines = r.ok
        ? [`סגור, קבעתי. ${r.repName} יתקשר אליך ${r.label} למספר הזה, שיחה של 10 דקות. אם משהו משתנה, תכתוב לי כאן.`]
        : [`אוי, השעה הזאת בדיוק נתפסה. ${await twoSlotsSentence()}`];
      await reply(conv.id, phone, lines, p.sandbox);
      return { handled: true, mode: state.mode, replies: lines };
    }
    // Anything else → the model answers it below (the question is dropped).
  }

  // ── Lead ──
  if (state.mode === "lead" || state.mode === "choosing" || state.mode === "lead_demo") {
    if (state.mode === "lead_demo") return runDemoBooking(conv.id, phone, text, state, p, true);
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
  if (looksLikeProspect(text, state.mode) || (state.mode === "pitched" && YES_RE.test(text))) {
    if (state.mode === "demo" || state.mode === "pitched") { state = { ...state, mode: "sales" }; await saveState(conv.id, state); }
    const out = await runSalesTurn({ conversationId: conv.id, phone, text, state, senderName: p.senderName ?? null, sandbox: p.sandbox, lead });
    return { handled: true, mode: out.state.mode, replies: out.replies };
  }
  return runDemoBooking(conv.id, phone, text, state, p, false);
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

async function enterLeadDemo(convId: string, phone: string, state: SalesState, p: { sandbox?: DemoSandbox }): Promise<DemoTurnResult> {
  const next: SalesState = { ...state, mode: "lead_demo", pitchedAt: undefined };
  await saveState(convId, next);
  await reply(convId, phone, [LEAD_DEMO_OPENER], p.sandbox);
  return { handled: true, mode: next.mode, replies: [LEAD_DEMO_OPENER] };
}

/** The ordinary booking agent of the demo shop; after a booking, the one-time follow-up. */
async function runDemoBooking(convId: string, phone: string, text: string, state: SalesState, p: { sandbox?: DemoSandbox }, isLead: boolean): Promise<DemoTurnResult> {
  const started = new Date();
  await runCustomerAgent({
    businessId: DEMO_BUSINESS_ID, phone, incomingText: text, alreadyPersisted: true,
    sandbox: p.sandbox ? { replies: p.sandbox.replies, toolLog: p.sandbox.toolLog, usageKind: "sandbox" } : undefined,
  });
  if (state.pitchedAt) return { handled: true, mode: state.mode };
  const booked = p.sandbox
    ? p.sandbox.toolLog.some(t => t.startsWith("book_appointment(") || (t.startsWith("propose_booking(") && /customerConfirmed/.test(t))) || p.sandbox.replies.some(r => /^סגור, קבעתי לך/.test(r))
    : !!(await prisma.appointment.findFirst({ where: { businessId: DEMO_BUSINESS_ID, createdAt: { gte: started }, customer: { phone: { in: [phone, phone.replace(/^972/, "0")] } } }, select: { id: true } }));
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

// ─── The sales model ─────────────────────────────────────────────────────────

const CAPTURE_TOOL: Anthropic.Tool = {
  name: "capture_lead",
  description: "קרא ברגע שיש שם מלא ושם המספרה (או שאמר שאין לו עדיין מספרה, אז businessName ריק). המערכת רושמת אותו ומציעה לו שעות לשיחה. פעם אחת בשיחה.",
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
  description: "אמר בבירור שלא מעניין אותו או לא עכשיו. המערכת מפסיקה למכור.",
  input_schema: { type: "object", properties: {} },
};

async function salesContext(state: SalesState, lead: LeadRow | null): Promise<{ block: string; slots: { iso: string; label: string; repId: string }[] }> {
  const slots = (await freeCallSlots({ limit: 6 })).map(s => ({ iso: s.startsAt.toISOString(), label: slotLabel(s.startsAt), repId: s.repId }));
  const leadId = state.leadId ?? lead?.id;
  const call = leadId ? await prisma.salesCall.findFirst({ where: { leadId, status: "booked" }, orderBy: { startsAt: "asc" } }) : null;
  const lines = [
    lead ? `שלב ב-CRM: ${stageLabel(lead.stage)}` : "",
    call ? `שיחה קבועה: ${slotLabel(call.startsAt)}` : "אין שיחה קבועה.",
    slots.length ? `שעות פנויות לשיחה (startsAt | איך לומר):\n${slots.map(s => `${s.iso} | ${s.label}`).join("\n")}` : "אין כרגע שעות פנויות לשיחה. הצע שהצוות יחזור אליו (handoff_to_rep).",
  ].filter(Boolean);
  return { block: lines.join("\n"), slots };
}

function salesSystem(state: SalesState, senderName: string | null, rep: string, ctx: string): string {
  const known = [state.fullName ? `שם: ${state.fullName}` : "", state.businessName ? `מספרה: ${state.businessName}` : ""].filter(Boolean).join(", ");
  const isLead = state.mode === "lead";
  return `אתה נציג המכירות של Chator (צ'אטור): מערכת ניהול תורים למספרות עם סוכן AI שעונה ללקוחות בוואטסאפ של המספרה. אתה מתכתב בוואטסאפ, על המספר של Chator.
${isLead
  ? `מולך ליד רשום. המטרה: לקבוע לו שיחה של 10 דקות עם ${rep} (הנציג מתקשר אליו). אם יש לו שיחה קבועה, עזור לו להזיז או לבטל, אל תציע שיחה חדשה.`
  : `מולך מישהו שניסה את מספרת ההדגמה ("המספרה של דני"). המטרה: שם מלא ושם המספרה, ואז capture_lead. שאלה אחת בכל הודעה.`}
${known ? `ידוע: ${known}.` : ""}${senderName ? ` השם בוואטסאפ: ${senderName}.` : ""}

${ctx}

סגנון: כמו בן אדם שכותב בוואטסאפ. קצר, חם, ישיר. 1–3 משפטים. בלי כוכביות, בלי רשימות, בלי מקפים, כמעט בלי אימוג'ים, בלי ביטויים קבועים. אל תפתח ב"היי" אם כבר דיברתם.

חוקים קשיחים:
- שעות לשיחה: הצע רק מהרשימה למעלה, שתיים בכל פעם, במילים של העמודה "איך לומר". בחר → propose_call עם ה-startsAt המדויק.
- ענה רק מתוך "מה Chator עושה" למטה. פיצ'ר שלא כתוב שם: אמור בכנות שזה לא קיים היום.
- מחיר: אם שואל, המחיר היחיד שמותר להגיד, מילה במילה: "${PRICE_TEXT}". אף מספר אחר, אף הנחה. מבקש הנחה → handoff_to_rep.
- אל תשווה למתחרים בשם. אל תמציא לקוחות, מספרים או תוצאות.
- "לא עכשיו" או לא מעוניין → not_interested ומשפט אדיב אחד.
${isLead ? "" : `- אישר שהוא ספר או בעל מספרה → בקש שם מלא ושם המספרה בשאלה אחת.
- קיבלת שם ומספרה → משפט קצר אחד ("מעולה דני, נעים מאוד!") + capture_lead. ההצעה והשעות נשלחות מהמערכת אחריך.`}

${SALES_KNOWLEDGE}

${FORBIDDEN_CLAIMS}`;
}

async function runSalesTurn(p: { conversationId: string; phone: string; text: string; state: SalesState; senderName: string | null; sandbox?: DemoSandbox; lead: LeadRow | null }): Promise<{ replies: string[]; state: SalesState }> {
  let state = p.state;
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

  const rep = await repName(p.lead?.repId ?? null);
  const ctx = await salesContext(state, p.lead);
  const isLead = state.mode === "lead";
  const tools = isLead ? [PROPOSE_CALL_TOOL, CANCEL_CALL_TOOL, HANDOFF_TOOL, NOT_INTERESTED_TOOL] : [CAPTURE_TOOL, HANDOFF_TOOL, NOT_INTERESTED_TOOL];
  const res = await anthropicFor(p.sandbox ? "test" : "prod").messages.create({ model: MODEL_SMART, max_tokens: 500, system: salesSystem(state, p.senderName, rep, ctx.block), tools, messages: msgs });
  void recordAgentUsage({ businessId: DEMO_BUSINESS_ID, provider: "anthropic", model: MODEL_SMART, kind: p.sandbox ? "sandbox" : "sales", usage: res.usage });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("\n").trim();
  const replies: string[] = text ? bubbles(text) : [];
  const tool = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

  if (tool?.name === "capture_lead" && !isLead) {
    const input = tool.input as { fullName?: string; businessName?: string; businessType?: string };
    const fullName = (input.fullName ?? "").trim();
    const businessName = (input.businessName ?? "").trim();
    p.sandbox?.toolLog.push(`capture_lead(${JSON.stringify(input)})`);
    const leadId = p.sandbox ? "sandbox" : await createLead({ phone: p.phone, conversationId: p.conversationId, fullName, businessName, businessType: input.businessType ?? null, source: state.source ?? null });
    state = { ...state, mode: "lead", leadId, fullName: fullName || state.fullName, businessName: businessName || state.businessName };
    if (!replies.length) replies.push(`מעולה${fullName ? `, ${fullName.split(/\s+/)[0]}` : ""}!`);
    replies.push(OFFER_TEXT);
    replies.push(`הצעד הבא הוא שיחה של 10 דקות עם ${rep}. ${await twoSlotsSentence()}`);
  } else if (tool?.name === "propose_call") {
    const iso = String((tool.input as { startsAt?: string }).startsAt ?? "");
    const slot = ctx.slots.find(s => s.iso === iso);
    p.sandbox?.toolLog.push(`propose_call(${iso})`);
    if (slot) {
      state = { ...state, pendingCall: { startsAt: slot.iso, label: slot.label, repId: slot.repId } };
      replies.length = 0; // the confirmation question is code's
      replies.push(`לקבוע לך שיחה של 10 דקות עם ${rep} ${slot.label}? (כן / לא)`);
    } else if (!replies.length) replies.push(await twoSlotsSentence());
  } else if (tool?.name === "cancel_call") {
    p.sandbox?.toolLog.push("cancel_call()");
    const call = state.leadId && !p.sandbox ? await prisma.salesCall.findFirst({ where: { leadId: state.leadId, status: "booked" }, orderBy: { startsAt: "asc" } }) : null;
    if (call) await cancelCall(call.id, "lead");
    if (!replies.length) replies.push("ביטלתי. אם תרצה לקבוע שוב, אני כאן.");
  } else if (tool?.name === "handoff_to_rep") {
    const summary = String((tool.input as { summary?: string }).summary ?? "").slice(0, 300);
    p.sandbox?.toolLog.push(`handoff_to_rep(${summary})`);
    if (!p.sandbox) await alertRep(p.lead?.repId ?? null, `🙋 ${state.fullName || p.lead?.name || p.phone.replace(/^972/, "0")} מבקש נציג: ${summary}`);
    replies.length = 0;
    replies.push(`מעביר ל${rep}, הוא יחזור אליך בהקדם.`);
  } else if (tool?.name === "not_interested") {
    p.sandbox?.toolLog.push("not_interested()");
    state = { ...state, mode: isLead ? "lead" : "declined" };
    if (isLead && state.leadId && !p.sandbox) { await stopLeadAutomations(state.leadId, "not_interested"); await setLeadStage(state.leadId, "not_relevant", { lostReason: "אמר לא בוואטסאפ" }); }
    if (!replies.length) replies.push(declineReply(state));
  }
  if (!replies.length) replies.push("רגע, בודק ומיד חוזר אליך.");

  await saveState(p.conversationId, state);
  await reply(p.conversationId, p.phone, guardPrice(replies), p.sandbox);
  return { replies, state };
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
    if (sandbox) { sandbox.replies.push(body); continue; }
    await prisma.conversationMessage.create({ data: { conversationId, role: "assistant", content: body, source: "agent" } });
    await sendMessage({ businessId: DEMO_BUSINESS_ID, customerPhone: phone, kind: "sales_reply", body }).catch(e => console.error("[sales-agent] send failed", e));
  }
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }).catch(() => {});
}

// ─── Leads ───────────────────────────────────────────────────────────────────

async function createLead(p: { phone: string; conversationId: string; fullName: string; businessName: string; businessType: string | null; source: string | null }): Promise<string> {
  const userMsgs = await prisma.conversationMessage.findMany({ where: { conversationId: p.conversationId, role: "user" }, orderBy: { createdAt: "asc" }, take: 12, select: { content: true } });
  const summary = userMsgs.map(m => m.content.replace(/\s+/g, " ").trim()).filter(Boolean).join(" · ").slice(0, 600);
  const localPhone = p.phone.replace(/^972/, "0");
  const recent = await prisma.lead.findFirst({ where: { phone: { in: [p.phone, localPhone] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const rep = await prisma.salesRep.findFirst({ where: { active: true }, orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }], select: { id: true } });
  const data = {
    name: p.fullName || undefined, phone: localPhone, source: p.source === "landing" ? "whatsapp_demo" : "whatsapp_keywords", status: "contacted", stage: "chatting",
    businessName: p.businessName || null, businessType: p.businessType && p.businessType !== "other" ? p.businessType : "barber_men",
    conversationId: p.conversationId, summary, lastInboundAt: new Date(),
  };
  const lead = recent
    ? await prisma.lead.update({ where: { id: recent.id }, data: { ...data, name: p.fullName || undefined }, select: { id: true } })
    : await prisma.lead.create({ data: { ...data, repId: rep?.id ?? null }, select: { id: true } });

  const body = `🎯 ליד חדש מוואטסאפ הדמו\nשם: ${p.fullName || "—"}\nמספרה: ${p.businessName || "—"}\nטלפון: ${localPhone}\nמה ניסה: ${summary.slice(0, 200) || "—"}\nCRM: /admin/crm`;
  notifyPlatformOwner(body).catch(() => {});
  pushToOwner(SUPER_ADMIN_BUSINESS_ID, { title: `🎯 ליד חדש: ${p.fullName || localPhone}`, body: `${p.businessName || "מספרה"} · ${localPhone}`, data: { type: "lead", leadId: lead.id } }).catch(() => {});
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
    notifyPlatformOwner(`⏰ ליד מחכה כבר יום: ${l.name || "—"} (${l.businessName || "מספרה"}) · ${l.phone}\nCRM: /admin/crm`).catch(() => {});
  }
  return stale.length;
}
