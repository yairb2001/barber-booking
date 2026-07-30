/**
 * Shared constants + helpers for the public /for-business live agent demo.
 *
 * The demo talks to a REAL business record ("המספרה של דני") through the same
 * runCustomerAgent() the WhatsApp webhook uses — no fake/scripted responses.
 * That business has no GreenAPI credentials configured (greenApiInstanceId/
 * greenApiToken are null), so sendMessage()'s delivery attempt for every reply
 * fails gracefully with "provider_not_configured" (see deliverMessageLog) —
 * nothing ever actually leaves via WhatsApp. The demo route reads the reply
 * back from ConversationMessage instead of relying on that delivery.
 *
 * Anonymous, unauthenticated public traffic — no phone number required like
 * WhatsApp gives us for free — so every route using this module must rate-limit.
 */

/** "המספרה של דני" — a fully set up but otherwise unused demo business (2 staff,
 *  3 services, real weekly schedules, zero real customers/appointments). */
export const DEMO_BUSINESS_ID = "ad8d79ef-33ea-4230-9c19-2ed01f0f3a96";

/** Client-generated session id (e.g. crypto.randomUUID()), one per browser tab/
 *  visit. Validated strictly before use — it flows into a fake phone number and
 *  into Prisma queries, so only allow a safe, bounded character set. */
const SESSION_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

export function isValidSessionId(sessionId: unknown): sessionId is string {
  return typeof sessionId === "string" && SESSION_ID_RE.test(sessionId);
}

/**
 * Derive a stable, obviously-fake "phone" from a session id so the demo visitor
 * gets one continuous Conversation across messages, without ever colliding with
 * a real Israeli mobile number. Real mobiles are 972 5XXXXXXXX (972 + 9 digits
 * starting with 5); this always starts 9720, which no real mobile does.
 */
export function demoPhoneFor(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  const digits = String(hash).padStart(9, "0").slice(-9);
  return "9720" + digits.slice(0, 8);
}

// ── Rate limiting (in-memory, best-effort — same pattern as drip-queue's
//    module-level throttle timestamps; resets on cold start, which is fine for
//    abuse protection, not a security boundary) ──────────────────────────────
const MAX_MESSAGES_PER_WINDOW = 20;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const hitsByKey = new Map<string, number[]>();

/** True when `key` (session id, or IP as a fallback layer) is still under the
 *  rate limit. Records this call as a hit when it returns true. */
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const hits = (hitsByKey.get(key) ?? []).filter(t => now - t < WINDOW_MS);
  if (hits.length >= MAX_MESSAGES_PER_WINDOW) {
    hitsByKey.set(key, hits);
    return false;
  }
  hits.push(now);
  hitsByKey.set(key, hits);
  return true;
}

// Occasional cleanup so hitsByKey doesn't grow unbounded on a long-lived
// warm instance. Cheap: only runs a fraction of the time.
export function maybeCleanupRateLimitMap(): void {
  if (Math.random() > 0.01) return;
  const now = Date.now();
  for (const [key, hits] of Array.from(hitsByKey.entries())) {
    const fresh = hits.filter((t: number) => now - t < WINDOW_MS);
    if (fresh.length === 0) hitsByKey.delete(key);
    else hitsByKey.set(key, fresh);
  }
}

/** True when a reply to the sales pitch's name-ask reads as an explicit
 *  decline ("no thanks") rather than a name — so we don't capture "לא תודה"
 *  itself as someone's name. Deliberately narrow: anything not matching this
 *  is treated as a name, per the owner's low-friction design. */
const DECLINE_RE = /^\s*(לא[,.\s]|לא תודה|לא רוצה|לא מעוניין|לא כרגע|no\b|no thanks)/i;
export function looksLikeDecline(text: string): boolean {
  return DECLINE_RE.test(text.trim());
}
