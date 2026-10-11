/**
 * "הודעה חשובה" popups in the booking flow (11.10.2026, Yair: "פופ-אפ פר ספר
 * ... והודעה כללית לכל הלקוחות ברגע שמגיעים למסך בחירת הספרים").
 *
 * Stored as settings.bookingNotice = { text, on } on the business (the general
 * one) and on each staff row (his own). Free text, shown as written. Pure
 * module: the public API, the settings screens and the popup share it.
 *
 * A barber's own text goes through the owner (Yair, 11.10.2026: "שזה יעבור
 * דרך המנהל"): it waits in settings.bookingNoticePending until the owner
 * approves it; customers keep seeing the approved one meanwhile.
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

export type Pending = Notice & { at: string };

export function readPending(settings: string | null | undefined): Pending | null {
  let s: Record<string, unknown> = {};
  try { s = settings ? JSON.parse(settings) : {}; } catch { return null; }
  const p = s.bookingNoticePending as Partial<Pending> | undefined;
  return p && typeof p.text === "string" ? { text: p.text, on: p.on === true, at: typeof p.at === "string" ? p.at : "" } : null;
}

/** Live notice (and, by default, no pending one left behind). */
export function withNotice(settings: string | null | undefined, notice: Notice, pending: Pending | null = null): string {
  let s: Record<string, unknown> = {};
  try { s = settings ? JSON.parse(settings) : {}; } catch { s = {}; }
  s.bookingNotice = notice;
  if (pending) s.bookingNoticePending = pending; else delete s.bookingNoticePending;
  return JSON.stringify(s);
}

/** Only a barber's proposal; the live notice stays as it is. */
export function withPending(settings: string | null | undefined, pending: Pending): string {
  let s: Record<string, unknown> = {};
  try { s = settings ? JSON.parse(settings) : {}; } catch { s = {}; }
  s.bookingNoticePending = pending;
  return JSON.stringify(s);
}
