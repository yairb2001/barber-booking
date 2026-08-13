/**
 * Strip invisible Unicode bidi/formatting control characters before storing a
 * phone number typed or pasted into an admin form. Exact-match phone lookups
 * elsewhere in the codebase (e.g. matching a staff reply to a pending swap
 * approval) compare the stored value byte-for-byte against the webhook's
 * normalized incoming phone — a hidden character silently breaks that match.
 * Found 2026-08-13: 4 of 5 staff had a trailing U+202C (their phone was
 * copied from an RTL-aware contacts app), so their "כן"/"לא" replies to swap
 * approval requests never matched and fell through to the booking agent.
 */
export function sanitizePhoneInput(raw: string): string {
  return raw.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "").trim();
}

/** Normalize an Israeli phone to E.164 (972...) without '+' or leading zero. */
export function normalizeIsraeliPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  // Already international 972...
  if (digits.startsWith("972")) return digits;
  // Local 0XXXXXXXXX → drop leading 0, prepend 972
  if (digits.startsWith("0")) return "972" + digits.slice(1);
  // Without leading 0, 9 digits: assume missing leading 0
  if (digits.length === 9) return "972" + digits;
  return digits;
}

/** Green API chat id format: <E.164-no-plus>@c.us */
export function toGreenChatId(phone: string): string {
  return normalizeIsraeliPhone(phone) + "@c.us";
}

/**
 * Build a dialable `tel:` href from a stored phone. Numbers are stored as
 * "0XXXXXXXXX" or "972XXXXXXXXX" (E.164 WITHOUT the "+"). A phone dialer needs
 * the "+" on the country code — otherwise "972..." is dialed as a bogus local
 * number and the call fails. Local "0..." numbers already dial correctly.
 */
export function telHref(phone: string | null | undefined): string {
  const raw = (phone || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "tel:";
  if (raw.startsWith("+") || digits.startsWith("972")) return `tel:+${digits}`;
  return `tel:${digits}`;
}
