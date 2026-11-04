/**
 * The works page (4.11.2026, Yair: "מי שמבקש גוונים, לשלוח לה קישור לעבודות
 * שלנו על גוונים"): /<slug>/works, a tab per treatment. Shared by the page and
 * the agent (src/lib/works.ts).
 */

/** ?s= on the works link: the start of the treatment's id, short in WhatsApp. */
export const worksKey = (serviceId: string) => serviceId.slice(0, 8);

/** "כזה אני רוצה" on a photo opens WhatsApp with this text, then the photo's name and link. */
export const WANT_PHOTO = "אני רוצה כמו בתמונה:";
