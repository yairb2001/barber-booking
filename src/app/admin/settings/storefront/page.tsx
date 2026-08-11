"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const TILES = [
  { href: "/admin/stories", icon: "📸", label: "סטוריז", desc: "תמונות זמניות עם תפוגה, מוצגות בדף הבית" },
  { href: "/admin/products", icon: "🛍️", label: "מוצרים", desc: "קטלוג מוצרים המוצג ללקוחות בדף הבית" },
  { href: "/admin/announcements", icon: "📢", label: "עדכונים", desc: "הודעות טקסט המוצגות ללקוחות" },
  { href: "/admin/portfolio", icon: "🖼️", label: "גלריית עבודות", desc: "גלריית תמונות עבודה קבועה, לכל ספר" },
];

export default function StorefrontContentPage() {
  // The WhatsApp nudge bubble is a homepage element, so it's configured here
  // rather than on the WhatsApp settings page.
  const [whatsappBubbleEnabled, setWhatsappBubbleEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(data => {
      const s = data?.settings || {};
      setWhatsappBubbleEnabled(s.whatsappBubbleEnabled !== false);
      setLoading(false);
    });
  }, []);

  async function saveBubble(value: boolean) {
    setWhatsappBubbleEnabled(value);
    setSaving(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settingsPatch: { whatsappBubbleEnabled: value } }),
    });
    setSaving(false);
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🖼️ עיצוב דף הבית</h1>
        <p className="text-neutral-500 text-sm mt-1">תוכן ואלמנטים שמוצגים ללקוחות בדף הבית</p>
      </div>

      <div className="max-w-xl space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

        {/* WhatsApp nudge bubble */}
        <div className="bg-white border border-neutral-200 rounded-2xl p-5">
          <label className="flex items-center justify-between cursor-pointer">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-800">💬 בועת &quot;קבע תור דרך הוואטסאפ&quot;</p>
              <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                בועה קופצת ליד כפתור הוואטסאפ בדף הבית שמזמינה לקבוע תור בצ&apos;אט.
              </p>
            </div>
            <button
              onClick={() => saveBubble(!whatsappBubbleEnabled)}
              disabled={loading || saving}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 mr-4 disabled:opacity-50 ${whatsappBubbleEnabled ? "bg-teal-600" : "bg-neutral-300"}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${whatsappBubbleEnabled ? "right-0.5" : "left-0.5"}`} />
            </button>
          </label>
          <p className="text-[11px] text-neutral-400 mt-3 pt-3 border-t border-neutral-100">
            את נוסח ההודעה שנפתחת בלחיצה עורכים במסך
            {" "}
            <Link href="/admin/settings/whatsapp" className="text-teal-600 hover:underline">וואטסאפ</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
