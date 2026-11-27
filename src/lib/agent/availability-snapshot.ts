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
import { hourInWords } from "@/lib/agent/mixed-messages";
import { staffFirst, staffShort } from "@/lib/agent/staff-label";

const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const BOOKING_CONTEXT = /תור|לקבוע|לקבע|פנוי|פנויה|פנויים|מקום|מחר|היום|השבוע|שבוע|יום |ביום|שעה|שעות|מתי|בוקר|צהריים|ערב|לילה|הכי קרוב|אצל|ספר|תספורת|זקן|מספריים|book|appointment|available|slot|tomorrow|today|week/i;

export function looksLikeBookingContext(texts: string[]): boolean {
  return texts.some(t => BOOKING_CONTEXT.test(t));
}

/** Explicit list ("13:00 · 13:30 · 14:00"), at most MAX_LISTED per barber-day.
 *  Ranges ("15:10–19:10 כל 30") were tried and misread by the model: on 21.9.2026
 *  it told a customer "nothing after 17:00" while 17:40–19:10 were free.
 *  The time after "עד" is the last START; the header says so (28.10.2026: it was
 *  read as closing time and a 75-minute facial taken off it again). */
const MAX_LISTED = 12;
type Window = { from: number; to: number };
export function compressSlots(slots: string[], win?: Window | null): string {
  if (!slots.length) return "";
  const mins = Array.from(new Set(slots.map(timeToMinutes))).sort((a, b) => a - b);
  // The part of the day he asked about is listed, not the first hours of the morning
  // (25.11.2026: "מחר בערב" got 17:00 from the only list that was not cut).
  const asked = win && mins.length > MAX_LISTED ? mins.filter(m => m >= win.from && m < win.to) : [];
  if (asked.length) {
    const shown = asked.slice(0, MAX_LISTED);
    return `${shown.map(fmt).join(" · ")} · ועוד ${mins.length - shown.length} שעות, מ-${fmt(mins[0])} עד ${fmt(mins[mins.length - 1])}`;
  }
  const shown = mins.slice(0, MAX_LISTED).map(fmt);
  const rest = mins.length - shown.length;
  return shown.join(" · ") + (rest > 0 ? ` · ועוד ${rest} עד ${fmt(mins[mins.length - 1])}${win === undefined ? "" : holesIn(mins)}` : "");
}

/** The break inside the hours that were cut ("חוץ מ-12:45 עד 16:00"): 14:00 was offered at a clinic closed from 13:00 (25.11.2026). */
function holesIn(mins: number[]): string {
  const holes = mins.slice(1).map((m, i) => [mins[i], m]).filter(([a, b], i) => b - a > 60 && i + 1 >= MAX_LISTED - 1);
  return holes.length ? `, בלי שום שעה בין ${holes.map(([a, b]) => `${fmt(a)} ל-${fmt(b)}`).join(", ובין ")}` : "";
}

/** The hour he picks, in minutes: "ב12", "17:20 אם יש", "1830", "אז 5", "4 ורבע", "שלוש ועשרה". Two readings of a bare hour
 *  (5 or 17): the one among the hours just offered, else among the day's. Null = no one hour. */
export function pickedHour(text: string, offered: number[], free: number[]): number | null {
  if (/אחרי|לפני|(?:^|\s)עד\s|החל|בסביבות|א[יז]+ור|בערך|במקום|יש לי|\d\s*(?:או|-|–)\s*\d/.test(text)) return null;
  const words = hourInWords(text.replace(/(?:^|\s)(\d{1,2})\s+ו(רבע|חצי|עשרה|עשרים)/, (_m, h: string, w: string) => ` ${HOUR_NAMES[Number(h) - 1] ?? h} ו${w}`));
  const m = words ? words.match(/(\d+):(\d+)/)
    : text.match(/(?:^|[^\d:./])(\d{1,2}):(\d{2})(?!\d)/) ?? text.match(/(?:^|[^\d:./])(\d{2})(\d{2})(?!\d)/)
    ?? text.match(/(?:^|\s)(?:ב|ל|בשעה |לשעה |אז )-?(\d{1,2})()(?![\d:./])/) ?? text.match(/(?:^|\n)\s*(\d{1,2})()\s*(?=[.,!?\n]|$)/);
  if (!m || Number(m[1]) > 23 || Number(m[2] || 0) > 59) return null;
  const at = Number(m[1]) * 60 + Number(m[2] || 0), both = Number(m[1]) < 12 && Number(m[1]) > 0 ? [at, at + 720] : [at];
  return both.find(x => offered.includes(x)) ?? both.find(x => free.includes(x)) ?? (Number(m[1]) >= 1 && Number(m[1]) <= 7 ? at + 720 : at);
}
const HOUR_NAMES = ["אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע", "עשר", "אחת עשרה", "שתים עשרה"];

