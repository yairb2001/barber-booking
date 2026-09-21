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
 * turn): slots are listed explicitly ("13:00 · 13:30"), closed
 * days are one word, and the block is only injected in booking contexts.
 */
import { buildAvailabilityIndex } from "@/lib/availability-index";
import { getBusinessNow, addDaysISO, getDayOfWeekISO, timeToMinutes } from "@/lib/utils";

const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const BOOKING_CONTEXT = /תור|לקבוע|לקבע|פנוי|פנויה|פנויים|מקום|מחר|היום|השבוע|שבוע|יום |ביום|שעה|שעות|מתי|בוקר|צהריים|ערב|לילה|הכי קרוב|אצל|ספר|תספורת|זקן|מספריים|book|appointment|available|slot|tomorrow|today|week/i;

export function looksLikeBookingContext(texts: string[]): boolean {
  return texts.some(t => BOOKING_CONTEXT.test(t));
}

/** Explicit list ("13:00 · 13:30 · 14:00"), at most MAX_LISTED per barber-day.
 *  Ranges ("15:10–19:10 כל 30") were tried and misread by the model: on 21.9.2026
 *  it told a customer "nothing after 17:00" while 17:40–19:10 were free. */
const MAX_LISTED = 12;
export function compressSlots(slots: string[]): string {
  if (!slots.length) return "";
  const mins = Array.from(new Set(slots.map(timeToMinutes))).sort((a, b) => a - b);
  const shown = mins.slice(0, MAX_LISTED).map(fmt);
  const rest = mins.length - shown.length;
  return shown.join(" · ") + (rest > 0 ? ` · ועוד ${rest} עד ${fmt(mins[mins.length - 1])}` : "");
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
  return `זמינות ל-${days} הימים הקרובים, לכל ספר, נכון לרגע זה (אותו מקור כמו הכלים; רק השעות הכתובות כאן פנויות). ענה ממנה והצע רק שעות שמופיעות כאן; get_available_slots / find_next_available רק לימים שאחרי או לבדיקה חוזרת:\n` +
    lines.join("\n") + (notes.length ? `\n(${notes.join("; ")})` : "");
}
