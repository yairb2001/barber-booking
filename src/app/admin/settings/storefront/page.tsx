"use client";

import Link from "next/link";

const TILES = [
  { href: "/admin/stories", icon: "📸", label: "סטוריז", desc: "תמונות זמניות עם תפוגה, מוצגות בדף הבית" },
  { href: "/admin/products", icon: "🛍️", label: "מוצרים", desc: "קטלוג מוצרים המוצג ללקוחות בדף הבית" },
  { href: "/admin/announcements", icon: "📢", label: "עדכונים", desc: "הודעות טקסט המוצגות ללקוחות" },
  { href: "/admin/portfolio", icon: "🖼️", label: "גלריית עבודות", desc: "גלריית תמונות עבודה קבועה, לכל ספר" },
];

export default function StorefrontContentPage() {
  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🖼️ עיצוב דף הבית</h1>
        <p className="text-neutral-500 text-sm mt-1">תוכן שמוצג ללקוחות בדף הבית</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
        {TILES.map(t => (
          <Link key={t.href} href={t.href}
            className="flex items-start gap-3 bg-white border border-neutral-200 rounded-2xl px-4 py-4 hover:border-teal-300 hover:bg-teal-50/50 hover:shadow-sm transition group">
            <span className="text-2xl">{t.icon}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-800 group-hover:text-neutral-900">{t.label}</p>
              <p className="text-xs text-neutral-400 mt-0.5">{t.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
