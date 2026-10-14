/**
 * Chator's own agent for its CUSTOMERS (spec "מפת הסוכן של צ'אטור", stages 5–6,
 * approved 14.10.2026). Someone whose number owns a shop writes to Chator's
 * number: no sales here.
 *   • בהקמה (signed up, not activated): a setup helper. Knows the step he
 *     stopped at, asks "במה נתקעת?", answers for that step with a direct link,
 *     WhatsApp troubleshooting, and hands him to Yair after a second dead end.
 *   • לקוח פעיל (activated): support. How-to from the guide, issues go to Yair
 *     as a task, billing and plan questions, never a sales pitch.
 * Both: knows → helps; doesn't know → asks Yair (ask_yair), Yair answers in the
 * CRM, the answer reaches the customer and can become a rule (supportRules).
 */
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { phoneVariants } from "@/lib/messaging/phone";
import { DEMO_BUSINESS_ID } from "@/lib/demo-widget";
import { SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { MODEL_SMART } from "@/lib/agent/customer-agent";
import { anthropicFor } from "@/lib/anthropic-clients";
import { recordAgentUsage } from "@/lib/agent/usage";
import { getCrmText, setCrmText } from "@/lib/crm/core";
import { recordCrmNotification } from "@/lib/crm/notify";
import { computeSetup } from "@/lib/crm/setup-progress";
import { payLinkFor } from "@/lib/billing/pay-link";
import { getPlans, planKeyOf } from "@/lib/crm/plans";

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";

export type SupportSandbox = { replies: string[]; toolLog: string[] };
export type ChatorCustomer = { id: string; name: string; slug: string; activatedAt: Date | null; paidAt: Date | null; trialEndsAt: Date | null; monthlyPrice: number | null; settings: string | null; whatsappStatus: string; createdAt: Date };
const CUSTOMER_SELECT = { id: true, name: true, slug: true, activatedAt: true, paidAt: true, trialEndsAt: true, monthlyPrice: true, settings: true, whatsappStatus: true, createdAt: true } as const;

/** The shop this number owns (its own phone or its owner login), if any. */
export async function findChatorCustomer(phone: string): Promise<ChatorCustomer | null> {
  const vs = phoneVariants(phone);
  if (!vs.length) return null;
  return prisma.business.findFirst({
    where: {
      id: { notIn: [DEMO_BUSINESS_ID, SUPER_ADMIN_BUSINESS_ID] },
      OR: [{ phone: { in: vs } }, ...vs.map(v => ({ settings: { contains: `"ownerLoginPhone":"${v}"` } }))],
    },
    orderBy: { createdAt: "desc" },
    select: CUSTOMER_SELECT,
  });
}
export async function loadChatorCustomer(id: string): Promise<ChatorCustomer | null> {
  return prisma.business.findUnique({ where: { id }, select: CUSTOMER_SELECT });
}

/** The default guide (editable later as crm_settings "supportKnowledge"). Only what exists today. */
export const SUPPORT_KNOWLEDGE = `מדריך המערכת (רק מה שכתוב כאן קיים; הכתובות יחסיות לאתר):

הקמה, באשף /admin/onboarding: פתיחה, פרטי העסק ושעות, הצוות (ספרים), שירותים ומחירים, הגדרות הסוכן (עם ניסיון בארגז חול), חיבור הוואטסאפ, הפעלה. אפשר לצאת ולחזור, הכל נשמר. החודש החינמי מתחיל רק כשלוחצים "הפעל" (בשלב האחרון באשף, או בפס למעלה במערכת). אחרי ההפעלה אפשר לשתף עם הלקוחות את הקישור לקביעת תורים.

חיבור וואטסאפ (/admin/settings/whatsapp, או בשלב באשף): מחברים את הוואטסאפ של המספרה, לא את הפרטי. "סריקת קוד": בטלפון של המספרה, וואטסאפ › הגדרות › מכשירים מקושרים › קישור מכשיר, וסורקים את הקוד שעל המסך. הקוד מתחדש לבד. אם המערכת פתוחה על אותו טלפון אי אפשר לסרוק את המסך של עצמו: עוברים ל"קוד במספרים", מקלידים את המספר של המספרה, ומקלידים בטלפון את הקוד בן 8 התווים (תקף כשתי דקות). אם וואטסאפ אומר שאי אפשר לקשר מכשיר כרגע: מחכים כמה דקות ומנסים שוב. אחרי 8 דקות בלי חיבור המסך עוצר, לוחצים "נסה שוב". חובה וואטסאפ עם מספר נייד; וואטסאפ ביזנס עובד ונשאר בטלפון.

ספרים: /admin/staff (הוספה, תמונה, הרשאות). שעות עבודה והפסקות לכל ספר: /admin/settings/hours. שירותים, מחיר ומשך: /admin/services. יומן ותורים (כמה ימים קדימה אפשר לקבוע, זמן מינימום מראש, מדיניות ביטול): /admin/settings/calendar.
הסוכן (איך הוא מדבר, מה הוא יודע, לכבות או להדליק): /admin/agent. שם יש גם תיבה לכתוב התנהגות שלא אהבת אצל הסוכן.
הודעה חשובה ללקוחות (פופ־אפ בקביעת תור, כללית ולכל ספר): /admin/settings/notices.
התראות ואיך הן מגיעות (וואטסאפ או פוש): /admin/settings/notifications, והמסך עצמו /admin/notifications.
לקוחות: /admin/customers. הודעות תפוצה ושיווק: /admin/messaging. דוחות: /admin/settings/reports. עיצוב דף הבית: /admin/settings/storefront. פרטי העסק: /admin/settings/business.
המסלול שלי (מסלול, שימוש החודש, חבילות, חשבוניות, הקישור לתשלום, חבר מביא חבר): /admin/settings/plan.
חבר מביא חבר: על כל מספרה שמגיעה דרך הקישור האישי ומתחילה לשלם, חודש חינם. הקישור במסך המסלול.
מסלולים: נקבעים לפי כמות הודעות הוואטסאפ והשימוש בסוכן, התורים לא מוגבלים. בסיס 287 ₪, ביניים 367 ₪, עליון 467 ₪ לחודש. מעבר מסלול או חבילה: בקשה במסך המסלול, יאיר מאשר.
תשלום: כרטיס אשראי בקישור האישי במסך המסלול; חיוב חודשי וחשבונית במייל.`;

type StepKey = "password" | "business" | "team" | "services" | "agent" | "whatsapp" | "agent_on" | "live";
const STEP_LINK: Record<StepKey, string> = {
  password: "/admin/onboarding", business: "/admin/onboarding", team: "/admin/onboarding", services: "/admin/onboarding",
  agent: "/admin/onboarding", whatsapp: "/admin/settings/whatsapp", agent_on: "/admin/onboarding", live: "/admin",
};

async function contextBlock(biz: ChatorCustomer): Promise<{ stage: "setup" | "active"; block: string }> {
  const stage = biz.activatedAt ? "active" : "setup";
  const lines: string[] = [`העסק: ${biz.name}.`, `הקישור לקביעת תורים של המספרה: ${ORIGIN}/${biz.slug}`];
  const plans = await getPlans().catch(() => []);
  const plan = plans.find(p => p.key === planKeyOf(biz.settings)) ?? null;
  if (stage === "setup") {
    const [s] = await computeSetup({ businessIds: [biz.id] }).catch(() => []);
    if (s) {
      lines.push(`שלבי ההקמה: ${s.steps.map(x => `${x.label} ${x.done ? "✓" : "✗"}`).join(" · ")}.`);
      if (s.current) lines.push(`עצר ב: ${s.current.label}. קישור ישיר: ${ORIGIN}${STEP_LINK[s.current.key as StepKey] ?? "/admin/onboarding"}`);
    }
    lines.push(`עוד לא לחץ "הפעל", אז החודש החינמי עוד לא התחיל.`);
  } else {
    const ends = biz.trialEndsAt ? biz.trialEndsAt.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }) : null;
    lines.push(biz.paidAt ? `משלם${plan ? `, מסלול ${plan.name} (${plan.priceIls} ₪)` : ""}.` : `בחודש החינמי${ends ? ` עד ${ends}` : ""}${plan ? `, מסלול ${plan.name} (${plan.priceIls} ₪) אחריו` : ""}.`);
    if (!biz.paidAt) lines.push(`הקישור האישי שלו לתשלום: ${payLinkFor(biz)}`);
  }
  lines.push(`וואטסאפ: ${biz.whatsappStatus === "connected" ? "מחובר" : "לא מחובר"}.`);
  return { stage, block: lines.join("\n") };
}

