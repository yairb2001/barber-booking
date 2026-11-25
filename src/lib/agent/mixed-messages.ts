/**
 * Two things in one message (25.11.2026): a pattern that repeats in real chats and broke in the tests of 13
 * business types. "כן. אגב כמה זה?" booked and dropped the question; "18:30 ותבטל את רביעי" cancelled and
 * dropped the booking; "ראשון ב11, מורן שי" read the customer's name as a staff member. Text only, no DB, no AI.
 */
import { classifyReply, looksLikeName } from "@/lib/agent/booking-proposals";

const REQUEST = /[?؟]|אגב|כמה (?:זה|עולה|יעלה|זמן)|איפה|כתובת|חניה|תבטל|לבטל|תזיז|להזיז|תעדכ[ןנ]|תגיד|האם|by the way|how much|where|cancel/i;
const YES_PREFIX = /^\s*(?:כן+|מאשרת?|אוקיי?|סבבה|בסדר|מעולה|סגור|אישור|yes|yep|ok(?:ay)?|sure)(?![א-תa-z])[\s,.!]*/i;

/** "כן" with another request beside it → the request; a yes alone (or a yes that only adds detail) → null. */
export function requestBesideYes(text: string): string | null {
  const t = text.trim();
  if (!YES_PREFIX.test(t)) return null;
  const rest = t.replace(YES_PREFIX, "").replace(/^\s*(?:תודה(?: רבה)?|אחי|thanks)[\s,.!]*/i, "").trim();
  return rest && REQUEST.test(rest) && classifyReply(rest) !== "yes" ? rest : null;
}

/** Starts with a yes, whatever comes after it. */
export const startsWithYes = (text: string): boolean => YES_PREFIX.test(text.trim());

/** The answer to "מה השם המלא שלך?" with something beside it ("קרן אור, רגע כמה זה?"). */
export function nameWithRequest(text: string): { name: NonNullable<ReturnType<typeof looksLikeName>>; rest: string } | null {
  const m = text.trim().match(/^([^,.!?\n]+?)(?:[,.!\n]+|\s+(?=רגע|אבל|אגב|כמה|וכמה|איפה))\s*([\s\S]+)$/);
  const name = m && looksLikeName(m[1]);
  return name ? { name, rest: m[2].trim() } : null;
}

/** "קרן אור, רגע כמה זה?" → the question beside the name. */
export function requestBesideName(text: string): string | null {
  const rest = nameWithRequest(text)?.rest;
  return rest && REQUEST.test(rest) ? rest : null;
}

/** "כן תזיזי" to "רוצה שאזיז אותו ל-11:30?" → "11:30", when the question names one hour besides his own. */
export function offeredHour(question: string, currentStart: string): string | null {
  const asked = question.split(/(?<=[?!\n])|(?<=\.)(?!\d)/).filter(s => /[?؟]/.test(s)).pop() ?? "";
  // "שלישי 17:00 לא נשמר. רוצה שאזיז עכשיו?": the hour stands before the question.
  const from = /\d{1,2}:\d{2}/.test(asked) ? asked : question;
  const hours = Array.from(new Set(Array.from(from.matchAll(/\d{1,2}:\d{2}/g)).map(m => m[0].padStart(5, "0")))).filter(h => h !== currentStart);
  return hours.length === 1 ? hours[0] : null;
}

/** "כן" to "לבטל את 18:00 ולקבוע ב-20:00?" is a move: the old appointment stays until the new hour is confirmed
 *  (25.11.2026: it was cancelled first). Returns the hour and the question it was asked in. */
export function yesToCancelAndRebook(text: string, question: string, currentStart: string): string | null {
  if (!startsWithYes(text) || /\d/.test(text) || !/לבטל/.test(question) || !/לקבוע|קובע|אקבע/.test(question)) return null;
  return offeredHour(question, currentStart);
}

