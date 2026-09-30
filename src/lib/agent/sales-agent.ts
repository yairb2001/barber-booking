/**
 * Stage 1 sales funnel — the demo shop's WhatsApp (docs/PLAN-MASTER.md, spec
 * "אפיון שלב 1" §2).
 *
 * The landing page sends prospects to the demo shop's WhatsApp number with a
 * prefilled text ("היי, ראיתי את הדמו באתר ורוצה לנסות לקבוע תור"). That number
 * also receives unrelated traffic, so nothing here runs unless the conversation
 * is TAGGED as a demo/prospect conversation (the landing text, the product's
 * name, or an explicit "אני ספר / כמה עולה המערכת"). Untagged conversations
 * fall through to whatever the webhook did before (a human).
 *
 * A tagged conversation runs the ordinary booking agent (the demo). Code — not
 * the model — decides when to sell:
 *   demo ──(booking completed)──▶ pitched: one fixed two-bubble pitch (0 tokens)
 *   demo/pitched ──(prospect words / any reply to the pitch)──▶ sales
 *   sales ──capture_lead──▶ lead: Lead row + owner alerts + fixed offer text
 *   sales/pitched ──"לא עכשיו"──▶ declined: stop selling, demo keeps working
 * The sales model answers only from sales-knowledge.ts; the price and the offer
 * are fixed strings sent by code. State lives in Conversation.salesState (JSON).
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
import { SALES_KNOWLEDGE, FORBIDDEN_CLAIMS, OFFER_TEXT, PRICE_TEXT } from "@/lib/agent/sales-knowledge";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export type SalesMode = "demo" | "pitched" | "sales" | "lead" | "declined";
export type SalesState = {
  mode: SalesMode;
  taggedAt: string;
  source?: string;        // "landing" (prefilled text) | "keywords"
  pitchedAt?: string;
  leadId?: string;
  fullName?: string;
  businessName?: string;
};

/** Words that make a NEW conversation at the demo number a demo/prospect one. */
const DEMO_TAG_RE = /הדמו|דמו באתר|דמו של|chator|צ'אטור|צ׳אטור|לעסק שלי|בעל מספרה|אני ספר(?![א-ת])|יש לי מספרה|כמה עולה המערכת|כמה זה עולה|איך מצטרפים|הסוכן שלכם|המערכת שלכם/i;
const LANDING_TEXT_RE = /ראיתי את הדמו באתר/;
/** Inside a tagged conversation: the customer is asking about the PRODUCT, not a haircut. */
const PROSPECT_RE = /מערכת|סוכן|בוט|לעסק שלי|אני ספר(?![א-ת])|בעל מספרה|יש לי מספרה|מצטרפ|להצטרף|chator|צ'אטור|צ׳אטור|מנוי|לרכוש|איך זה עובד אצל/i;
/** Price words count as "about the product" only after the pitch — in the demo, "כמה זה עולה" is about the haircut. */
const PRICE_RE = /כמה זה עולה|מה המחיר|כמה עולה|מחיר/;
const ACK_RE = /^(תודה|תודה רבה|סבבה|אחלה|מעולה|אוקיי|אוקי|בסדר|👍|🙏)[\s!.👍🙏]*$/;
const DECLINE_RE = /^(לא|לא תודה|לא עכשיו|לא מעוניין|לא רלוונטי|אין צורך|לא כרגע|אולי בהמשך|עזוב|לא צריך)(,?\s*(תודה|תודה רבה|אחי|בינתיים))*[\s!.]*$/;
const YES_RE = /^(כן|כן בטח|בטח|ברור|נכון|אני|כן אני|yes|yep)[\s!.]*$/i;

const PITCH_BUBBLES = [
  "אגב, שמת לב? קבעת תור בלי שאף אחד ענה לך — ככה זה עובד אצל מספרות שעובדות עם Chator, על הוואטסאפ של המספרה שלהן.",
  "אתה ספר או בעל מספרה? אם כן, אשמח להראות לך איך זה נראה אצלך.",
];
const DECLINE_REPLY = "סבבה, בלי לחץ. התור שלך נשאר כמו שקבענו, ואם תרצה לשמוע עוד — אני כאן.";

export function parseSalesState(raw: string | null | undefined): SalesState | null {
  if (!raw) return null;
  try { const s = JSON.parse(raw) as SalesState; return s && typeof s.mode === "string" ? s : null; } catch { return null; }
}

async function saveState(conversationId: string, state: SalesState): Promise<void> {
  await prisma.conversation.update({ where: { id: conversationId }, data: { salesState: JSON.stringify(state) } });
}