const ASK_YAIR: Anthropic.Tool = { name: "ask_yair", description: "כשאין לך תשובה בטוחה מהמדריך, מהכללים או מהפרטים למעלה. שואל את יאיר; התשובה תגיע אליו כאן.", input_schema: { type: "object", properties: { question: { type: "string", description: "השאלה של הלקוח, מנוסחת קצר ומדויק" } }, required: ["question"] } };
const REPORT_ISSUE: Anthropic.Tool = { name: "report_issue", description: "תקלה במערכת (משהו לא עובד כמו שצריך). קודם אסוף מה קרה, איפה ומתי, ואז דווח.", input_schema: { type: "object", properties: { summary: { type: "string" }, details: { type: "string" } }, required: ["summary"] } };
const HANDOFF: Anthropic.Tool = { name: "handoff_to_yair", description: "נתקע שוב באותו מקום אחרי שעזרת, ביקש לדבר עם בן אדם, או כועס. יאיר יחזור אליו.", input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } };

function system(stage: "setup" | "active", block: string, knowledge: string, rules: string): string {
  const goal = stage === "setup"
    ? `הוא נרשם לצ'אטור ועדיין מקים את המערכת. אתה עוזר ההקמה שלו. המטרה: שיסיים להקים וילחץ "הפעל".
מהלך: אם לא ברור מה הוא צריך, שאל "במה נתקעת? מה קרה?". ענה בדיוק על השלב שבו הוא נמצא, צעד אחרי צעד, עם הקישור הישיר. בחיבור וואטסאפ: הקפד שזה הוואטסאפ של המספרה, ולמי שעל אותו טלפון הסבר את "קוד במספרים". כשהשלב נפתר, אמור מה השלב הבא. אם נתקע שוב באותו מקום אחרי שעזרת: handoff_to_yair.`
    : `הוא לקוח פעיל של צ'אטור. אתה התמיכה שלו. אף פעם לא משכנע לקנות; מסלול גדול יותר או חבילה מציעים רק כשההודעות נגמרות או כשהוא שואל.
מהלך: שאלה "איך עושים" ענה מהמדריך, עם הקישור למסך. תקלה: שאל מה קרה, איפה ומתי (שאלה אחת בכל פעם), ואז report_issue. תשלום ומסלול: מהפרטים למעלה.`;
  return `אתה צ'אטור, כאן בוואטסאפ של צ'אטור. מי שכותב לך הוא לקוח קיים ולא ליד.
${goal}

הכלל: יודע, עוזר. לא בטוח או שזה לא כתוב במדריך, בכללים או בפרטים למטה: ask_yair, ואל תנחש.
גבולות: הודעה אחת קצרה, עד ארבעה משפטים. בלי רשימות ארוכות, בלי מקפים, בלי כוכביות, כמעט בלי אימוג'ים. לא ממציא מסכים, כפתורים, מחירים או מועדים. לא מבטיח תיקון או מועד בלי יאיר. תמונות והקלטות אתה לא רואה: אם שלח, בקש שיתאר במילים.

פרטים עליו:
${block}

${rules ? `כללים שיאיר כבר ענה עליהם (הכי עדכני, גובר על המדריך):\n${rules}\n\n` : ""}${knowledge}`;
}

