/**
 * Default message templates for link-first mode. Kept in a standalone module
 * with NO server-only imports (no prisma) so BOTH the server sender
 * (src/lib/link-first.ts) and the client settings UI can import them.
 *
 * Placeholders (filled at send time):
 *   {{link}} — the business's public booking link
 *   {{name}} — the customer's first name (empty on cold first-contact)
 */
export const DEFAULT_GREETING_TEMPLATE =
`היי, כיף שפנית 🙂 הכי מהיר לתפוס תור דרך הקישור:
{{link}}
ואם נוח לך יותר, פשוט תכתוב לי כאן מתי בא לך ואני אקבע לך.`;

export const DEFAULT_NUDGE_TEMPLATE =
`היי, רק מוודא שתפסת תור. מתי נוח לך שאקבע לך? אפשר גם ישר דרך הקישור:
{{link}}`;

/** Default cooldown (days) before a returning contact is greeted again. */
export const DEFAULT_REGREET_DAYS = 3;
