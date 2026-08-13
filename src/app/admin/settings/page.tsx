"use client";

import Link from "next/link";

type Card = { href: string; icon: string; title: string; desc: string };
type Group = { label: string; icon: string; tint: string; cards: Card[] };

// Four groups, rendered as four open panels — the categories are visible as
// containers, but every setting is still one click away (no drill-down level).
const GROUPS: Group[] = [
  {
    label: "זהות העסק",
    icon: "🏢",
    tint: "bg-teal-50 text-teal-700 border-teal-100",
    cards: [
      { href: "/admin/settings/storefront", icon: "🖼️", title: "עיצוב דף הבית", desc: "סטוריז, מוצרים, עדכונים, גלריה ובועת וואטסאפ" },
      { href: "/admin/settings/business", icon: "🏢", title: "פרטי עסק", desc: "שם, פרטי קשר, תמונות וערכת עיצוב" },
      { href: "/admin/settings/social", icon: "🔗", title: "רשתות חברתיות", desc: "וואטסאפ, אינסטגרם, פייסבוק, ווייז" },
      { href: "/admin/settings/access", icon: "🔐", title: "גישה ואבטחה", desc: "טלפון כניסה למנהל, החלפת סיסמה" },
      { href: "/admin/settings/notifications", icon: "🔔", title: "התראות", desc: "מי מקבל התראה, ועל אילו אירועים" },
      { href: "/admin/settings/reports", icon: "📊", title: "דוחות", desc: "סיכום יומי, שבועי וחודשי — אליך ולצוות" },
    ],
  },
  {
    label: "יומן וצוות",
    icon: "📅",
    tint: "bg-indigo-50 text-indigo-700 border-indigo-100",
    cards: [
      { href: "/admin/settings/calendar", icon: "📅", title: "יומן ותורים", desc: "טווח הזמנה, זמן מראש, שעות תצוגה ומדיניות ביטולים" },
      { href: "/admin/settings/hours", icon: "🗓️", title: "שעות עבודה", desc: "לוח שעות והפסקות לכל ספר" },
      { href: "/admin/settings/permissions", icon: "👥", title: "הרשאות ספרים", desc: "מה ספרים יכולים לראות ולעשות" },
      { href: "/admin/staff", icon: "✂️", title: "ספרים", desc: "ניהול צוות, גישה ופרופילים" },
      { href: "/admin/services", icon: "💈", title: "שירותים", desc: "קטלוג השירותים — שם, מחיר, משך" },
    ],
  },
  {
    label: "תקשורת עם לקוחות",
    icon: "💬",
    tint: "bg-emerald-50 text-emerald-700 border-emerald-100",
    cards: [
      { href: "/admin/settings/whatsapp", icon: "💬", title: "וואטסאפ", desc: "חיבור, הודעת פתיחה, שיחות ובדיקה" },
      { href: "/admin/templates", icon: "💌", title: "תבניות הודעות", desc: "כל נוסחי ההודעות ללקוחות" },
      { href: "/admin/agent", icon: "🧠", title: "סוכן AI", desc: "התנהגות הבוט שעונה בוואטסאפ" },
      { href: "/admin/settings/automations", icon: "🤖", title: "אוטומציות", desc: "החזרת לקוחות וקידום אחרי ביקור" },
    ],
  },
  {
    label: "שיווק",
    icon: "🎁",
    tint: "bg-amber-50 text-amber-700 border-amber-100",
    cards: [
      { href: "/admin/settings/marketing", icon: "🎁", title: "שיווק והפניות", desc: "חבר מביא חבר, מקורות הגעה, פיקסל פייסבוק" },
    ],
  },
];

export default function SettingsHubPage() {
  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">הגדרות</h1>
        <p className="text-neutral-500 text-sm mt-1">כל ההגדרות של המערכת, מסודרות לפי נושא</p>
      </div>

      <div className="max-w-4xl space-y-4">
        {GROUPS.map(group => (
          <section key={group.label} className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
            {/* Group header */}
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-neutral-100">
              <span className={`w-8 h-8 rounded-xl border flex items-center justify-center text-base shrink-0 ${group.tint}`}>
                {group.icon}
              </span>
              <h2 className="font-semibold text-neutral-800">{group.label}</h2>
              <span className="text-xs text-neutral-300 mr-auto">{group.cards.length}</span>
            </div>

            {/* Cards inside the group */}
            <div className="grid sm:grid-cols-2 gap-2 p-3">
              {group.cards.map(c => (
                <Link key={c.href} href={c.href}
                  className="flex items-start gap-3 rounded-xl px-3.5 py-3 bg-neutral-50/70 border border-transparent hover:bg-white hover:border-teal-200 hover:shadow-sm transition group">
                  <span className="text-xl shrink-0 mt-0.5">{c.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-800">{c.title}</p>
                    <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">{c.desc}</p>
                  </div>
                  <span className="text-neutral-300 group-hover:text-teal-500 transition text-sm mt-0.5">‹</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