const HOUR_WORDS = ["אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע", "עשר", "אחת עשרה", "שתים עשרה"];
const MINUTE_WORDS: Record<string, number> = { "חצי": 30, "רבע": 15, "עשרה": 10, "חמישה": 5, "עשרים": 20 };
/** "שלוש ועשרה" → "3:10", "רבע לחמש" → "4:45", "אז שלוש" → "3:00". Morning or evening is for the caller. */
export function hourInWords(text: string): string | null {
  const hour = (w: string) => HOUR_WORDS.indexOf(w) + 1;
  const hours = [...HOUR_WORDS].reverse().join("|");
  const after = text.match(new RegExp(`(?:^|[\\s,])[בל]?(${hours})\\s+ו(${Object.keys(MINUTE_WORDS).join("|")})(?=$|[\\s,.?!])`));
  if (after) return `${hour(after[1])}:${String(MINUTE_WORDS[after[2]]).padStart(2, "0")}`;
  const before = text.match(new RegExp(`(רבע|עשרה|חמישה|עשרים)\\s+ל(${hours})(?=$|[\\s,.?!])`));
  if (before) return `${(hour(before[2]) + 11) % 12 || 12}:${60 - MINUTE_WORDS[before[1]]}`;
  const whole = text.match(new RegExp(`(?:^|\\s)(?:ב|אז\\s+|בשעה\\s+)(${hours})(?=$|[,.?!\\n])`));
  return whole ? `${hour(whole[1])}:00` : null;
}

