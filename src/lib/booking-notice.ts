/**
 * "הודעה חשובה" popups in the booking flow (11.10.2026, Yair: "פופ-אפ פר ספר
 * ... והודעה כללית לכל הלקוחות ברגע שמגיעים למסך בחירת הספרים").
 *
 * Stored as settings.bookingNotice = { text, on } on the business (the general
 * one) and on each staff row (his own). Free text, shown as written. Pure
 * module: the public API, the settings screens and the popup share it.
 */
export type Notice = { text: string; on: boolean };
export const NOTICE_MAX = 600;

export function readNotice(settings: string | Record<string, unknown> | null | undefined): Notice {
  let s: Record<string, unknown> = {};
  if (typeof settings === "string") { try { s = JSON.parse(settings); } catch { /* empty */ } } else if (settings) s = settings;
  const n = (s.bookingNotice ?? {}) as Partial<Notice>;
  return { text: typeof n.text === "string" ? n.text : "", on: n.on === true };
}

/** What a customer sees: the text, or null when it's off or empty. */
export function shownNotice(settings: string | Record<string, unknown> | null | undefined): string | null {
  const n = readNotice(settings);
  return n.on && n.text.trim() ? n.text.trim() : null;
}

export function cleanNotice(input: unknown): Notice {
  const n = (input ?? {}) as Partial<Notice>;
  return { text: typeof n.text === "string" ? n.text.slice(0, NOTICE_MAX) : "", on: n.on === true };
}

export function withNotice(settings: string | null | undefined, notice: Notice): string {
  let s: Record<string, unknown> = {};
  try { s = settings ? JSON.parse(settings) : {}; } catch { s = {}; }
  s.bookingNotice = notice;
  return JSON.stringify(s);
}
