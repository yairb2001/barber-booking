// After midnight "מחר" is ambiguous (owner, 13.10.2026): someone writing at
// 01:30 "יש תור מחר?" almost always means the calendar date that just started
// (after he sleeps), but the agent read it as the day after. Between 00:00 and
// 05:00 Israel time:
//   • the agent is told explicitly which date "מחר" / "היום" mean,
//   • no customer-facing text says "היום"/"מחר" alone — always weekday + date,
//   • if the customer used a relative word without a weekday/date, the booking
//     is held until he answers ONE fixed verification question (code-enforced
//     in propose_booking, not left to the model).
// Dependency-light on purpose: imported by the agent, proposals and snapshot.
import { getBusinessNow, addDaysISO } from "@/lib/utils";

const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
export const NIGHT_END_MIN = 5 * 60;
/** Marker inside the verification question — how the guard knows it was asked. */
export const NIGHT_MARK = "כבר אחרי חצות";

export function isNightWindow(now = getBusinessNow()): boolean {
  return now.minutes < NIGHT_END_MIN;
}

/** "יום שלישי 13.10" */
export function weekdayDate(iso: string): string {
  const d = new Date(iso + "T00:00:00.000Z");
  return `יום ${DAY[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

export function nightClarifyQuestion(now = getBusinessNow()): string {
  return `רק לוודא, ${NIGHT_MARK}: הכוונה ל${weekdayDate(now.date)} (היום, אחרי שתקום) או ל${weekdayDate(addDaysISO(now.date, 1))}?`;
}

/** Context line for the agent — null outside the window. */
export function nightContextLine(now = getBusinessNow()): string | null {
  if (!isNightWindow(now)) return null;
  const today = weekdayDate(now.date), next = weekdayDate(addDaysISO(now.date, 1));
  return `⚠️ עכשיו ${now.time} בלילה, ${NIGHT_MARK}. לקוח שכותב עכשיו "מחר" מתכוון כמעט תמיד ל${today} (התאריך של היום, אחרי שיקום); "היום"/"הבוקר" — גם ל${today}; "מחרתיים" — ל${next}. ` +
    `אם הלקוח אמר "מחר"/"היום"/"הבוקר" בלי יום בשבוע או תאריך — לפני שאתה מציע שעות או קורא ל-propose_booking, שלח לו בדיוק את השאלה הזו וחכה לתשובה: "${nightClarifyQuestion(now)}". ` +
    `בשעות האלה אל תכתוב ללקוח "היום" או "מחר" לבד — תמיד יום ותאריך (למשל "${today}").`;
}

const RELATIVE = /(^|[\s,.!?])(מחר|היום|הבוקר|הלילה|בערב היום|מחרתיים)(?=$|[\s,.!?])/;
const EXPLICIT = /(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)|\b\d{1,2}[./]\d{1,2}\b/;

/**
 * Guard for propose_booking at night: the customer used a relative day word
 * and never named a weekday/date, and the verification question wasn't asked
 * (or wasn't answered) yet → the question to send instead of booking. null = go.
 */
export function nightVerificationNeeded(recent: { role: string; content: string }[], now = getBusinessNow()): string | null {
  if (!isNightWindow(now)) return null;
  // Only what was said since the night started matters (an evening "מחר" was clear).
  const userTexts = recent.filter(m => m.role === "user").map(m => m.content || "");
  if (!userTexts.some(t => RELATIVE.test(t))) return null;
  const askedAt = recent.map(m => m.role === "assistant" && (m.content || "").includes(NIGHT_MARK)).lastIndexOf(true);
  if (askedAt >= 0) {
    // Asked → the customer must have answered after it.
    return recent.slice(askedAt + 1).some(m => m.role === "user") ? null : nightClarifyQuestion(now);
  }
  if (userTexts.some(t => EXPLICIT.test(t))) return null; // he named a weekday or a date himself
  return nightClarifyQuestion(now);
}
