/**
 * Availability snapshot for the agent's per-turn context (owner's idea, 20.9.2026).
 *
 * Instead of the model probing get_available_slots day after day ("מה פנוי
 * השבוע?" cost 6 tool calls, "יש בערב השבוע?" another 4 — real conversation),
 * the next days' free slots of EVERY barber are written into the context,
 * compressed, rebuilt fresh on every message. The model answers "this week /
 * tomorrow / evening / another barber" from it; the tools remain for days beyond
 * the window and for a re-check. propose_booking still verifies the slot before
 * the confirmation goes out, so a slot taken meanwhile is caught there.
 *
 * Size is the whole game (every injected token is paid at full price on every
 * turn): runs of evenly spaced slots collapse to "13:00–15:30 כל 30", closed
 * days are one word, and the block is only injected in booking contexts.
 */
import { buildAvailabilityIndex } from "@/lib/availability-index";
import { getBusinessNow, addDaysISO, getDayOfWeekISO, timeToMinutes } from "@/lib/utils";

const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const BOOKING_CONTEXT = /תור|לקבוע|לקבע|פנוי|פנויה|פנויים|מקום|מחר|היום|השבוע|שבוע|יום |ביום|שעה|שעות|מתי|בוקר|צהריים|ערב|לילה|הכי קרוב|אצל|ספר|תספורת|זקן|מספריים|book|appointment|available|slot|tomorrow|today|week/i;

export function looksLikeBookingContext(texts: string[]): boolean {
  return texts.some(t => BOOKING_CONTEXT.test(t));
}

/** "13:00–15:30 כל 30 · 17:00" — runs of ≥3 evenly spaced slots collapse to a range. */
export function compressSlots(slots: string[]): string {
  if (!slots.length) return "";
  const mins = slots.map(timeToMinutes).sort((a, b) => a - b);
  const out: string[] = [];
  let i = 0;
  while (i < mins.length) {
    let j = i + 1;
    const step = j < mins.length ? mins[j] - mins[i] : 0;
    if (step > 0 && step <= 60) { while (j + 1 < mins.length && mins[j + 1] - mins[j] === step) j++; }
    const len = j - i + 1;
    if (len >= 3 && step > 0) { out.push(`${fmt(mins[i])}–${fmt(mins[j])} כל ${step}`); i = j + 1; }
    else { out.push(fmt(mins[i])); i++; }
  }
  return out.join(" · ");
}
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export async function buildAvailabilitySnapshot(p: {
  businessId: string;
  days?: number;
  serviceId?: string | null;
  regularStaffId?: string | null;
  /** short names by staff id (first name), to keep the block small */
  shortName?: (id: string, name: string) => string;
}): Promise<string> {
  const days = p.days ?? 6;
  const today = getBusinessNow().date;
  const index = await buildAvailabilityIndex(p.businessId, today, days);
  const hasPool = index.staff.some(s => s.inQuickPool);
  const short = p.shortName ?? ((id, name) => name.trim().split(/\s+/)[0]);
  // Two barbers may share a first name (יאיר בוחבוט / יאיר הרוש) — disambiguate.
  const firsts = new Map<string, number>();
  for (const s of index.staff) firsts.set(short(s.id, s.name), (firsts.get(short(s.id, s.name)) ?? 0) + 1);
  const label = (s: { id: string; name: string }) => (firsts.get(short(s.id, s.name)) ?? 0) > 1 ? s.name : short(s.id, s.name);

  const lines: string[] = [];
  for (let d = 0; d < days; d++) {
    const iso = addDaysISO(today, d);
    const dayName = d === 0 ? "היום" : d === 1 ? "מחר" : DAY[getDayOfWeekISO(iso)];
    const dd = new Date(iso + "T00:00:00.000Z");
    const parts: string[] = [];
    for (const s of index.staff) {
      const slots = index.slots(s.id, iso, p.serviceId ?? null);
      if (!slots.length) continue;
      parts.push(`${label(s)} ${compressSlots(slots)}`);
    }
    lines.push(`${dayName} ${dd.getUTCDate()}.${dd.getUTCMonth() + 1}: ${parts.length ? parts.join(" | ") : "אין"}`);
  }
  const notes: string[] = [];
  // Barbers with nothing free in the whole window are named explicitly — otherwise
  // the model "double-checks" them day by day (owner's replay, 20.9.2026).
  const fullyBooked = index.staff.filter(s => !Array.from({ length: days }, (_, d) => addDaysISO(today, d)).some(iso => index.slots(s.id, iso, p.serviceId ?? null).length));
  if (fullyBooked.length) notes.push(`אין שום מקום ב-${days} הימים האלה אצל: ${fullyBooked.map(label).join(", ")} — אל תבדוק אותם יום-יום; רוצה אותם → find_next_available עם ה-staffId שלהם`);
  if (hasPool) {
    const outside = index.staff.filter(s => !s.inQuickPool).map(label);
    if (outside.length) notes.push(`${outside.join(", ")} — רק אם הלקוח מבקש אותו בשמו או שהוא הקבוע שלו`);
  }
  if (p.regularStaffId) { const r = index.staff.find(s => s.id === p.regularStaffId); if (r) notes.push(`הקבוע של הלקוח: ${label(r)}`); }
  return `זמינות ל-${days} הימים הקרובים, לכל ספר, נכון לרגע זה (אותו מקור כמו הכלים; "כל 30" = כל 30 דקות בטווח). ענה ממנה והצע רק שעות שמופיעות כאן; get_available_slots / find_next_available רק לימים שאחרי או לבדיקה חוזרת:\n` +
    lines.join("\n") + (notes.length ? `\n(${notes.join("; ")})` : "");
}