/** True when a message would open a demo/prospect conversation. Exported for tests. */
export function looksLikeDemoOpener(text: string): { tagged: boolean; source?: "landing" | "keywords" } {
  if (LANDING_TEXT_RE.test(text)) return { tagged: true, source: "landing" };
  if (DEMO_TAG_RE.test(text)) return { tagged: true, source: "keywords" };
  return { tagged: false };
}

export function looksLikeProspect(text: string, mode: SalesMode): boolean {
  if (mode === "sales" || mode === "lead") return true;
  if (mode === "declined") return false;
  if (PROSPECT_RE.test(text)) return true;
  if (mode === "pitched") return PRICE_RE.test(text) || !ACK_RE.test(text); // a reply to the pitch (acks stay silent)
  return false;
}

export type DemoTurnResult = { handled: boolean; mode?: SalesMode; replies?: string[] };

export type DemoSandbox = { replies: string[]; toolLog: string[] };

/**
 * One incoming message at the demo shop. Returns handled=false when the
 * conversation is not a demo/prospect one — the caller then does what it
 * always did. With `sandbox` nothing is sent, no lead is written and no owner
 * is alerted; replies are collected instead (the test route / replays).
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

  let conv = await prisma.conversation.findFirst({
    where: { businessId: DEMO_BUSINESS_ID, phone, agentType: { not: "owner" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, salesState: true, _count: { select: { messages: true } } },
  });
  let state = parseSalesState(conv?.salesState);

  if (!state) {
    // Untagged. Only an opener (the landing text / product words) tags it — and
    // only early in the thread, so a long-running unrelated chat never flips.
    const opener = looksLikeDemoOpener(text);
    if (!opener.tagged || (conv && conv._count.messages > 6)) return { handled: false };
    if (!conv) {
      const created = await prisma.conversation.create({ data: { businessId: DEMO_BUSINESS_ID, phone, agentType: "customer", status: "active" }, select: { id: true } });
      conv = { id: created.id, salesState: null, _count: { messages: 0 } };
    }
    state = { mode: "demo", taggedAt: new Date().toISOString(), source: opener.source };
    await saveState(conv.id, state);
  }
  if (!conv) return { handled: false };

  // Persist the user message when the caller hasn't (the webhook has).
  if (!p.alreadyPersisted) {
    await prisma.conversationMessage.create({ data: { conversationId: conv.id, role: "user", content: text } });
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
  }

  // ── Decline after the pitch / during the sale → stop selling, keep the demo ──
  if ((state.mode === "pitched" || state.mode === "sales") && DECLINE_RE.test(text)) {
    state = { ...state, mode: "declined" };
    await saveState(conv.id, state);
    await reply(conv.id, phone, [DECLINE_REPLY], p.sandbox);
    return { handled: true, mode: state.mode, replies: [DECLINE_REPLY] };
  }

  // "תודה" to the booking confirmation + pitch → silence (like the customer agent's pure acks).
  if (state.mode === "pitched" && ACK_RE.test(text)) return { handled: true, mode: state.mode, replies: [] };

  // ── Sales turn ──
  if (looksLikeProspect(text, state.mode) || (state.mode === "pitched" && YES_RE.test(text))) {
    if (state.mode === "demo" || state.mode === "pitched") { state = { ...state, mode: "sales" }; await saveState(conv.id, state); }
    const out = await runSalesTurn({ conversationId: conv.id, phone, text, state, senderName: p.senderName ?? null, sandbox: p.sandbox });
    return { handled: true, mode: out.state.mode, replies: out.replies };
  }

  // ── Demo turn: the ordinary booking agent (already persisted by us or the webhook) ──
  const started = new Date();
  await runCustomerAgent({
    businessId: DEMO_BUSINESS_ID, phone, incomingText: text, alreadyPersisted: true,
    sandbox: p.sandbox ? { replies: p.sandbox.replies, toolLog: p.sandbox.toolLog, usageKind: "sandbox" } : undefined,
  });
  // A demo booking just completed → the one-time pitch (fixed text, 0 tokens).
  if (state.mode === "demo" && !state.pitchedAt) {
    const booked = p.sandbox
      ? p.sandbox.toolLog.some(t => t.startsWith("book_appointment(") || t.startsWith("propose_booking(") && /customerConfirmed/.test(t)) || p.sandbox.replies.some(r => /^סגור, קבעתי לך/.test(r))
      : !!(await prisma.appointment.findFirst({ where: { businessId: DEMO_BUSINESS_ID, createdAt: { gte: started }, customer: { phone: { in: [phone, phone.replace(/^972/, "0")] } } }, select: { id: true } }));
    if (booked) {
      state = { ...state, mode: "pitched", pitchedAt: new Date().toISOString() };
      await saveState(conv.id, state);
      if (!p.sandbox) await new Promise(r => setTimeout(r, 3000));
      await reply(conv.id, phone, PITCH_BUBBLES, p.sandbox);
    }
  }
  return { handled: true, mode: state.mode };
}

// ─── The sales model ─────────────────────────────────────────────────────────

const SALES_TOOLS: Anthropic.Tool[] = [
  {
    name: "capture_lead",
    description: "קרא ברגע שיש שם מלא ושם המספרה (או שהלקוח אמר שאין לו עדיין שם/מספרה — אז businessName ריק). המערכת רושמת ליד, שולחת לו את ההצעה ומעדכנת את יאיר. פעם אחת בשיחה.",
    input_schema: {
      type: "object",
      properties: {
        fullName: { type: "string", description: "שם מלא כפי שכתב" },
        businessName: { type: "string", description: "שם המספרה / העסק, אם נתן" },
        businessType: { type: "string", enum: ["barber_men", "barber_women", "nails", "cosmetics", "other"], description: "סוג העסק אם ברור מהשיחה (ברירת מחדל barber_men)" },
      },
      required: ["fullName"],
    },
  },
  {
    name: "not_interested",
    description: "הלקוח אמר בבירור שלא מעניין אותו / לא עכשיו. המערכת מפסיקה למכור; הדמו ממשיך לעבוד.",
    input_schema: { type: "object", properties: {} },
  },
];

function salesSystem(state: SalesState, senderName: string | null): string {
  const known = [state.fullName ? `שם: ${state.fullName}` : "", state.businessName ? `מספרה: ${state.businessName}` : ""].filter(Boolean).join(", ");
  return `אתה נציג המכירות של Chator (צ'אטור) — מערכת ניהול תורים למספרות עם סוכן AI שעונה ללקוחות בוואטסאפ של המספרה. אתה מתכתב בוואטסאפ עם מישהו שהגיע מדף הנחיתה וניסה את הדמו של "המספרה של דני" (מספרה בדיונית שמריצה את המערכת). עד עכשיו בשיחה הזאת ענה לו הסוכן של המספרה; מכאן אתה עונה.

המטרה: שיחה קצרה ואנושית שמסתיימת בליד — שם מלא ושם המספרה (הטלפון כבר ידוע) — ואז קריאה ל-capture_lead. לא חקירה: שאלה אחת בכל הודעה.
${known ? `כבר ידוע: ${known}.` : ""}${senderName ? ` השם בוואטסאפ: ${senderName} (יכול להיות כינוי — בקש שם מלא).` : ""}
מצב: ${state.mode === "lead" ? "הליד כבר נרשם ויאיר יחזור אליו — ענה על שאלות בלבד, אל תבקש פרטים שוב ואל תחזור על ההצעה." : state.mode === "pitched" ? "הרגע נשלחה לו השאלה אם הוא ספר/בעל מספרה, וזו התשובה שלו." : "הוא שאל על המערכת."}

סגנון: כמו בן אדם שכותב בוואטסאפ — קצר, חם, ישיר, בלי כוכביות, בלי רשימות, בלי מקף ארוך, כמעט בלי אימוג'ים. הודעה של 1–3 משפטים. קשור למה שהוא בעצמו חווה בדמו (קבע תור, שאל מחיר, הזיז) — זה כתוב בהיסטוריה למעלה. אל תפתח ב"היי" אם כבר דיברתם.

חוקים קשיחים:
- ענה רק מתוך "מה Chator עושה" למטה. פיצ'ר שלא כתוב שם — אמור בכנות שזה לא קיים היום, בלי להבטיח.
- מחיר: אם שואל — המחיר היחיד שמותר להגיד, מילה במילה: "${PRICE_TEXT}". אף מספר אחר, אף הנחה אחרת.
- ההצעה (חודש ראשון חינם, הקמה חינם ל‑20 הראשונות) נשלחת אוטומטית על ידי המערכת אחרי capture_lead — אל תכתוב אותה בעצמך לפני כן.
- אל תשווה למתחרים בשם. אל תמציא לקוחות, מספרים או תוצאות שלא כתובים למטה.
- אמר "לא עכשיו" / לא מעוניין → not_interested, ומשפט אדיב אחד. לא לוחצים.
- שאלה על תספורת/תור בדמו → ענה בקצרה שהוא יכול להמשיך לקבוע כרגיל, וחזור לעניין.
- הוא אישר שהוא ספר / בעל מספרה → ההודעה הבאה שלך מבקשת שם מלא ושם המספרה בשאלה אחת ("איך קוראים לך ומה שם המספרה?"), בלי שאלות חוויה לפני כן.
- capture_lead הוא סופי: הטקסט שאתה כותב באותה הודעה נשלח, ואחריו ההצעה מהמערכת. אל תחזור על מחיר או על מה שכבר אמרת.

${SALES_KNOWLEDGE}

${FORBIDDEN_CLAIMS}`;
}

async function runSalesTurn(p: { conversationId: string; phone: string; text: string; state: SalesState; senderName: string | null; sandbox?: DemoSandbox }): Promise<{ replies: string[]; state: SalesState }> {
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

  // ONE model call per turn. A tool call is final: its result is not sent back
  // to the model (a second call repeated the whole reply) — the text that came
  // with the call is the reply, and the offer / decline line is appended by code.
  const res = await anthropic.messages.create({ model: MODEL_SMART, max_tokens: 500, system: salesSystem(state, p.senderName), tools: SALES_TOOLS, messages: msgs });
  void recordAgentUsage({ businessId: DEMO_BUSINESS_ID, provider: "anthropic", model: MODEL_SMART, kind: p.sandbox ? "sandbox" : "sales", usage: res.usage });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("\n").trim();
  const replies: string[] = text ? bubbles(text) : [];
  const tool = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (tool?.name === "capture_lead" && state.mode !== "lead") {
    const input = tool.input as { fullName?: string; businessName?: string; businessType?: string };
    const fullName = (input.fullName ?? "").trim();
    const businessName = (input.businessName ?? "").trim();
    p.sandbox?.toolLog.push(`capture_lead(${JSON.stringify(input)})`);
    const leadId = p.sandbox ? "sandbox" : await createLead({ phone: p.phone, conversationId: p.conversationId, fullName, businessName, businessType: input.businessType ?? null, source: state.source ?? null });
    state = { ...state, mode: "lead", leadId, fullName: fullName || state.fullName, businessName: businessName || state.businessName };
    if (!replies.length) replies.push(`מעולה${fullName ? `, ${fullName.split(/\s+/)[0]}` : ""}!`);
    replies.push(OFFER_TEXT);
  } else if (tool?.name === "not_interested") {
    p.sandbox?.toolLog.push("not_interested()");
    state = { ...state, mode: "declined" };
    if (!replies.length) replies.push(DECLINE_REPLY);
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
  const recent = await prisma.lead.findFirst({ where: { phone: { in: [p.phone, localPhone] }, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const data = {
    name: p.fullName || undefined, phone: localPhone, source: p.source === "landing" ? "whatsapp_demo" : "whatsapp_keywords", status: "new",
    businessName: p.businessName || null, businessType: p.businessType && p.businessType !== "other" ? p.businessType : "barber_men",
    conversationId: p.conversationId, summary,
  };
  const lead = recent
    ? await prisma.lead.update({ where: { id: recent.id }, data: { ...data, name: p.fullName || undefined }, select: { id: true } })
    : await prisma.lead.create({ data, select: { id: true } });

  const body = `🎯 ליד חדש מוואטסאפ הדמו\nשם: ${p.fullName || "—"}\nמספרה: ${p.businessName || "—"}\nטלפון: ${localPhone}\nמה ניסה: ${summary.slice(0, 200) || "—"}\nניהול → לידים`;
  notifyPlatformOwner(body).catch(() => {});
  pushToOwner(SUPER_ADMIN_BUSINESS_ID, { title: `🎯 ליד חדש: ${p.fullName || localPhone}`, body: `${p.businessName || "מספרה"} · ${localPhone}`, data: { type: "lead", leadId: lead.id } }).catch(() => {});
  return lead.id;
}

/** Leads nobody touched for 24h → one reminder to the owner (spec §2). Runs from the minute cron. */
export async function remindStaleLeads(now: Date = new Date()): Promise<number> {
  const stale = await prisma.lead.findMany({
    where: { status: "new", remindedAt: null, createdAt: { lte: new Date(now.getTime() - 24 * 3600_000) }, source: { in: ["whatsapp_demo", "whatsapp_keywords", "landing"] } },
    select: { id: true, name: true, phone: true, businessName: true, createdAt: true }, take: 10,
  });
  for (const l of stale) {
    await prisma.lead.update({ where: { id: l.id }, data: { remindedAt: now } });
    notifyPlatformOwner(`⏰ ליד מחכה כבר יום: ${l.name || "—"} (${l.businessName || "מספרה"}) · ${l.phone}\nניהול → לידים`).catch(() => {});
  }
  return stale.length;
}
