// Focused availability line — code, not the model, filters the snapshot by
// what the customer asked ("מחר אחרי 17:00", "בערב השבוע", "הכי מוקדם מחר").
// Born from a real miss (21.9.2026): the model showed three of Yosef's slots
// and told the customer "nothing after 17:00" while 17:50–19:10 were free.
import type { AvailabilityIndex } from "@/lib/availability-index";
import { addDaysISO, getDayOfWeekISO } from "@/lib/utils";

const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const DAY_RE = /(?:^|[\s,])(?:ב|ביום |יום |ל|ליום |מה לגבי |ומה עם |ו)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?=$|[\s?,.!])/g;
const AVAIL_VERB = /פנוי|יש |מתי|שעות|אפשר|מקום|תור/;

export type AvailabilityAsk = {
  days: string[];             // ISO dates inside the snapshot window
  dayLabel: string;
  from?: number;              // minutes, inclusive
  to?: number;                // minutes, exclusive
  rangeLabel?: string;
  pick?: "earliest" | "latest";
  staffHint?: string | null;
};

const toMin = (h: number, m: number) => h * 60 + m;
/** "5" after "אחרי"/"בערב"-ish words means 17:00 in a barbershop. */
const pmFix = (h: number, m: number, evening: boolean) => (evening && h >= 1 && h <= 8 ? toMin(h + 12, m) : toMin(h, m));