async function say(conversationId: string, phone: string, texts: string[], sandbox?: SupportSandbox): Promise<void> {
  for (const body of texts) {
    await prisma.conversationMessage.create({ data: { conversationId, role: "assistant", content: body, source: "agent" } });
    if (sandbox) { sandbox.replies.push(body); continue; }
    await sendMessage({ businessId: DEMO_BUSINESS_ID, customerPhone: phone, kind: "sales_reply", body }).catch(e => console.error("[chator-support] send failed", e));
  }
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }).catch(() => {});
}

/** One message from a Chator customer on Chator's number. The message is already saved. */
export async function runSupportTurn(p: { conversationId: string; phone: string; text: string; biz: ChatorCustomer; sandbox?: SupportSandbox }): Promise<{ replies: string[]; stage: "setup" | "active" }> {
  const { stage, block } = await contextBlock(p.biz);
  const knowledge = (await getCrmText("supportKnowledge")).text.trim() || SUPPORT_KNOWLEDGE;
  const rules = (await getCrmText("supportRules")).text.trim();
  const history = await prisma.conversationMessage.findMany({ where: { conversationId: p.conversationId, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "desc" }, take: 16, select: { role: true, content: true } });
  const msgs: Anthropic.MessageParam[] = [];
  for (const m of history.reverse()) {
    const role = m.role === "user" ? "user" : "assistant";
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content = `${last.content as string}\n${m.content}`;
    else msgs.push({ role, content: m.content });
  }
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") msgs.push({ role: "user", content: p.text });
  if (msgs[0].role !== "user") msgs.unshift({ role: "user", content: "(תחילת השיחה)" });

  const tools = stage === "active" ? [ASK_YAIR, REPORT_ISSUE, HANDOFF] : [ASK_YAIR, HANDOFF];
  const res = await anthropicFor(p.sandbox ? "test" : "prod").messages.create({ model: MODEL_SMART, max_tokens: 600, system: system(stage, block, knowledge, rules), tools, messages: msgs });
  void recordAgentUsage({ businessId: DEMO_BUSINESS_ID, provider: "anthropic", model: MODEL_SMART, kind: p.sandbox ? "sandbox" : "sales", usage: res.usage });
  let text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("\n").trim();
  const tool = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const who = p.biz.name;
  const input = (tool?.input ?? {}) as Record<string, string>;

  if (tool?.name === "ask_yair") {
    p.sandbox?.toolLog.push(`ask_yair(${input.question})`);
    if (!p.sandbox) {
      await prisma.chatorQuestion.create({ data: { conversationId: p.conversationId, phone: p.phone, businessId: p.biz.id, stage, question: String(input.question || p.text).slice(0, 1000) } });
      await recordCrmNotification(`❓ ${who} שאל את הסוכן של צ'אטור\n${String(input.question || p.text).slice(0, 300)}`, { kind: "customer", businessId: p.biz.id, href: "/admin/crm/improvements", push: true });
    }
    text = "שאלה טובה. אני בודק את זה מול יאיר וחוזר אליך כאן בהקדם.";
  } else if (tool?.name === "report_issue") {
    p.sandbox?.toolLog.push(`report_issue(${input.summary})`);
    if (!p.sandbox) {
      await prisma.crmTask.create({ data: { title: `תקלה אצל ${who}: ${String(input.summary).slice(0, 150)}`, businessId: p.biz.id, dueAt: new Date() } });
      await recordCrmNotification(`🛠 תקלה אצל ${who}\n${String(input.summary).slice(0, 200)}${input.details ? `\n${String(input.details).slice(0, 300)}` : ""}`, { kind: "customer", businessId: p.biz.id, push: true });
    }
    text = `${text ? `${text}\n` : ""}העברתי ליאיר את כל הפרטים, הוא יבדוק ויחזור אליך.`;
  } else if (tool?.name === "handoff_to_yair") {
    p.sandbox?.toolLog.push(`handoff_to_yair(${input.reason})`);
    if (!p.sandbox) {
      await prisma.crmTask.create({ data: { title: `לחזור ל${who}: ${String(input.reason).slice(0, 150)}`, businessId: p.biz.id, dueAt: new Date() } });
      await recordCrmNotification(`📞 ${who} צריך את יאיר${stage === "setup" ? " בהקמה" : ""}\n${String(input.reason).slice(0, 300)}`, { kind: "customer", businessId: p.biz.id, push: true });
    }
    text = `${text ? `${text}\n` : ""}ביקשתי מיאיר לחזור אליך, הוא יתקשר אליך בהקדם.`;
  }
  if (!text) text = "רגע, בודק ומיד חוזר אליך.";
  await say(p.conversationId, p.phone, [text], p.sandbox);
  return { replies: [text], stage };
}

/** Yair answered a question from the CRM: it goes to the customer, and maybe becomes a rule. */
export async function answerChatorQuestion(id: string, answer: string, saveAsRule: boolean): Promise<{ ok: boolean; error?: string }> {
  const q = await prisma.chatorQuestion.findUnique({ where: { id } });
  if (!q || q.status !== "pending") return { ok: false, error: "השאלה כבר טופלה" };
  const body = answer.trim();
  if (!body) return { ok: false, error: "חסרה תשובה" };
  await say(q.conversationId, q.phone, [body]);
  if (saveAsRule) {
    const cur = (await getCrmText("supportRules")).text.trim();
    await setCrmText("supportRules", `${cur ? `${cur}\n` : ""}ש: ${q.question.replace(/\s+/g, " ")} ת: ${body.replace(/\s+/g, " ")}`);
  }
  await prisma.chatorQuestion.update({ where: { id }, data: { answer: body, savedAsRule: saveAsRule, status: "answered", answeredAt: new Date() } });
  return { ok: true };
}
