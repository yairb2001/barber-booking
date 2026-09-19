/**
 * Calendar closure — customer-facing text, in the closing barber's own voice.
 * Wording by the owner (17.9.2026). Editable per business via
 * Business.closureNoticeTemplate (null = this default); per-customer overrides
 * are passed in by the wizard at send time.
 */
import { addDaysISO, getBusinessNow } from "@/lib/utils";

export const DEFAULT_CLOSURE_NOTICE_TEMPLATE =
`היי {{name}}, זה {{barber}}.
אני נאלץ עקב בלת"מ לבטל לך את התור {{when}} — קודם כל, מחילה.
אני יכול לקבוע לך במקום זאת {{option_a}}{{option_b}}.
תגיד לי מה מביניהם מתאים, ואם תרצה שעה או יום אחר — תגיד לי ואדאג לך.
ושוב סליחה על השינויים.`;

export const DEFAULT_CLOSURE_REMINDER_TEMPLATE =
`היי {{name}}, זה שוב {{barber}} — רק מוודא שראית. התור {{when}} בוטל, ו{{option_a}}{{option_b}} עדיין שמורים לך. תגיד לי מה מתאים, או שעה אחרת ואסדר.`;

const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** Human label for the closed window. Hebrew words between the two times keep
 *  the bidi order right ("00:00–11:30" renders as 11:30–00:00 inside RTL text),
 *  and a cut that starts at midnight / ends at midnight reads as "until" / "from". */
export function rangeLabel(fromTime?: string | null, toTime?: string | null): string {
  if (!fromTime || !toTime) return "כל היום";
  if (fromTime === "00:00") return `עד ${toTime}`;
  if (toTime === "23:59") return `מ‑${fromTime}`;
  return `מ‑${fromTime} עד ${toTime}`;
}

/** "היום ב‑13:00" / "מחר ב‑13:30" / "ביום שלישי (23.9) ב‑10:00", + "אצל X" when it's another barber. */
export function describeSlot(o: { date: string; startTime: string; staffName?: string; sameStaff?: boolean }): string {
  const today = getBusinessNow().date;
  let dayLabel: string;
  if (o.date === today) dayLabel = "היום";
  else if (o.date === addDaysISO(today, 1)) dayLabel = "מחר";
  else {
    const d = new Date(o.date + "T00:00:00.000Z");
    dayLabel = `ביום ${DAY[d.getUTCDay()]} (${d.getUTCDate()}.${d.getUTCMonth() + 1})`;
  }
  const who = o.sameStaff === false && o.staffName ? ` אצל ${o.staffName}` : "";
  return `${dayLabel} ב‑${o.startTime}${who}`;
}

/** "היום בשעה 09:30" / "ביום רביעי (30.9) בשעה 09:30" — the cancelled slot. */
export function whenLabel(date: string, startTime: string): string {
  if (date === getBusinessNow().date) return `היום בשעה ${startTime}`;
  return `${describeSlot({ date, startTime }).replace(/ ב‑\d\d:\d\d$/, "")} בשעה ${startTime}`;
}

export function firstName(name: string): string {
  return (name || "").trim().split(/\s+/)[0] || "";
}

export function renderClosureText(
  template: string,
  v: { name: string; barber: string; when: string; options: { date: string; startTime: string; staffName: string; sameStaff: boolean }[]; originalDate?: string },
): string {
  const [a, b] = v.options;
  // "ביום רביעי (30.9) ב‑11:30 או ביום רביעי (30.9) ב‑13:00" read like a form
  // letter (first real closure, 18.9.2026). Same day as the cancelled slot →
  // "באותו יום"; second option on the same day as the first → just the time.
  const who = (o: { staffName: string; sameStaff: boolean }) => (o.sameStaff === false && o.staffName ? ` אצל ${o.staffName}` : "");
  const label = (o: typeof a) => (v.originalDate && o.date === v.originalDate ? `באותו יום ב‑${o.startTime}${who(o)}` : describeSlot(o));
  const optionA = a ? label(a) : "";
  const optionB = b ? ` או ${a && b.date === a.date ? `ב‑${b.startTime}${who(b)}` : label(b)}` : "";
  return template
    .replace(/\{\{name\}\}/g, firstName(v.name))
    .replace(/\{\{barber\}\}/g, firstName(v.barber))
    .replace(/\{\{when\}\}/g, v.when)
    .replace(/\{\{option_a\}\}/g, optionA)
    .replace(/\{\{option_b\}\}/g, optionB)
    // no options at all (manual-handling edge): drop the dangling "במקום זאת ."
    .replace(/אני יכול לקבוע לך במקום זאת \.\n/, "");
}
