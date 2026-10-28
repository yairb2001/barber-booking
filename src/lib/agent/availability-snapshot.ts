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
import { dayDistance } from "@/lib/day-distance";
import { buildAvailabilityIndex } from "@/lib/availability-index";
import { isNightWindow } from "@/lib/agent/night-window";
import { getBusinessNow, addDaysISO, getDayOfWeekISO, timeToMinutes } from "@/lib/utils";
import { parseAvailabilityAsk, focusLine } from "@/lib/agent/availability-focus";

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
/**
 * The services a customer named ("לק ג'ל ביום ראשון?" → "לק ג'ל ידיים"), best
 * match first: at least half the words of the name, each at a word start
 * (with up to two prefix letters: ו/ב/ל/ה/ש/מ/כ); a two-letter word must be
 * whole ("לק" is not inside "חלק"). Geresh ignored ("גל" = "ג'ל").
 */
export function namedServices(text: string, services: { id: string; name: string }[]): string[] {
  const norm = (x: string) => x.replace(/['׳’`"״]/g, "").toLowerCase();
  const t = norm(text);
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return services.map(sv => {
    const words = norm(sv.name).split(/[\s+/,()\-–]+/).filter(w => w.length >= 2);
    const hit = words.filter(w => new RegExp(`(^|[^א-תa-z0-9])[ובלהשמכ]{0,2}${esc(w)}${w.length <= 2 ? "(?![א-תa-z])" : ""}`).test(t)).length;
    return { id: sv.id, hit, score: words.length ? hit / words.length : 0 };
  }).filter(x => x.hit > 0 && x.score >= 0.5).sort((a, b) => b.score - a.score || b.hit - a.hit).map(x => x.id);
}

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export async function buildAvailabilitySnapshot(p: {
  businessId: string;
  /** Business vocabulary (ספר / ספרית / …) for the header; default = barber_men wording. */
  vocab?: { staff: string } | null;
  days?: number;
  serviceId?: string | null;
  regularStaffId?: string | null;
  /** short names by staff id (first name), to keep the block small */
  shortName?: (id: string, name: string) => string;
  /** The customer's message: a range/day/barber question gets a code-filtered line appended. */
  askText?: string | null;
  /** Barbers this customer is blocked from — shown as fully booked for him. */
  excludeStaffIds?: string[];
  /** Slots held for THIS customer (closure alternatives) stay free for him. */
  customerId?: string | null;
  /** …and the slot the agent is holding for this phone (his own proposal). */
  holderKey?: string | null;
  /** Beauty businesses: the treatment each person's times are for (28.10.2026); null = not shown (doesn't do what she asked). */
  serviceOf?: (staffId: string) => { id: string; name: string } | null;
}): Promise<string> {
  const days = p.days ?? 6;
  const today = getBusinessNow().date;
  const rawIndex = await buildAvailabilityIndex(p.businessId, today, days, { exemptHoldsCustomerId: p.customerId, exemptHoldsHolderKey: p.holderKey });
  const excluded = new Set(p.excludeStaffIds ?? []);
  // A nail tech has no times for a haircut: her line shows her own treatment
  // instead of "no room at all" (28.10.2026, "ביום ראשון אין לה מקום" while she
  // was free), and whoever doesn't do what she asked is left out.
  const own = (id: string) => p.serviceOf?.(id) ?? null;
  const svcFor = (id: string, svc: string | null) => own(id)?.id ?? svc;
  const index = excluded.size || p.serviceOf ? {
    ...rawIndex,
    staff: p.serviceOf ? rawIndex.staff.filter(s => own(s.id)) : rawIndex.staff,
    slots: (id: string, iso: string, svc: string | null) => excluded.has(id) ? [] : rawIndex.slots(id, iso, svcFor(id, svc)),
  } : rawIndex;
  const hasPool = index.staff.some(s => s.inQuickPool);
  const short = p.shortName ?? ((id, name) => name.trim().split(/\s+/)[0]);
  // Two barbers may share a first name (יאיר בוחבוט / יאיר הרוש) — disambiguate.
  const firsts = new Map<string, number>();
  for (const s of index.staff) firsts.set(short(s.id, s.name), (firsts.get(short(s.id, s.name)) ?? 0) + 1);
  const label = (s: { id: string; name: string }) => (firsts.get(short(s.id, s.name)) ?? 0) > 1 ? s.name : short(s.id, s.name);
  const other = (s: { id: string }) => { const o = own(s.id); return o && o.id !== p.serviceId ? ` (${o.name})` : ""; };

  const lines: string[] = [];
  for (let d = 0; d < days; d++) {
    const iso = addDaysISO(today, d);
    // "הבא" on next week's days — a customer offered "רביעי" on Thursday plans
    // for the wrong Wednesday otherwise (see day-distance.ts).
    const night = isNightWindow();
    const dayName = night && d <= 1 ? `${DAY[getDayOfWeekISO(iso)]} ${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}${d === 0 ? " (היום)" : ""}`
      : d === 0 ? "היום" : d === 1 ? "מחר" : `${DAY[getDayOfWeekISO(iso)]}${dayDistance(iso, today).isNext ? " הבא" : ""}`;
    const dd = new Date(iso + "T00:00:00.000Z");
    const parts: string[] = [];
    for (const s of index.staff) {
      const slots = index.slots(s.id, iso, p.serviceId ?? null);
      if (!slots.length) continue;
      parts.push(`${label(s)}${other(s)} ${compressSlots(slots)}`);
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
  // Code-filtered answer for "מחר אחרי 17:00" / "בערב השבוע" / "הכי מוקדם מחר" —
  // the model quotes it instead of scanning the list itself.
  let focus = "";
  if (p.askText) {
    const ask = parseAvailabilityAsk(p.askText, today, days, index.staff.map(s => ({ id: s.id, name: s.name })));
    if (ask) focus = "\n" + focusLine(index, ask, p.serviceId ?? null, label, today, days, p.regularStaffId);
  }
  const byTreatment = index.staff.some(s => other(s)) ? " שם בסוגריים = השעות לטיפול הזה; לטיפול אחר (משך אחר) → get_available_slots עם serviceId." : "";
  return `זמינות ל-${days} הימים הקרובים, לכל ${p.vocab?.staff ?? "ספר"}, נכון לרגע זה (אותו מקור כמו הכלים; רק השעות הכתובות כאן פנויות, וכל השעות הכתובות כאן פנויות).${byTreatment} ענה ממנה והצע רק שעות שמופיעות כאן; ביקש טווח ("אחרי 17:00", "בבוקר") → סנן מהרשימה המלאה של אותו יום; "הכי מאוחר"/"הכי מוקדם" = השעה האחרונה/הראשונה ברשימה של אותו יום; get_available_slots / find_next_available רק לימים שאחרי או לבדיקה חוזרת:\n` +
    lines.join("\n") + (notes.length ? `\n(${notes.join("; ")})` : "") + focus;
}
