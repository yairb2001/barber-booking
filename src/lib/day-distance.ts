/**
 * How far away is an appointment — in words a customer can't misread.
 *
 * Real failure this exists for: a customer books "יום חמישי" meaning NEXT
 * Thursday and shows up on the one two days from now. A date alone doesn't
 * stop that; a distance in days does, and so does spelling out "הבא" whenever
 * that weekday still happens before the appointment.
 *
 * Dependency-free on purpose: the agent, the messaging templates and the
 * booking site all import it, and a cycle through @/lib/messaging has broken
 * production before.
 */

const HEB_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export type DayDistance = {
  /** 0 = today, 1 = tomorrow … */
  days: number;
  /** "היום" | "מחר" | "מחרתיים" | "בעוד 4 ימים" | "בעוד שבוע בדיוק" … */
  label: string;
  /** The same weekday comes round before the appointment → say "הבא". */
  isNext: boolean;
  /** "חמישי" */
  weekday: string;
  /** "יום חמישי" or "יום חמישי הבא" — the word that prevents the mistake. */
  weekdayLabel: string;
  /** true for 7–13 days out: the range where customers actually get it wrong. */
  risky: boolean;
};

const toUTC = (iso: string) => new Date(iso + "T00:00:00.000Z").getTime();

/** `dateISO` and `todayISO` are business-local YYYY-MM-DD (see getBusinessNow). */
export function dayDistance(dateISO: string, todayISO: string): DayDistance {
  const days = Math.round((toUTC(dateISO) - toUTC(todayISO)) / 86_400_000);
  const weekday = HEB_DAYS[new Date(dateISO + "T00:00:00.000Z").getUTCDay()];
  // 7–13 days: that weekday comes round once before the appointment — literally
  // "הבא". Past 13 it is the one AFTER next, so "הבא" would be wrong; there the
  // spelled-out distance ("בעוד שבועיים") carries the meaning on its own.
  const isNext = days >= 7 && days <= 13;
  const label =
    days < 0 ? "עבר"
    : days === 0 ? "היום"
    : days === 1 ? "מחר"
    : days === 2 ? "מחרתיים"
    : days === 7 ? "בעוד שבוע בדיוק"
    : days === 14 ? "בעוד שבועיים"
    : days === 21 ? "בעוד 3 שבועות"
    : `בעוד ${days} ימים`;
  return {
    days,
    label,
    isNext,
    weekday,
    weekdayLabel: `יום ${weekday}${isNext ? " הבא" : ""}`,
    risky: isNext,
  };
}

/** "יום חמישי הבא, 2.10 — בעוד 8 ימים" (WhatsApp bold on the word that matters). */
export function dayDistanceLine(dateISO: string, todayISO: string, opts?: { bold?: boolean }): string {
  const d = dayDistance(dateISO, todayISO);
  if (d.days <= 2) return d.label;
  const date = new Date(dateISO + "T00:00:00.000Z");
  const dm = `${date.getUTCDate()}.${date.getUTCMonth() + 1}`;
  const next = opts?.bold !== false && d.isNext ? `יום ${d.weekday} *הבא*` : d.weekdayLabel;
  return `${next}, ${dm} — ${d.label}`;
}
