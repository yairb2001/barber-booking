/**
 * Quick replies in the CRM's WhatsApp composer (20.10.2026, Yair: "הודעות
 * מהירות לשלוח ללידים, לדוגמא קישור להתחיל לעבוד עם המערכת, אבל שלא ישלח
 * ישר, שיופיע בכתב שאני אוכל לערוך"). Picking one only fills the text box.
 * Stored in crm_settings "quickReplies"; the defaults until he edits them.
 * Placeholders are filled in the browser: {שם} from the card, the others from
 * quickReplyVars() (links and today's plans).
 */
import { prisma } from "@/lib/prisma";
import { getPlans } from "@/lib/crm/plans";

export type QuickReply = { id: string; title: string; text: string };

const KEY = "quickReplies";
const MAX = 30;

export const QUICK_REPLY_VARS = ["{שם}", "{קישור הרשמה}", "{דף צ'אטור}", "{מסלולים}"] as const;

export const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { id: "signup", title: "קישור להרשמה", text: "היי {שם}, הנה הקישור להתחיל לעבוד עם צ'אטור:\n{קישור הרשמה}\n\nההקמה לוקחת בערך 10 דקות, ואני איתך בכל שלב." },
  { id: "page", title: "מה זה צ'אטור", text: "היי {שם}, פה רואים בדיוק מה צ'אטור עושה בשבילך:\n{דף צ'אטור}" },
  { id: "plans", title: "המסלולים", text: "המסלולים שלנו:\n{מסלולים}\n\nהחודש הראשון חינם." },
  { id: "call", title: "לתאם שיחה", text: "היי {שם}, מתי נוח לך לשיחה קצרה של 10 דקות? אראה לך איך זה עובד אצל מספרה כמו שלך." },
];

const clean = (items: unknown): QuickReply[] =>
  (Array.isArray(items) ? items : [])
    .filter((x): x is QuickReply => !!x && typeof x.title === "string" && typeof x.text === "string" && !!x.title.trim() && !!x.text.trim())
    .slice(0, MAX)
    .map((x, i) => ({ id: typeof x.id === "string" && x.id ? x.id.slice(0, 40) : `q${Date.now()}${i}`, title: x.title.trim().slice(0, 40), text: x.text.trim().slice(0, 2000) }));

export async function getQuickReplies(): Promise<QuickReply[]> {
  const row = await prisma.crmSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  if (!row) return DEFAULT_QUICK_REPLIES;
  try { return clean(JSON.parse(row.value)); } catch { return DEFAULT_QUICK_REPLIES; }
}

export async function saveQuickReplies(items: unknown): Promise<QuickReply[]> {
  const list = clean(items);
  const value = JSON.stringify(list);
  await prisma.crmSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return list;
}

/** What the placeholders other than {שם} turn into, right now. */
export async function quickReplyVars(): Promise<Record<string, string>> {
  const origin = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
  const plans = (await getPlans().catch(() => [])).filter(p => p.active);
  const plansText = plans.map(p => `${p.name}: ${p.priceIls} ₪ לחודש, בערך ${p.apptsCap.toLocaleString("he-IL")} תורים`).join("\n") + (plans.length ? "\nהמחירים כוללים מע״מ." : "");
  return {
    "{קישור הרשמה}": `${origin}/signup`,
    "{דף צ'אטור}": `${origin}/for-business`,
    "{מסלולים}": plansText,
  };
}
