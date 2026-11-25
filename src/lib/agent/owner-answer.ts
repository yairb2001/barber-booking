/**
 * The owner's answer to a question the agent could not answer, as the customer
 * gets it (25.11.2026, Yair: "הוא פשוט לא הבין מאיפה הגיעה ההודעה משום מקום").
 *
 * By the time the owner answers, the chat has often moved on to something else,
 * so his bare words ("כן") land with no context. The message first points back
 * at the question and then gives his answer: same content, phrased like a person.
 */
import { prisma } from "@/lib/prisma";
import { anthropicFor } from "@/lib/anthropic-clients";
import { MODEL_SMART } from "@/lib/agent/customer-agent";
import { recordAgentUsage } from "@/lib/agent/usage";
import { firstName } from "@/lib/messaging";
import { isPhoneLikeName } from "@/lib/agent/followup-shared";
import { vocabOf } from "@/lib/vocab";

const HISTORY = 14;

/** When the model is down: plain, but still tied to the question. */
export function ownerAnswerFallback(question: string, answer: string): string {
  return `חזרתי אליך לגבי מה ששאלת קודם (${question.trim().replace(/[?.!\s]+$/, "")}):\n${answer}`;
}

function sinceLabel(last: Date | undefined): string {
  if (!last) return "";
  const min = Math.round((Date.now() - last.getTime()) / 60_000);
  if (min < 20) return "השיחה פעילה ממש עכשיו: בלי פתיחת שלום.";
  if (min < 180) return "ההודעה האחרונה בשיחה הייתה לפני פחות משלוש שעות: בלי פתיחת שלום ארוכה.";
  return "עברו כמה שעות מאז ההודעה האחרונה בשיחה: אפשר לפתוח ב\"היי\" קצר.";
}

type Turn = { role: string; content: string; createdAt: Date };

/** The prompt alone, with nothing fetched: what the model is asked to write. */
export function ownerAnswerPrompt(p: { place: string; businessName: string; turns: Turn[]; customerName: string | null; question: string; answer: string }): { system: string; user: string } {
  const transcript = p.turns.map(m => `${m.role === "user" ? "לקוח" : "אנחנו"}: ${m.content.trim().slice(0, 400)}`).join("\n");
  const name = p.customerName && !isPhoneLikeName(p.customerName) ? firstName(p.customerName) : null;
  const system = `אתה הנציג של ה${p.place} "${p.businessName}" בוואטסאפ.
קודם בשיחה הלקוח שאל שאלה שלא ידעת לענות עליה ואמרת שאתה בודק. מאז השיחה אולי המשיכה לנושא אחר. עכשיו בעל העסק ענה.
כתוב ללקוח הודעה אחת קצרה שמחזירה אותו לשאלה ומוסרת את התשובה.

איך כותבים:
- פתיחה קצרה שמחזירה לנושא השאלה, כדי שיבין מיד על מה מדובר, גם כשכותבים באנגלית. הצורה: "לגבי מה ששאלת על הזקן," או "בדקתי לגבי החניה,". הנושא הוא הדבר שעליו שאל (זקן, חניה, הילד), במילים שלו.
- אחריה התשובה של בעל העסק. התוכן שלו נשאר כמו שהוא: לא מוסיפים פרטים, מחירים, שעות, תנאים או הבטחות שלא כתובים בתשובה, ולא משמיטים ממנה דבר.
- מנסחים את התשובה כמשפט טבעי ללקוח. אם בעל העסק ענה רק "כן" או "לא", משלימים למשפט לפי השאלה ("כן, אנחנו עושים גם זקן"). אם הוא כתב אליך ("תגיד לו ש..."), כותבים ישר ללקוח.
- עברית מדוברת וחמה, כמו בן אדם בוואטסאפ, בטון של השיחה. משפט אחד או שניים, בלי ירידת שורה. בלי מקף ארוך. אימוג'י אחד רק אם הוא מתאים לטון של השיחה.
- פונים ללקוח לפי המין שעולה מהשיחה. כשלא ברור, מנסחים בלי פנייה מגדרית.
- כותבים בשפה שהלקוח כותב בה.
- לא פותחים נושא חדש, לא מציעים תור ולא שואלים שאלה, אלא אם זה כתוב בתשובה של בעל העסק.
- ${sinceLabel(p.turns[p.turns.length - 1]?.createdAt)}${name ? ` שם הלקוח: ${name}. אם משתמשים בשם, רק בתחילת ההודעה.` : " אין לך את שם הלקוח: בלי כינוי ובלי מספר טלפון."}
החזר רק את ההודעה עצמה: בלי הקדמה, בלי הסבר ובלי מירכאות מסביב.`;
  const user = `${transcript ? `השיחה האחרונה:\n${transcript}\n\n` : ""}השאלה שהועברה לבעל העסק: ${p.question}\nהתשובה של בעל העסק: ${p.answer}`;
  return { system, user };
}

/** The model's words, tidied; null when they cannot be the owner's answer (empty, or far longer than what he wrote). */
export function tidyOwnerAnswer(text: string, answer: string): string | null {
  const t = text.trim().replace(/^["״'`]+|["״'`]+$/g, "").replace(/\s+[—–]\s+/g, ", ").replace(/\s*\n+\s*/g, " ").trim();
  return t && t.length <= answer.length + 260 ? t : null;
}

export async function phraseOwnerAnswer(p: {
  businessId: string; conversationId: string | null; customerName: string | null; question: string; answer: string;
}): Promise<string> {
  const fallback = ownerAnswerFallback(p.question, p.answer);
  try {
    const [biz, rows] = await Promise.all([
      prisma.business.findUnique({ where: { id: p.businessId }, select: { name: true, settings: true, businessType: true } }),
      p.conversationId
        ? prisma.conversationMessage.findMany({
            where: { conversationId: p.conversationId, role: { in: ["user", "assistant"] }, toolName: null },
            orderBy: { createdAt: "desc" }, take: HISTORY, select: { role: true, content: true, createdAt: true },
          })
        : Promise.resolve([]),
    ]);
    if (!biz) return fallback;
    const turns = rows.reverse().filter(m => m.content.trim() && !m.content.trim().startsWith("["));
    const { system, user } = ownerAnswerPrompt({ place: vocabOf(biz).place, businessName: biz.name, turns, customerName: p.customerName, question: p.question, answer: p.answer });
    const res = await anthropicFor("prod").messages.create({ model: MODEL_SMART, max_tokens: 700, system, messages: [{ role: "user", content: user }] });
    void recordAgentUsage({ businessId: p.businessId, provider: "anthropic", model: MODEL_SMART, kind: "owner_answer", conversationId: p.conversationId ?? undefined, usage: res.usage });
    if (res.stop_reason === "max_tokens") return fallback;                          // cut mid-sentence is not his answer
    return tidyOwnerAnswer(res.content.map(b => (b.type === "text" ? b.text : "")).join(""), p.answer) ?? fallback;
  } catch (e) {
    console.error("[owner-answer] phrasing failed", e);
    return fallback;
  }
}
