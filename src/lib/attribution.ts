// Marketing attribution — captured from the booking-link URL on the client.
//
// When a visitor lands on any /book page with tracking params (?ref=... or the
// standard ?utm_source/utm_campaign/utm_content), we stash them in localStorage
// so the attribution "follows" them: they can click an ad today and only book a
// few days later (arriving without the params) and still be credited.
//
// First-touch: the EARLIEST attribution within the TTL wins — it answers
// "where did this customer originally come from", so a later click doesn't
// overwrite the original source.

export type Attribution = {
  ref?: string;       // manual tag for non-ad links (?ref=שלט-בחנות)
  source?: string;    // utm_source   — platform (meta | google | ...)
  medium?: string;    // utm_medium   — paid | organic | ...
  campaign?: string;  // utm_campaign — campaign name (Meta fills automatically)
  content?: string;   // utm_content  — the specific ad name
  fbclid?: string;    // מזהה הלחיצה של מטא (28.10.2026)
  ts: number;         // capture timestamp (for TTL)
};

const KEY = "bk_attr";
/** הביקור האחרון שהגיע עם מקור (28.10.2026): הוא נשמר על התור, והראשון נשאר על הלקוח. */
const LAST_KEY = "bk_attr_last";
const LAST_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * Read tracking params from the current URL and persist them (first-touch).
 * Safe to call on every /book mount — it no-ops when there's nothing to capture
 * or when a valid attribution is already stored.
 */
export function captureAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    const p = new URLSearchParams(window.location.search);
    const pick = (k: string) => {
      const v = p.get(k);
      return v && v.trim() ? v.trim().slice(0, 120) : undefined;
    };
    const incoming = {
      ref:      pick("ref"),
      source:   pick("utm_source"),
      medium:   pick("utm_medium"),
      campaign: pick("utm_campaign"),
      content:  pick("utm_content"),
      fbclid:   pick("fbclid"),
    };
    if (!Object.values(incoming).some(Boolean)) return; // no tracking params

    // הביקור האחרון: תמיד מתעדכן, כדי שהתור יירשם על הלחיצה שהביאה אותו.
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...incoming, ts: Date.now() }));

    // First-touch: keep the earliest valid attribution.
    if (getStoredAttribution()) return;

    localStorage.setItem(KEY, JSON.stringify({ ...incoming, ts: Date.now() }));
  } catch {
    /* localStorage blocked / private mode — silently skip */
  }
}

/** Returns the stored attribution if present and still within the TTL. */
export function getStoredAttribution(): Attribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Attribution;
    if (!a || typeof a.ts !== "number" || Date.now() - a.ts > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return a;
  } catch {
    return null;
  }
}

/**
 * המקור שנשמר על התור (28.10.2026): הביקור האחרון שהגיע עם מקור ב־30 הימים האחרונים,
 * ואם אין כזה, הכניסה הראשונה.
 */
export function getVisitAttribution(): Attribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (raw) {
      const a = JSON.parse(raw) as Attribution;
      if (a && typeof a.ts === "number" && Date.now() - a.ts <= LAST_TTL_MS) return a;
      localStorage.removeItem(LAST_KEY);
    }
  } catch { /* ignore */ }
  return getStoredAttribution();
}