const halfInWords = (text: string): string => text.replace(/(^|\s)(\d{1,2})\s+ו(רבע|חצי)(?![א-ת])/, (m, pre: string, h: string, w: string) => HOUR_WORDS[Number(h) - 1] ? `${pre}${HOUR_WORDS[Number(h) - 1]} ו${w}` : m);
/** The one hour he names for the appointment itself ("ב15:10", "אז שלוש"), as "15:10" or "3:00". */
export function namedHour(text: string): string | null {
  const words = hourInWords(halfInWords(text));
  if (words) return words;
  if (/אחרי|לפני|עד|החל|בסביבות|איזור|אזור|בערך|חייב|לצאת|לסיים|במקום|יש לי|\d\s*(?:או|-|–)\s*\d|\d{1,2}[./]\d{1,2}/.test(text)) return null;
  // "930" and "1830" are hours too, unless it is money.
  const compact = /₪|שקל|ש["״]ח/.test(text) ? [] : Array.from(text.matchAll(/(?:^|\s)ב?-?(\d{1,2})(00|15|30|45)(?![\d₪])/g)).filter(m => Number(m[1]) < 24).map(m => `${m[1]}:${m[2]}`);
  const hours = [...Array.from(text.matchAll(/(?:^|[^\d:])(\d{1,2}:\d{2})(?!\d)/g)).map(m => m[1]), ...compact];
  return hours.length === 1 ? hours[0] : null;
}

/** "3:00" and "15:00" are the same hour when he did not say which half of the day. */
export const sameHour = (said: string, time: string): boolean => {
  const [h, m] = said.split(":").map(Number), [th, tm] = time.split(":").map(Number);
  return m === tm && (h === th || (h <= 12 && h % 12 === th % 12));
};

/** "…, הברך הורגת אותי": a complaint, not a name (25.11.2026). */
const NOT_A_NAME = /(?:^|\s)(?:אותי|לי|לך|שלי|ממש|נורא|כוא\S+|הורג\S*|צריכה?|דחוף|בבקשה|תודה|לאשר|מאשרת?)(?=\s|$)/;
/** "ראשון ב11, מורן שי": a chosen time, and a full name that closes the message. */
export function nameAtEnd(text: string): string | null {
  const m = text.trim().match(/^([\s\S]+)[,\n]\s*([^,\n\d?]+)$/);
  return (m && (/\d/.test(m[1]) || ((hourInWords(m[1]) || YES_PREFIX.test(m[1])) && m[2].trim().split(/\s+/).length === 2)) && !NOT_A_NAME.test(m[2]) && looksLikeName(m[2])?.full) || null;
}

const CLOCK = /(?:^|[^\d:./])(\d{1,2}):?(\d{2})(?!\d|[./]\d)/g;
/** He cancels one appointment and names an hour that is not its own: a new booking comes first. */
export function cancelBesideNewTime(text: string, currentStart: string): boolean {
  const bare = Array.from(text.matchAll(/(?:^|\s)ב[- ]?(\d{1,2})(?![\d:./])(?!\s*לחודש)/g)).map(m => Number(m[1])).filter(h => h >= 1 && h <= 23);
  const own = Number(currentStart.split(":")[0]);
  if (bare.length && bare.every(h => h % 12 !== own % 12)) return true;
  const times = Array.from(text.matchAll(CLOCK)).filter(m => Number(m[1]) < 24 && Number(m[2]) < 60).map(m => `${m[1].padStart(2, "0")}:${m[2]}`);
  return times.some(t => t !== currentStart);
}

/** He asks to cancel ("ותבטל לי את רביעי"), not about cancelling and not "אם מישהו מבטל". */
export const asksToCancel = (text: string): boolean => !/[?؟]/.test(text) && !/אל\s+תבטל|לא\s+לבטל|אם\s+\S*\s*(?:מבטל|יבטל|מתבטל|יתבטל)/.test(text) && /(?:^|\s)ו?(?:לבטל|תבטלי?|תבטלו|בטלי?|(?:תורידי?|תורידו|תמחקי?)(?=\s[^\n]*(?:תור|של|את)))(?=\s|$)|cancel/i.test(text);

/** "תקבע בינתיים ואם מתפנה היום אחרי 16 תגיד" → "היום אחרי 16": what he would rather have. */
export function wantsIfOpens(text: string): string | null {
  const m = text.match(/אם\s+(?:כן\s+)?(?:יתפנה|מתפנה|תתפנה|נפתח|ייפתח|יתבטל|מתבטל)\s*([^,.?!\n]*)/);
  if (!m) return null;
  return m[1].replace(/(?:^|\s)(?:תגיד|תעדכ[ןנ]|תודיע|תכתב)[\s\S]*$/, "").replace(/^\s*(?:לך|לכם|משהו)\s*/, "").trim() || "משהו מוקדם יותר";
}

const FINISH_BY = /(?:לצאת|לסיים|לגמור|ללכת|לזוז|אצא|לקום)\s+(?:עד\s+|לפני\s+)?(?:ה?שעה\s+)?ב?-?(\d{1,2})(?::(\d{2}))?(?!\d|[./]\d)/;
/** "חייב לצאת עד 14" → 840 (minutes); the model got this subtraction wrong twice. */
export function finishBy(text: string): number | null {
  const m = text.match(FINISH_BY);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return (h >= 1 && h <= 7 ? h + 12 : h) * 60 + min;
}

const STUCK = /פנצ['׳]?ר|תקוע|נתקעתי|פקק|מאחר|באיחור|לא (?:אספיק|מספיק|אגיע|מגיע|אצליח)|חולה|חום/;
const SAYS_CHANGED = /(?:כבר\s+)?(?:הזזתי|שיניתי|ביטלתי|העברתי)/;
/** What he writes is about the appointment he already has. Empty when there is none. */
export function aboutHisAppointment(text: string, hasUpcoming: boolean): string {
  if (!hasUpcoming) return "";
  const parts: string[] = [];
  if (STUCK.test(text)) parts.push("הוא כותב על עיכוב או תקלה, וזה על התור שרשום לו: ענה בהשתתפות קצרה ושאל אם להזיז (או לאחר) את התור. אל תענה שזה לא קשור אליך.");
  if (SAYS_CHANGED.test(text)) parts.push("הוא אומר שכבר שינה את התור. התור שרשום למעלה נכון לרגע זה וכולל כל שינוי מהאתר, מהקישור ומהאפליקציה. לא תואם למה שאמר → השינוי לא נשמר: אמור לו מה רשום והצע לשנות. אל תאשר שינוי שלא מופיע, ואל תאמר שזה עוד יתעדכן.");
  return parts.join("\n");
}
