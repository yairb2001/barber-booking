/**
 * "The customer said yes to a slot we offered" (19.10.2026, the Michael case:
 * the agent offered 12:00/12:30/14:30, crashed, he answered "Yes" + "14:30",
 * nobody booked him, and next morning the follow-up nudge, which cannot book,
 * wrote "Can't wait to confirm you … at 14:30". He came for a booking that
 * never existed).
 *
 * Yair: a confirmation is always booked, then handed to a person, in every
 * business: when the reply went unanswered (the follow-up cron answers with
 * the real agent instead of a nudge), and when the month's agent package is
 * used up (the agent runs once for it).
 */

/** Text that never counts as an offer (our technical fallback). */
const NOT_AN_OFFER = /תקלה זמנית/;

const NEGATIVE = /(^|[\s,.!?])(לא|אין|בטל|תבטל|ביטול|אחר|no|not|nope|cancel|other)($|[\s,.!?])/i;
const AFFIRMATIVE = /^(כן|כ"ן|יאללה|סגור|סגורר|מעולה|מתאים|מתאים לי|אוקיי|אוקי|אוקיי סגור|בסדר|בטח|אחלה|תקבע|תקבעי|קבע|קבעי|שריין|תשריין|תשרייני|יס|yes|yep|yeah|yup|ok|okay|sure|perfect|great|sounds good|book it|👍|✅|🙏)/i;

const normTime = (h: string, m = "00") => `${h.padStart(2, "0")}:${m}`;

/** Times mentioned in a text ("14:30", "9:00"), normalized to HH:MM. */
export function timesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of Array.from(text.matchAll(/(^|[^\d])(\d{1,2}):(\d{2})(?!\d)/g))) out.add(normTime(m[2], m[3]));
  return Array.from(out);
}

/**
 * Does `customerText` confirm a slot from `offerContext` (what the agent wrote
 * just before)? A time that was offered ("14:30"), or a short yes after an
 * offer that named times. Anything negative, long or off-offer is not.
 */
export function looksLikeSlotConfirmation(offerContext: string, customerText: string): boolean {
  const offered = timesIn(offerContext);
  if (!offered.length) return false;
  const t = customerText.replace(/\s+/g, " ").trim();
  if (!t || t.length > 60 || NEGATIVE.test(t)) return false;
  // "2:30" said in the afternoon is 14:30.
  const withPm = (x: string) => { const h = Number(x.slice(0, 2)); return h >= 1 && h <= 9 ? [x, normTime(String(h + 12), x.slice(3))] : [x]; };
  const picked = timesIn(t);
  if (picked.length) return picked.flatMap(withPm).some(x => offered.includes(x));
  // A bare hour ("ב-4", "בשתיים" is not covered), never a date like 19.10 or 19/10.
  const bare = Array.from(t.matchAll(/(^|[^\d:./])(\d{1,2})(?![\d:./])/g)).map(m => Number(m[2])).filter(h => h >= 1 && h <= 23);
  if (bare.some(h => withPm(normTime(String(h))).some(x => offered.includes(x)))) return true;
  return AFFIRMATIVE.test(t);
}

type Msg = { role: string; content: string; createdAt: Date };

/**
 * The customer's unanswered run at the end of a chat (oldest first) and what
 * the agent offered within the two hours before it. Null when the chat ends on
 * our side.
 */
export function unansweredRun(chronological: Msg[]): { run: string; offerContext: string } | null {
  const tail: Msg[] = [];
  let i = chronological.length - 1;
  for (; i >= 0 && chronological[i].role === "user"; i--) tail.unshift(chronological[i]);
  if (!tail.length) return null;
  const since = tail[0].createdAt.getTime() - 2 * 3600_000;
  const offers: string[] = [];
  for (; i >= 0 && chronological[i].createdAt.getTime() >= since; i--) {
    const m = chronological[i];
    if (m.role === "assistant" && !NOT_AN_OFFER.test(m.content)) offers.unshift(m.content);
  }
  return { run: tail.map(m => m.content).join("\n"), offerContext: offers.join("\n") };
}

/** One customer run ("Yes\n14:30") is a confirmation if any line of it is. */
export function runConfirmsSlot(offerContext: string, run: string): boolean {
  const lines = run.split("\n").map(s => s.trim()).filter(Boolean);
  if (lines.some(l => NEGATIVE.test(l))) return false;
  return lines.some(l => looksLikeSlotConfirmation(offerContext, l));
}
