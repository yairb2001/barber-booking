/**
 * The day a conversation is about (25.11.2026). The model sees earlier messages but not the tool results behind them, and
 * after "אז 17:30" it proposed Sunday in a chat that was all about Tuesday; "חמישי הבא" and "שבוע הבא" became tomorrow, and
 * "רביעי" said on a Wednesday became today. Text only, no DB, no AI.
 */
import { addDaysISO, getDayOfWeekISO } from "@/lib/utils";

const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** He leaves the day open, or says it in a form that is not read here. */
const OPEN = /הכי (?:קרוב|מוקדם|מהר)|מתי שיש|לא משנה (?:לי )?(?:מתי|איזה יום|באיזה יום)|כל יום|גמיש|השבוע(?! הבא)|סופ["״]?ש|סוף ה?שבוע|לחודש|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר|בעוד|עוד שבוע|שבועיים|יום אחר|earliest|any day|this week|next week|in a week/i;
/** The day of an appointment he already has ("תבטל את שני", "במקום רביעי", "לא מחר"): not what he asks for. */
const NOT_ASKED = new RegExp(`(?:תבטל\\S*|לבטל|ביטול|התור(?: שלי)?|במקום|למה|ולא|לא(?: יכולה?)?|משני|מהתור)\\s+(?:את\\s+|של\\s+|ה?תור\\s+|זה\\s+|ה)*(?:ב|ל|מ)?(?:יום\\s+)?ה?(?:${DAY.join("|")}|היום|מחר)(?![א-ת])`, "g");

/** "ואם מתפנה היום תעדכנו": what he would rather have, not the day he books. */
const IF_OPENS = /אם\s+(?:כן\s+)?(?:יש\s+)?(?:י?תפנה|יתפנה|מתפנה|תתפנה|נפתח|ייפתח|מתבטל|יתבטל|משהו|מישהו|מישהי)[^,.?!\n]*|(?:תעדכ|תודיע|תגיד)\S*[^,.?!\n]*(?:מתפנה|יתפנה|מתבטל|יתבטל)[^,.?!\n]*/g;
/** "ושלי ביום שני לא זז נכון?": the appointment he already has. */
const HIS_OWN = new RegExp(`(?:ושלי|שלי|התור שלו|התור שלה|נשאר)\\s+(?:זה\\s+)?(?:ב|ל)?(?:יום\\s+)?(?:${DAY.join("|")}|היום|מחר)(?![א-ת])`, "g");

const dateOf = (d: number, m: number, today: string): string | null => {
  for (let i = 0; i < 90; i++) { const iso = addDaysISO(today, i); if (Number(iso.slice(8)) === d && Number(iso.slice(5, 7)) === m) return iso; }
  return null;
};
/** The weekday after today; the same weekday as today is next week's (today is "היום"). */
const nextWeekday = (dow: number, today: string): string => addDaysISO(today, ((dow - getDayOfWeekISO(today) + 6) % 7) + 1);
const weekStart = (iso: string): string => addDaysISO(iso, -getDayOfWeekISO(iso));

export type AskedDays = { days: string[]; week: boolean; open: boolean; mismatch: { date: string; weekday: string } | null };

/** The days a message asks for. `around` = the day discussed before it: a weekday alone may be that week's. */
export function askedDays(raw: string, today: string, around: string | null = null): AskedDays {
  const text = raw.replace(IF_OPENS, " ").replace(HIS_OWN, " ").replace(NOT_ASKED, " ");
  const days = new Set<string>(), weekdays: number[] = [], dates: string[] = [];
  for (const m of Array.from(text.matchAll(/(?:^|[^\d:./])(\d{1,2})[./](\d{1,2})(?![\d:])/g))) { const iso = dateOf(Number(m[1]), Number(m[2]), today); if (iso) dates.push(iso); }
  if (/(?:^|[\s,])ל?מחרתיים|day after tomorrow/i.test(text)) days.add(addDaysISO(today, 2));
  else if (/(?:^|[\s,])ל?מחר(?![א-ת])|tomorrow/i.test(text)) days.add(addDaysISO(today, 1));
  if (/(?:^|[\s,])(?:ל|ב)?היום(?![א-ת])|today|tonight/i.test(text)) days.add(today);
  const next = /שבוע הבא|next week/i.test(text);
  let nextWeek = next;
  for (const m of Array.from(text.matchAll(new RegExp(`(^|[\\s,.(?!])(ל?יום\\s+|ביום\\s+|ב|לל?|ה|מ)?(${DAY.join("|")})(\\s+הבא|\\s+הקרוב)?(?![א-ת])`, "g")))) {
    const after = text.slice((m.index ?? 0) + m[0].length), dow = DAY.indexOf(m[3]);
    // "שני תורים", "ביקור ראשון", a name: those two words need something that makes them a day.
    if (dow <= 1 && !m[2] && !m[4] && !/^\s*(?:ב|או(?![א-ת])|\d|$|[,.?!])/.test(after)) continue;
    if (dow <= 1 && /(?:ביקור|טיפול|תור|פעם)\s*$/.test(text.slice(0, m.index)) && !m[2]) continue;
    weekdays.push(dow);
    if (m[4]?.trim() === "הבא") nextWeek = true;
  }
  for (const [i, w] of Array.from(EN.entries())) if (new RegExp(`\\b${w}\\b`, "i").test(text)) weekdays.push(i);
  const mismatch = dates.length === 1 && weekdays.length === 1 && getDayOfWeekISO(dates[0]) !== weekdays[0] ? { date: dates[0], weekday: DAY[weekdays[0]] } : null;
  dates.forEach(d => days.add(d));
  if (!dates.length) for (const dow of weekdays) {
    if (nextWeek) { days.add(addDaysISO(addDaysISO(weekStart(today), 7), dow)); continue; }
    const soon = nextWeekday(dow, today), same = around ? addDaysISO(weekStart(around), dow) : null;
    if (same && same > soon) days.add(same);
    else days.add(soon);
  }
  const week = next && !weekdays.length && !dates.length;
  if (week) for (let i = 0; i < 7; i++) days.add(addDaysISO(addDaysISO(weekStart(today), 7), i));
  return { days: Array.from(days).sort(), week, open: !days.size && OPEN.test(raw), mismatch };
}

export type Talk = { asked: AskedDays | null; offered: string[] };
/** Newest first. What he last asked for, and the days the agent named after that. */
export function talkedDays(messages: { role: string; content: string }[], today: string): Talk {
  const list = messages.filter(m => m.role === "user" || m.role === "assistant").slice(0, 14);
  const offered = new Set<string>();
  for (const [i, m] of Array.from(list.entries())) {
    if (m.role === "assistant") { askedDays(m.content, today).days.forEach(d => offered.add(d)); continue; }
    const before = list.slice(i + 1).find(x => x.role === "assistant" && askedDays(x.content, today).days.length === 1);
    const asked = askedDays(m.content, today, before ? askedDays(before.content, today).days[0] : null);
    if (asked.days.length || asked.open) return { asked, offered: Array.from(offered) };
  }
  return { asked: null, offered: Array.from(offered) };
}

const label = (iso: string): string => `${DAY[getDayOfWeekISO(iso)]} ${Number(iso.slice(8))}.${Number(iso.slice(5, 7))} (${iso})`;

/** The line the model reads: the day in full, so a bare hour later still belongs to it. */
export function talkedDayLine(t: Talk, today: string): string {
  const a = t.asked;
  if (!a || a.open) return "";
  if (a.mismatch) return `הוא כתב יום ${a.mismatch.weekday} עם התאריך ${Number(a.mismatch.date.slice(8))}.${Number(a.mismatch.date.slice(5, 7))}, אבל בתאריך הזה יום ${DAY[getDayOfWeekISO(a.mismatch.date)]}. לפני שעות והצעה: שאל במשפט אחד לאיזה משניהם התכוון.`;
  if (a.week) return `הוא ביקש שבוע הבא: ${label(a.days[0])} עד ${label(a.days[6])}. אל תציע יום לפני זה.`;
  if (a.days.length > 3) return "";
  const other = t.offered.filter(d => !a.days.includes(d));
  return `היום שהוא ביקש: ${a.days.map(label).join(" או ")}${a.days[0] === today ? " (היום)" : ""}. כל שעה שהוא כותב היא ליום הזה, עד שהוא מחליף יום.${other.length && other.length <= 3 ? ` (בינתיים הוזכרו גם: ${other.map(label).join(", ")})` : ""}`;
}

/** Why a proposal for `date` contradicts what he said; null = nothing against it. */
export function againstTalkedDay(t: Talk, date: string): string | null {
  const a = t.asked;
  if (!a || a.open || !a.days.length) return null;
  if (a.mismatch && !t.offered.includes(date)) return `שגיאה: הוא כתב יום ${a.mismatch.weekday} עם תאריך של יום ${DAY[getDayOfWeekISO(a.mismatch.date)]}. שאל לאיזה התכוון לפני שמציעים.`;
  if (a.days.includes(date) || t.offered.includes(date)) return null;
  return `שגיאה: הוא ביקש ${a.days.slice(0, 2).map(label).join(" או ")}${a.week ? " ואילך (שבוע הבא)" : ""}, וההצעה היא ל${label(date)}. קרא ל-propose_booking ליום שהוא ביקש; אם אין שם מקום, אמור את זה והצע יום אחר לפני הצעה לאישור.`;
}
