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

// Get available time slots for a staff member on a given date
export function generateSlots(
  scheduleSlots: { start: string; end: string }[],
  breaks: { start: string; end: string }[] | null,
  durationMinutes: number,
  bookedSlots: { startTime: string; endTime: string }[]
): string[] {
  const available: string[] = [];

  for (const slot of scheduleSlots) {
    let current = timeToMinutes(slot.start);
    const slotEnd = timeToMinutes(slot.end);

    while (current + durationMinutes <= slotEnd) {
      const slotStart = minutesToTime(current);
      const slotEndTime = minutesToTime(current + durationMinutes);

      // Check if in break
      const inBreak = (breaks || []).some((b) => {
        const bStart = timeToMinutes(b.start);
        const bEnd = timeToMinutes(b.end);
        return current < bEnd && current + durationMinutes > bStart;
      });

      // Check if overlaps with booked appointment
      const isBooked = bookedSlots.some((b) => {
        const bStart = timeToMinutes(b.startTime);
        const bEnd = timeToMinutes(b.endTime);
        return current < bEnd && current + durationMinutes > bStart;
      });

      if (!inBreak && !isBooked) {
        available.push(slotStart);
      }

      current += durationMinutes; // interval = service duration
    }
  }

  return available;
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
 */
export function getBusinessNow(): { date: string; time: string; minutes: number } {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.format(new Date()); // e.g. "2026-04-23 14:30"
  const [datePart, timePart] = parts.split(" ");
  const hhmm = timePart.slice(0, 5);
  return { date: datePart, time: hhmm, minutes: timeToMinutes(hhmm) };
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
