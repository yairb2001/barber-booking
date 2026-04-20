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