export function parseAvailabilityAsk(text: string, today: string, windowDays: number, staffNames: { id: string; name: string }[] = []): AvailabilityAsk | null {
  const t = text.replace(/[‎‏‪-‮⁦-⁩﻿]/g, "").replace(/[״"]/g, "").trim();
  if (!t || t.length > 160) return null;
  if (/בעוד (שבוע|שבועיים|\d+ (ימים|שבועות))|עוד שבועיים|בחודש הבא/.test(t)) return null;   // beyond the window → tools
  const inWindow = Array.from({ length: windowDays }, (_, d) => addDaysISO(today, d));

  // ── day ───────────────────────────────────────────────────────────────────
  let days: string[] | null = null, dayLabel = "";
  if (/מחרתיים/.test(t)) { days = [inWindow[2]].filter(Boolean); dayLabel = "מחרתיים"; }
  else if (/(^|[\s,])(ל?מחר)(?=$|[\s?,.!])/.test(t)) { days = [inWindow[1]].filter(Boolean); dayLabel = "מחר"; }
  else if (/(^|[\s,])(ל?היום)(?=$|[\s?,.!])/.test(t)) { days = [inWindow[0]]; dayLabel = "היום"; }
  else if (/שבוע הבא/.test(t)) return null;                       // beyond the window → tools
  else if (/השבוע/.test(t)) { const sat = inWindow.findIndex(iso => getDayOfWeekISO(iso) === 6); days = sat > 0 ? inWindow.slice(0, sat + 1) : inWindow; dayLabel = "השבוע"; }
  else {
    // "שלישי לא יכול, מה לגבי רביעי?" → the LAST day named is the one asked about
    const dms = Array.from(t.matchAll(DAY_RE)); const dm = dms.length ? dms[dms.length - 1] : null;
    const num = t.match(/(?:^|[\s,\-])(\d{1,2})[./](\d{1,2})(?=$|[\s?,.!])/);
    if (dm) { const dow = DAY.indexOf(dm[1]); const iso = inWindow.find(d => getDayOfWeekISO(d) === dow); if (!iso) return null; days = [iso]; dayLabel = "יום " + dm[1]; }
    else if (num) { const d = Number(num[1]), mo = Number(num[2]); const iso = inWindow.find(x => { const dd = new Date(x + "T00:00:00.000Z"); return dd.getUTCDate() === d && dd.getUTCMonth() + 1 === mo; }); if (!iso) return null; days = [iso]; dayLabel = `${d}.${mo}`; }
  }

  // ── range / pick ──────────────────────────────────────────────────────────
  let from: number | undefined, to: number | undefined, rangeLabel: string | undefined, pick: "earliest" | "latest" | undefined;
  const evening = /ערב|לילה|אחרי הצהריים|אחה"?צ|אחרי/.test(t);
  const after = t.match(/(?:אחרי|מ|החל מ|מהשעה)[\s\-]*(?:השעה\s*)?(\d{1,2})(?::(\d{2}))?(?=$|[\s?,.!])/);
  const before = t.match(/(?:לפני|עד)[\s\-]*(?:השעה\s*)?(\d{1,2})(?::(\d{2}))?(?=$|[\s?,.!])/);
  if (after) { from = pmFix(Number(after[1]), Number(after[2] ?? 0), evening || Number(after[1]) <= 8) + (after[2] ? 0 : 0); rangeLabel = `אחרי ${fmt(from)}`; }
  if (before) { to = pmFix(Number(before[1]), Number(before[2] ?? 0), Number(before[1]) <= 8 && /ערב|אחה/.test(t)); rangeLabel = (rangeLabel ? rangeLabel + " ו" : "") + `לפני ${fmt(to)}`; }
  if (!after && !before) {
    if (/בבוקר|בוקר/.test(t)) { to = toMin(12, 0); rangeLabel = "בבוקר"; }
    else if (/בצהריים|בצהרים|צהריים/.test(t) && !/אחרי הצהריים|אחה"?צ/.test(t)) { from = toMin(12, 0); to = toMin(16, 0); rangeLabel = "בצהריים"; }
    else if (/אחרי הצהריים|אחה"?צ/.test(t)) { from = toMin(14, 0); to = toMin(18, 0); rangeLabel = "אחרי הצהריים"; }
    else if (/בערב|ערב/.test(t)) { from = toMin(17, 0); rangeLabel = "בערב"; }
    else if (/בלילה|לילה/.test(t)) { from = toMin(19, 0); rangeLabel = "בלילה"; }
  }
  if (/הכי מאוחר|כמה שיותר מאוחר|יותר מאוחר|מאוחר יותר|הכי מאוחרת|מאוחר ככל/.test(t)) pick = "latest";
  else if (/הכי מוקדם|כמה שיותר מוקדם|יותר מוקדם|מוקדם יותר|הכי מוקדמת|הכי קרוב|יותר קרוב|קרוב יותר/.test(t)) pick = "earliest";

  // ── barber ────────────────────────────────────────────────────────────────
  // Best-matching barber by number of name parts found ("ליאיר בוחבוט" → 2 for
  // יאיר בוחבוט, 1 for יאיר הרוש); a tie is ambiguous → no hint.
  let staffHint: string | null = null, best = 0, tie = false;
  for (const s of staffNames) {
    const parts = s.name.trim().split(/\s+/).filter(p => p.length >= 3);
    const n = parts.filter(p => t.includes(p)).length;
    if (n > best) { best = n; staffHint = s.id; tie = false; } else if (n === best && n > 0) tie = true;
  }
  if (tie) staffHint = null;

  if (!days && from === undefined && to === undefined && !pick && !(staffHint && AVAIL_VERB.test(t))) return null;
  if (!days) { days = inWindow; dayLabel = "בימים הקרובים"; }
  if (!days.length) return null;
  return { days, dayLabel, from, to, rangeLabel, pick, staffHint };
}

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const mins = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** One line the model can quote: what is actually free for exactly what was asked. */
export function focusLine(index: AvailabilityIndex, ask: AvailabilityAsk, serviceId: string | null, label: (s: { id: string; name: string }) => string, today: string, windowDays: number, regularStaffId?: string | null): string {
  // Not asked by name → only the quick-booking pool (plus the customer's regular
  // barber); barbers outside the pool are offered only when named.
  const hasPool = index.staff.some(s => s.inQuickPool);
  const staff = ask.staffHint ? index.staff.filter(s => s.id === ask.staffHint) : index.staff.filter(s => !hasPool || s.inQuickPool || s.id === regularStaffId);
  const question = [ask.dayLabel, ask.rangeLabel, ask.pick === "latest" ? "הכי מאוחר" : ask.pick === "earliest" ? "הכי מוקדם" : ""].filter(Boolean).join(" ");
  const inRange = (hhmm: string) => { const m = mins(hhmm); return (ask.from === undefined || m >= ask.from) && (ask.to === undefined || m < ask.to); };
  const dayName = (iso: string) => { const d = new Date(iso + "T00:00:00.000Z"); const off = Math.round((d.getTime() - new Date(today + "T00:00:00.000Z").getTime()) / 864e5); return `${off === 0 ? "היום" : off === 1 ? "מחר" : DAY[getDayOfWeekISO(iso)]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`; };
  const lines: string[] = [];
  let any = false;
  for (const iso of ask.days) {
    const parts: string[] = [];
    for (const s of staff) {
      let slots = index.slots(s.id, iso, serviceId).filter(inRange);
      if (!slots.length) continue;
      if (ask.pick === "latest") slots = [slots[slots.length - 1]];
      else if (ask.pick === "earliest") slots = [slots[0]];
      parts.push(`${label(s)} ${slots.slice(0, 12).join(" · ")}${slots.length > 12 ? " ועוד" : ""}`);
    }
    if (parts.length) { any = true; lines.push(`${dayName(iso)}: ${parts.join(" | ")}`); }
    else if (ask.days.length === 1) lines.push(`${dayName(iso)}: אין${ask.rangeLabel ? " " + ask.rangeLabel : ""}${ask.staffHint ? " אצל " + (staff[0] ? label(staff[0]) : "הספר") : " אצל אף ספר"}`);
  }
  if (!any && ask.days.length > 1) lines.push(`אין ${ask.rangeLabel ?? ""} ${ask.dayLabel}${ask.staffHint && staff[0] ? " אצל " + label(staff[0]) : ""}`.replace(/\s+/g, " ").trim());
  // Nothing in the asked day(s) → the nearest day in the window that does have it.
  if (!any) {
    const all = Array.from({ length: windowDays }, (_, d) => addDaysISO(today, d)).filter(iso => !ask.days.includes(iso) && iso > ask.days[ask.days.length - 1]);
    for (const iso of all) {
      const parts: string[] = [];
      for (const s of staff) { const slots = index.slots(s.id, iso, serviceId).filter(inRange); if (slots.length) parts.push(`${label(s)} ${slots.slice(0, 6).join(" · ")}`); }
      if (parts.length) { lines.push(`הקרוב אחרי זה: ${dayName(iso)}: ${parts.join(" | ")}`); break; }
    }
  }
  return `ממוקד לשאלה "${question}" (מסונן בקוד מהרשימה המלאה — זו התשובה, אל תצמצם ואל תוסיף):\n${lines.join("\n")}`;
}