/** "ב-16:30", "בשעה 12:00", "ב5" → minutes; a bare 1–7 is the afternoon. */
function namedHour(text: string): number | null {
  const m = text.match(/(?:^|[^\d:./])(\d{1,2}):(\d{2})(?!\d)/) ?? text.match(/(?:^|\s)(?:ב|ל|בשעה |לשעה )-?(\d{1,2})()(?![\d:./])/);
  if (!m || Number(m[1]) > 23) return null;
  const h = Number(m[1]);
  return (h >= 1 && h <= 7 ? h + 12 : h) * 60 + Number(m[2] || 0);
}

/** The hours the customer's last messages are about ("בערב", "אחרי 17:00", "ב-16:30"); the newest wins. */
export function askedWindow(texts: string[], today: string): Window | null {
  for (const raw of texts) {
    const t = raw.replace(/["״]/g, "");
    const ask = parseAvailabilityAsk(t, today, 6);
    if (ask && (ask.from !== undefined || ask.to !== undefined)) return { from: ask.from ?? 0, to: ask.to ?? 24 * 60 };
    const at = namedHour(t);
    if (at !== null) return { from: at - 60, to: at + 150 };
  }
  return null;
}

/** Opens the note of who works which weekdays; reply-guards reads it back (workDaysIn). */
const WORK_DAYS = "ימי עבודה קבועים:";
export function workDaysIn(context: string): { name: string; days: string[] }[] {
  const line = context.split(WORK_DAYS)[1]?.split(" (יום אחר")[0];
  return (line ?? "").split("|").map(x => x.trim()).filter(Boolean).map(x => {
    const days = DAY.filter(d => x.includes(d));
    return { name: x.slice(0, x.indexOf(days[0] ?? "")).trim(), days };
  }).filter(x => x.name && x.days.length);
}

/**
 * The services a customer named ("לק ג'ל ביום ראשון?" → "לק ג'ל ידיים"), best
 * match first: at least half the words of the name, each at a word start
 * (with up to two prefix letters: ו/ב/ל/ה/ש/מ/כ); a two-letter word must be
 * whole ("לק" is not inside "חלק"). Geresh ignored ("גל" = "ג'ל"). A partial
 * match whose words a full match already explains is dropped ("תספורת וזקן"
 * is "תספורת + זקן", not also "תספורת נשים").
 */
export function namedServices(text: string, services: { id: string; name: string }[]): string[] {
  return matchServices(text, services).map(x => x.id);
}

/**
 * Of those, only what the text names beyond doubt: every word of the name, or
 * the one and only candidate. "תספורת גבר" half-fits both "תספורת גברים" and
 * "תספורת נשים", so it names neither (a man got the link to women's haircuts, 25.11.2026).
 */
export function clearlyNamedServices(text: string, services: { id: string; name: string }[]): string[] {
  const found = matchServices(text, services);
  return found.filter(x => x.score === 1 || found.length === 1).map(x => x.id);
}

function matchServices(text: string, services: { id: string; name: string }[]): { id: string; hits: string[]; score: number }[] {
  const norm = (x: string) => x.replace(/['׳’`"״]/g, "").toLowerCase();
  // "תספורת בלי זקן", "תספורת ולא פן": what he does not want is not a treatment he named.
  const t = norm(text).replace(/(^|\s)(?:בלי|ו?לא)\s+\S+/g, " ");
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = services.map(sv => {
    const words = norm(sv.name).split(/[\s+/,()\-–]+/).filter(w => w.length >= 2);
    const hits = words.filter(w => new RegExp(`(^|[^א-תa-z0-9])[ובלהשמכ]{0,2}${esc(w)}${w.length <= 2 ? "(?![א-תa-z])" : ""}`).test(t));
    return { id: sv.id, hits, score: words.length ? hits.length / words.length : 0 };
  }).filter(x => x.hits.length && x.score >= 0.5);
  const covered = new Set(found.filter(x => x.score === 1).flatMap(x => x.hits));
  return found.filter(x => x.score === 1 || x.hits.some(w => !covered.has(w)))
    .sort((a, b) => b.score - a.score || b.hits.length - a.hits.length);
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
  /** The customer's last messages, newest first: their part of the day is listed in full,
   *  and who is off on which day is said (25.11.2026). Null = as before. */
  asks?: string[] | null;
  /** The day the conversation is about (talked-day.ts) and the agent's last message: a bare hour is checked against them. */
  talked?: string[]; lastReply?: string;
  /** Set when he has not named a treatment: what each person does, to say an hour fits a shorter one. */
  servicesOf?: (staffId: string) => { id: string; name: string }[];
  /** Nobody asked for by name and the business assigns by itself: the asked day's hours of everyone together. */
  silentAssign?: boolean;
  /** The hour he asked for is free (or free for a shorter treatment), with the line that says so: a reply that denies it is replaced (27.11.2026). */
  onFreeHour?: (hour: string, line: string) => void;
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
  const short = p.shortName ?? ((_id, name) => staffShort(name));
  // Two barbers may share a first name (יאיר בוחבוט / יאיר הרוש) — disambiguate.
  const firsts = new Map<string, number>();
  for (const s of index.staff) firsts.set(short(s.id, s.name), (firsts.get(short(s.id, s.name)) ?? 0) + 1);
  const label = (s: { id: string; name: string }) => (firsts.get(short(s.id, s.name)) ?? 0) > 1 ? s.name : short(s.id, s.name);
  const other = (s: { id: string }) => { const o = own(s.id); return o && o.id !== p.serviceId ? ` (${o.name})` : ""; };

  const win = p.asks ? askedWindow(p.asks, today) : null;
  const lines: string[] = [], inList: string[] = [], dayNames: string[] = [];
  for (let d = 0; d < days; d++) {
    const iso = addDaysISO(today, d);
    // "הבא" on next week's days — a customer offered "רביעי" on Thursday plans
    // for the wrong Wednesday otherwise (see day-distance.ts).
    const night = isNightWindow();
    const dayName = night && d <= 1 ? `${DAY[getDayOfWeekISO(iso)]} ${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}${d === 0 ? " (היום)" : ""}`
      // The weekday too: "ביום חמישי" on a Wednesday met "מחר 5.11" and the model
      // answered that Thursday was full (demo, 4.11.2026).
      : d <= 1 ? `${d === 0 ? "היום" : "מחר"} ${DAY[getDayOfWeekISO(iso)]}` : `${DAY[getDayOfWeekISO(iso)]}${dayDistance(iso, today).isNext ? " הבא" : ""}`;
    const dd = new Date(iso + "T00:00:00.000Z");
    inList.push(iso); dayNames.push(dayName);
    const parts: string[] = [];
    for (const s of index.staff) {
      const slots = index.slots(s.id, iso, p.serviceId ?? null);
      if (!slots.length) continue;
      parts.push(`${label(s)}${other(s)} ${compressSlots(slots, p.asks ? win : undefined)}`);
    }
    lines.push(`${dayName} ${dd.getUTCDate()}.${dd.getUTCMonth() + 1}: ${parts.length ? parts.join(" | ") : "אין"}`);
  }
  /** One day asked about: who is free at the hour he named, or everyone's hours in the part of the day he named
   *  (25.11.2026: "מחר בערב" got one barber's single hour while two others were free). */
  const askedHours = (text: string): string => (p.talked?.length ? p.talked : [null]).map(d => askedHoursOn(text, d)).join("");
  const askedHoursOn = (text: string, talkedDay: string | null): string => {
    const ask = parseAvailabilityAsk(text, today, days, index.staff.map(s => ({ id: s.id, name: s.name })));
    const day = talkedDay ?? (ask && ask.days.length === 1 ? ask.days[0] : null);
    if (ask?.pick || !day || !inList.includes(day)) return "";
    // Named in this message or just before it ("אצל רז" then "ב-17:00"); a two-letter name counts too.
    const said = (p.asks ?? []).join("\n");
    const named = index.staff.filter(s => new RegExp(`(^|[^א-ת])[לבש]?${staffFirst(s.name)}(?![א-ת])`).test(said));
    const staff = named.length ? named : index.staff.filter(s => !hasPool || s.inQuickPool || s.id === p.regularStaffId);
    const free = (s: { id: string }) => index.slots(s.id, day, p.serviceId ?? null);
    const everyone = Array.from(new Set(staff.flatMap(free).map(timeToMinutes))).sort((a, b) => a - b);
    const offered = Array.from((p.lastReply ?? "").matchAll(/(\d{1,2}):(\d{2})/g)).map(m => Number(m[1]) * 60 + Number(m[2]));
    const hour = ask?.from === undefined && ask?.to === undefined ? pickedHour(text, offered, everyone) : null;
    const dayLabel = ask && ask.days.length === 1 && ask.days[0] === day ? ask.dayLabel : `ב${dayNames[inList.indexOf(day)]} ${Number(day.slice(8))}.${Number(day.slice(5, 7))}`;
    if (hour !== null) {
      const at = staff.filter(s => free(s).some(t => timeToMinutes(t) === hour));
      if (!at.length) {
        const near = [...everyone].sort((a, b) => Math.abs(a - hour) - Math.abs(b - hour)).slice(0, 3).sort((a, b) => a - b).map(fmt);
        const fits = Array.from(new Set(staff.flatMap(s => (p.servicesOf?.(s.id) ?? []).filter(x => rawIndex.slots(s.id, day, x.id).some(t => timeToMinutes(t) === hour)).map(x => x.name))));
        if (fits.length) p.onFreeHour?.(fmt(hour), `ב-${fmt(hour)} ${dayLabel} יש מקום${named.length ? ` אצל ${named.map(label).join(", ")}` : ""} ל${fits.join(" או ל")}. לקבוע לך?${near.length ? ` (לטיפול ארוך יותר הכי קרוב ${near.join(", ")})` : ""}`);
        if (fits.length) return `\nב-${fmt(hour)} ${dayLabel} נכנס רק: ${fits.join(" / ")} (לא נאמר איזה טיפול). אל תאמר שהשעה לא פנויה: הצע אותה לטיפול הזה ושאל אם זה הטיפול.`;
        return near.length ? `\n${fmt(hour)} ${dayLabel} אי אפשר להתחיל${named.length ? ` אצל ${named.map(label).join(", ")}` : ""} לטיפול הזה. הקרובות: ${near.join(", ")}. אמור שהשעה לא פנויה (לא "תפוס" ולא "נתפס") ותן אותן. טיפול אחר → get_available_slots עם ה-serviceId שלו.` : "";
      }
      // He named nobody and the business assigns by itself: one name, so there is nothing to ask.
      const one = !named.length && p.silentAssign ? at.find(s => s.id === p.regularStaffId) ?? index.staffByLoad(day).map(x => at.find(s => s.id === x.id)).find(x => !!x) ?? at[0] : null;
      p.onFreeHour?.(fmt(hour), `ב-${fmt(hour)} ${dayLabel} יש מקום אצל ${(one ? [one] : at).map(label).join(" או אצל ")}. לקבוע לך?`);
      return `\nב-${fmt(hour)} ${dayLabel} פנוי אצל ${(one ? [one] : at).map(label).join(", ")} → propose_booking לשעה הזו${one ? ", בלי לשאול אצל מי" : ""}.`;
    }
    if (!ask || ask.days.length !== 1 || ask.days[0] !== day || (ask.from === undefined && ask.to === undefined) || !p.silentAssign || named.length || p.regularStaffId || staff.length < 2) return "";
    const all = Array.from(new Set(staff.flatMap(free))).filter(t => timeToMinutes(t) >= (ask.from ?? 0) && timeToMinutes(t) < (ask.to ?? 24 * 60)).sort();
    if (!all.length) return "";
    const answer = all.length > 3 ? `${all.slice(0, 3).join(", ")} ויש עוד עד ${all[all.length - 1]}` : all.join(", ");
    return `\nהתשובה לשאלה שלו, אצל כולם יחד: ${ask.dayLabel} ${ask.rangeLabel ?? ""} יש ${answer}. כתוב אותה בלי שמות, בלי "רק אצל" ובלי לשאול אצל מי (לא ביקשו מישהו בשם); הקביעה אצל מי שהשעה בשורה שלו.`;
  };
  const notes: string[] = [];
  // Barbers with nothing free in the whole window are named explicitly — otherwise
  // the model "double-checks" them day by day (owner's replay, 20.9.2026).
  const fullyBooked = index.staff.filter(s => !Array.from({ length: days }, (_, d) => addDaysISO(today, d)).some(iso => index.slots(s.id, iso, p.serviceId ?? null).length));
  if (fullyBooked.length) notes.push(`אין שום מקום ב-${days} הימים האלה אצל: ${fullyBooked.map(label).join(", ")} — אל תבדוק אותם יום-יום; רוצה אותם → find_next_available עם ה-staffId שלהם`);
  if (hasPool) {
    const outside = index.staff.filter(s => !s.inQuickPool).map(label);
    if (outside.length) notes.push(`${outside.join(", ")} — רק אם הלקוח מבקש אותו בשמו או שהוא הקבוע שלו`);
  }
  // Off that day is not "full": no "אין לו מקום", and no waitlist for a day he never opens. The regular week and
  // not only these days: a list of these days' offs was read as "she doesn't work Tuesdays" (25.11.2026).
  if (p.asks) {
    const open = new Set(index.staff.flatMap(s => index.weekDays(s.id)));
    // No regular week at all (opened day by day) says nothing about his days.
    const partWeek = index.staff.filter(s => { const n = index.weekDays(s.id).length; return n > 0 && (n < open.size || index.staff.length <= 8); });
    if (partWeek.length) notes.push(`${WORK_DAYS} ${partWeek.map(s => `${label(s)} ${index.weekDays(s.id).map(d => DAY[d]).join(", ")}`).join(" | ")} (יום אחר = לא עובדים בו, לא "מלא", ובלי רשימת המתנה ליום כזה)`);
    // A weekday past the list is not a day off ("רותם לא עובדת בימי שלישי", 25.11.2026: Tuesday was day 7).
    const past = addDaysISO(today, days), pastDay = DAY[getDayOfWeekISO(past)];
    notes.push("השעה אחרי \"עד\" היא ההתחלה האחרונה, לא שעת סגירה; היום כבר אין שעות = נגמרו להיום, לא \"לא עובדים ביום הזה\"");
    if (p.asks[0]?.includes(pastDay)) notes.push(`יום ${pastDay} ${Number(past.slice(8, 10))}.${Number(past.slice(5, 7))} לא ברשימה הזו (היא של ${days} ימים): get_available_slots לפני שעונים עליו`);
  }
  if (p.regularStaffId) { const r = index.staff.find(s => s.id === p.regularStaffId); if (r) notes.push(`הקבוע של הלקוח: ${label(r)}`); }
  // Code-filtered answer for "מחר אחרי 17:00" / "בערב השבוע" / "הכי מוקדם מחר" —
  // the model quotes it instead of scanning the list itself.
  let focus = "";
  if (p.askText) {
    const ask = parseAvailabilityAsk(p.askText, today, days, index.staff.map(s => ({ id: s.id, name: s.name })));
    if (ask) focus = "\n" + focusLine(index, ask, p.serviceId ?? null, label, today, days, p.regularStaffId);
  }
  if (p.asks?.length) focus += askedHours(p.asks[0]);
  const byTreatment = (index.staff.some(s => other(s)) ? " שם בסוגריים = השעות לטיפול הזה; לטיפול אחר (משך אחר) → get_available_slots עם serviceId." : "") +
    (index.staff.length < rawIndex.staff.length ? " מופיעים רק מי שעושים את מה שהלקוח ביקש; מי שלא מופיע לא עושה אותו (זה לא אומר שאין לו מקום)." : "");
  return `זמינות ל-${days} הימים הקרובים, לכל ${p.vocab?.staff ?? "ספר"}, נכון לרגע זה (אותו מקור כמו הכלים; רק השעות הכתובות כאן פנויות, וכל השעות הכתובות כאן פנויות).${byTreatment} ענה ממנה והצע רק שעות שמופיעות כאן; ביקש טווח ("אחרי 17:00", "בבוקר") → סנן מהרשימה המלאה של אותו יום; "הכי מאוחר"/"הכי מוקדם" = השעה האחרונה/הראשונה ברשימה של אותו יום ("ועוד 8 עד 18:30" = עוד 8 שעות התחלה שלא נכתבו, האחרונה ב-18:30; ביקש שעה בטווח הזה שלא כתובה → get_available_slots, לא "אין"); get_available_slots / find_next_available רק לימים שאחרי או לבדיקה חוזרת:\n` +
    lines.join("\n") + (notes.length ? `\n(${notes.join("; ")})` : "") + focus;
}
