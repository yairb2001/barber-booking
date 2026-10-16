import { freeStarts, plainShape, LEGACY_GRID, type Grid, type Shape } from "@/lib/availability/engine";
import { bookedBusy, type BookedRow } from "@/lib/availability/shape";

// Parse time string "HH:MM" to minutes since midnight
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Convert minutes since midnight to "HH:MM"
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

// Get available time slots for a staff member on a given date. The rule lives
// in the availability engine (src/lib/availability/engine.ts, legacyGenerate):
// step by the duration, and after a break or a booking re-anchor to its end —
// a 40-min appointment ending at 10:40 opens the next slot at 10:40, not 11:00.
// Stage B: `duration` may be a treatment's shape (processing, cleaning), a
// booked row may carry the busy parts it recorded, and a business may use a
// fixed grid (src/lib/availability/shape.ts gridOf). A plain length on the
// legacy grid is exactly the rule above.
export function generateSlots(
  scheduleSlots: { start: string; end: string }[],
  breaks: { start: string; end: string }[] | null,
  duration: number | Shape,
  bookedSlots: BookedRow[],
  grid: Grid = LEGACY_GRID,
): string[] {
  const blockers = [
    ...(breaks || []).map((b) => ({ s: timeToMinutes(b.start), e: timeToMinutes(b.end) })),
    ...bookedSlots.flatMap(bookedBusy),
  ];
  const windows = scheduleSlots.map((w) => ({ s: timeToMinutes(w.start), e: timeToMinutes(w.end) }));
  // "A day with no booking yet" counts bookings only — a fixed lunch break doesn't make a day busy.
  return freeStarts(windows, blockers, typeof duration === "number" ? plainShape(duration) : duration, grid, { hasBookings: bookedSlots.length > 0 }).map(minutesToTime);
}

// Format date to YYYY-MM-DD
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

// Get day of week (0=Sunday) from date
export function getDayOfWeek(date: Date): number {
  return date.getDay();
}

// ── Business timezone helpers ─────────────────────────────────────────────────
// The business is in Israel; these helpers ensure that "now" is always in
// Asia/Jerusalem regardless of where the Node process runs (Vercel = UTC).
export const BUSINESS_TIMEZONE = "Asia/Jerusalem";

/**
 * Returns today's date + current time in the business timezone (Asia/Jerusalem).
 * { date: "YYYY-MM-DD", time: "HH:MM", minutes: number since midnight }
 *
 * Uses formatToParts() to extract individual fields — immune to locale-specific
 * separator characters (e.g. Node 18+ ICU changed sv-SE to use narrow no-break
 * space U+202F instead of regular space, which broke a simple `.split(" ")`).
 */
export function getBusinessNow(): { date: string; time: string; minutes: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", // explicit 24-hour (00-23); avoids hour12:false "24" midnight bug
  }).formatToParts(now);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hhmm = `${get("hour")}:${get("minute")}`;
  return { date, time: hhmm, minutes: timeToMinutes(hhmm) };
}

/**
 * Israel UTC offset (in minutes, e.g. +180 for IDT summer, +120 for IST winter)
 * at a given absolute instant. Computed from the IANA tz database via Intl, so
 * DST transitions are always correct without hard-coding dates.
 */
export function israelOffsetMinutesAt(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asIfUtc - at.getTime()) / 60_000);
}

/**
 * Convert an appointment's stored fields to its absolute instant (UTC Date).
 *
 * In this codebase `appointment.date` is UTC-midnight of the Israel CALENDAR day
 * and `appointment.startTime` is the Israel-local wall-clock "HH:MM". This turns
 * that pair into the true moment the appointment happens, correctly accounting
 * for the Israel DST offset on that date.
 */
export function appointmentInstant(dateUtcMidnight: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const y = dateUtcMidnight.getUTCFullYear();
  const mo = dateUtcMidnight.getUTCMonth();
  const d = dateUtcMidnight.getUTCDate();
  // Guess: interpret the wall time as if it were UTC, then shift by the Israel
  // offset at that moment so the result is the real UTC instant.
  const guessUtcMs = Date.UTC(y, mo, d, h || 0, m || 0, 0);
  const offsetMin = israelOffsetMinutesAt(new Date(guessUtcMs));
  return new Date(guessUtcMs - offsetMin * 60_000);
}

/** Add n days to a YYYY-MM-DD string (UTC-safe). */
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

/** Day of week (0=Sunday) from a YYYY-MM-DD string (UTC-safe). */
export function getDayOfWeekISO(iso: string): number {
  return new Date(iso + "T00:00:00.000Z").getUTCDay();
}

/**
 * YYYY-MM-DD of a Date in the BROWSER'S local calendar (getFullYear/getMonth/
 * getDate) — never via toISOString(), which converts to UTC and, in Israel
 * (UTC+2/+3), turns local midnight into the previous day.
 */
export function localISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
