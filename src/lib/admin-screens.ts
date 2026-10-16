/**
 * The shop admin's screens, with the way to reach each one from the menu
 * (15.10.2026, Yair: "אם הוא מדריך משהו להגדרות, שישלח בצורה מסודרת שלב שלב
 * איפה זה בהגדרות, או אפילו לחצן קיצור דרך"). Used by the reply drafts (the
 * path in words) and by the requests chat (a link becomes a button to the
 * screen). Mirrors the menu (AdminLayoutClient) and the settings hub.
 */
import type { Vocab } from "@/lib/vocab";

export type AdminScreen = { path: string; name: string; crumbs: string };

export const ADMIN_SCREENS: AdminScreen[] = [
  { path: "/admin", name: "יומן", crumbs: "יומן" },
  { path: "/admin/dashboard", name: "דאשבורד", crumbs: "דאשבורד" },
  { path: "/admin/chats", name: "שיחות", crumbs: "שיחות" },
  { path: "/admin/notifications", name: "התראות", crumbs: "התראות" },
  { path: "/admin/customers", name: "לקוחות", crumbs: "לקוחות" },
  { path: "/admin/referrals", name: "חבר מביא חבר", crumbs: "חבר מביא חבר" },
  { path: "/admin/messaging", name: "הודעות תפוצה", crumbs: "הודעות תפוצה" },
  { path: "/admin/requests", name: "בקשות ושיפורים", crumbs: "בקשות ושיפורים" },
  { path: "/admin/agent", name: "סוכן AI", crumbs: "סוכן AI" },
  { path: "/admin/settings", name: "הגדרות", crumbs: "הגדרות עסק" },
  { path: "/admin/settings/plan", name: "המסלול שלי", crumbs: "הגדרות עסק ← המסלול שלי (למעלה)" },
  { path: "/admin/settings/storefront", name: "עיצוב דף הבית", crumbs: "הגדרות עסק ← זהות העסק ← עיצוב דף הבית" },
  { path: "/admin/settings/business", name: "פרטי עסק", crumbs: "הגדרות עסק ← זהות העסק ← פרטי עסק" },
  { path: "/admin/settings/social", name: "רשתות חברתיות", crumbs: "הגדרות עסק ← זהות העסק ← רשתות חברתיות" },
  { path: "/admin/settings/access", name: "גישה ואבטחה", crumbs: "הגדרות עסק ← זהות העסק ← גישה ואבטחה" },
  { path: "/admin/settings/notifications", name: "הגדרות התראות", crumbs: "הגדרות עסק ← זהות העסק ← התראות" },
  { path: "/admin/settings/reports", name: "דוחות", crumbs: "הגדרות עסק ← זהות העסק ← דוחות" },
  { path: "/admin/settings/calendar", name: "יומן ותורים", crumbs: "הגדרות עסק ← יומן וצוות ← יומן ותורים" },
  { path: "/admin/settings/notices", name: "הודעה חשובה ללקוחות", crumbs: "הגדרות עסק ← יומן וצוות ← הודעה חשובה ללקוחות" },
  { path: "/admin/settings/hours", name: "שעות עבודה", crumbs: "הגדרות עסק ← יומן וצוות ← שעות עבודה" },
  { path: "/admin/settings/permissions", name: "הרשאות ספרים", crumbs: "הגדרות עסק ← יומן וצוות ← הרשאות ספרים" },
  { path: "/admin/staff", name: "ספרים", crumbs: "הגדרות עסק ← יומן וצוות ← ספרים" },
  { path: "/admin/services", name: "שירותים", crumbs: "הגדרות עסק ← יומן וצוות ← שירותים" },
  { path: "/admin/settings/rooms", name: "חדרים", crumbs: "הגדרות עסק ← יומן וצוות ← חדרים" },
  { path: "/admin/settings/classes", name: "שיעורים קבוצתיים", crumbs: "הגדרות עסק ← יומן וצוות ← שיעורים קבוצתיים" },
  { path: "/admin/classes", name: "לוח השיעורים", crumbs: "שיעורים (בתפריט)" },
  { path: "/admin/settings/whatsapp", name: "וואטסאפ", crumbs: "הגדרות עסק ← תקשורת עם לקוחות ← וואטסאפ" },
  { path: "/admin/templates", name: "תבניות הודעות", crumbs: "הגדרות עסק ← תקשורת עם לקוחות ← תבניות הודעות" },
  { path: "/admin/settings/automations", name: "אוטומציות", crumbs: "הגדרות עסק ← תקשורת עם לקוחות ← אוטומציות" },
  { path: "/admin/settings/marketing", name: "שיווק והפניות", crumbs: "הגדרות עסק ← שיווק ← שיווק והפניות" },
];

/** The list in the shop's words: a nail studio's menu says מניקוריסטיות
 *  where DOMINANT's says ספרים (16.10.2026). */
export function adminScreensFor(v?: Vocab | null): AdminScreen[] {
  if (!v || v.type === "barber_men") return ADMIN_SCREENS;
  const w = (s: string) => s.split("ספרים").join(v.staffPlural);
  return ADMIN_SCREENS.map(s => ({ ...s, name: w(s.name), crumbs: w(s.crumbs) }));
}

/** The screen a path belongs to (longest matching prefix), or null. */
export function screenFor(path: string, v?: Vocab | null): AdminScreen | null {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/admin";
  let best: AdminScreen | null = null;
  for (const s of adminScreensFor(v)) {
    if ((clean === s.path || clean.startsWith(`${s.path}/`)) && (!best || s.path.length > best.path.length)) best = s;
  }
  return best;
}

/** The list for a prompt: "path | how to get there". */
export function screensForPrompt(v?: Vocab | null): string {
  return adminScreensFor(v).map(s => `${s.path} | ${s.crumbs}`).join("\n");
}
