/**
 * Deterministic follow-up for an unanswered FINAL CONFIRMATION.
 *
 * The agent's closing question has a fixed shape ("רגע לפני שאני קובע לך את
 * זה סופית — <service> ביום <weekday> <d.m> בשעה <HH:MM> מאשר?"). When the
 * customer goes quiet on it, a generic "still waiting for your answer" is
 * wrong twice: it doesn't say the appointment is NOT booked yet, and the slot
 * may already be gone. So: parse date + time, check the live calendar, and
 * write the exact right sentence — no model call.
 *
 * Returns null when the last agent message is not a final confirmation.
 */
import { prisma } from "@/lib/prisma";
import { computeDayAvailability } from "@/lib/agent/availability";
import { getBusinessNow, timeToMinutes } from "@/lib/utils";

const HEB_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function parseFinalConfirm(text: string, todayISO: string): { dateISO: string; time: string } | null {
  if (!/מאשר\s*\??\s*$/.test(text.trim())) return null;
  const dm = text.match(/\b(\d{1,2})\.(\d{1,2})\b/);
  const hm = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!dm || !hm) return null;
  const year = Number(todayISO.slice(0, 4));
  const mk = (y: number) => `${y}-${String(dm[2]).padStart(2, "0")}-${String(dm[1]).padStart(2, "0")}`;
  // Same year unless the date is more than ~60 days behind us (then it was a
  // December→January talk). A date a few days back is simply a slot that passed.
  const thisYear = mk(year);
  const daysBehind = (new Date(todayISO + "T00:00:00Z").getTime() - new Date(thisYear + "T00:00:00Z").getTime()) / 86_400_000;
  const dateISO = daysBehind > 60 ? mk(year + 1) : thisYear;
  return { dateISO, time: `${String(hm[1]).padStart(2, "0")}:${hm[2]}` };
}

/** Staff ids whose slot list in the last availability tool result contained the time. */
function staffFromToolResult(toolText: string | null, time: string): string[] {
  if (!toolText) return [];
  const out: string[] = [];
  // "<name> [id: <uuid>]: 11:00, 11:30, ..." per barber, possibly on one line.
  const re = /\[id:\s*([0-9a-f-]{36})\]:\s*([0-9:,\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(toolText))) { if (m[2].split(/[,\s]+/).includes(time)) out.push(m[1]); }
  return out;
}

export async function buildConfirmFollowup(opts: {
  businessId: string; conversationId: string; lastAgentText: string; name: string | null;
}): Promise<string | null> {
  const { date: todayISO, minutes: nowMin } = getBusinessNow();
  const parsed = parseFinalConfirm(opts.lastAgentText, todayISO);
  if (!parsed) return null;
  const { dateISO, time } = parsed;
  const hi = opts.name ? `${opts.name}, ` : "";
  const dayName = `יום ${HEB_DAYS[new Date(dateISO + "T00:00:00Z").getUTCDay()]}`;

  // Slot already in the past → nothing sensible to confirm; offer to re-find.
  if (dateISO < todayISO || (dateISO === todayISO && timeToMinutes(time) <= nowMin)) {
    return `${hi}שים לב שהתור ל${dayName} בשעה ${time} לא נקבע בסוף (לא אישרת בזמן) והשעה כבר עברה. רוצה שאמצא לך שעה אחרת?`;
  }

  // Which barber was it? The last availability tool result lists who had that time.
  const lastTool = await prisma.conversationMessage.findFirst({
    where: { conversationId: opts.conversationId, role: "tool" }, orderBy: { createdAt: "desc" }, select: { content: true },
  });
  const candidates = staffFromToolResult(lastTool?.content ?? null, time);
  const avail = await computeDayAvailability(opts.businessId, dateISO);
  const rows = candidates.length ? avail.filter(r => candidates.includes(r.staffId)) : avail;
  const stillFree = rows.some(r => r.slots.includes(time));

  if (stillFree) {
    return `${hi}שים לב שהתור ל${dayName} בשעה ${time} עדיין לא נקבע — רק תגיד "מאשר" ואני סוגר לך אותו.`;
  }

  // Taken meanwhile → the closest times that day (same barber(s) first, then anyone).
  const want = timeToMinutes(time);
  const pool = (rows.length ? rows : avail).flatMap(r => r.slots).filter((t, i, a) => a.indexOf(t) === i);
  const nearest = pool.sort((a, b) => Math.abs(timeToMinutes(a) - want) - Math.abs(timeToMinutes(b) - want)).slice(0, 2).sort();
  if (nearest.length) {
    const opts2 = nearest.length === 2 ? `${nearest[0]} או ${nearest[1]}` : nearest[0];
    return `${hi}לא הספקנו לסגור והשעה ${time} ב${dayName} נתפסה בינתיים. הכי קרוב שיש באותו יום: ${opts2} — לסגור לך?`;
  }
  return `${hi}לא הספקנו לסגור והשעה ${time} ב${dayName} נתפסה בינתיים, וכבר אין פנוי באותו יום. רוצה שאמצא לך יום אחר?`;
}
