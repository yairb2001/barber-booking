"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Card = { href: string; icon: string; title: string; desc: string };
type Group = { label: string; icon: string; tint: string; cards: Card[] };

// Mirrors the owner's settings hub (/admin/settings): four open panels with the
// cards already inside, so nothing is more than one click away.
const GROUPS: Group[] = [
  {
    label: "העבודה שלי",
    icon: "✂️",
    tint: "bg-teal-50 text-teal-700 border-teal-100",
    cards: [
      { href: "/admin/barber-settings/services", icon: "🛠️", title: "השירותים שלי", desc: "מה אני מציע, מחיר ומשך מותאמים" },
      { href: "/admin/barber-settings/hours", icon: "📅", title: "שעות ויומן", desc: "שעות עבודה, הפסקות וזמני הזמנה" },
    ],
  },
  {
    label: "הפרופיל שלי",
    icon: "👤",
    tint: "bg-indigo-50 text-indigo-700 border-indigo-100",
    cards: [
      { href: "/admin/barber-settings/photo", icon: "🖼️", title: "תמונת פרופיל", desc: "התמונה שלקוחות רואים בדף הבית" },
      { href: "/admin/barber-settings/notifications", icon: "🔔", title: "התראות", desc: "על אילו אירועים לקבל התראה למכשיר" },
      { href: "/admin/barber-settings/password", icon: "🔒", title: "סיסמה", desc: "החלפת סיסמת הכניסה שלי" },
    ],
  },
  {
    label: "התוכן שלי",
    icon: "📸",
    tint: "bg-amber-50 text-amber-700 border-amber-100",
    cards: [
      { href: "/admin/barber-settings/stories", icon: "📸", title: "סטוריז", desc: "תמונות זמניות שמוצגות בדף הבית" },
      { href: "/admin/portfolio", icon: "🖼️", title: "גלריית עבודות", desc: "גלריית התמונות הקבועה שלי" },
    ],
  },
];

export default function BarberSettingsHubPage() {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    // /api/admin/me returns only {id,name,role} for the staff — the avatar
    // lives on the staff record itself.
    fetch("/api/admin/me").then(r => (r.ok ? r.json() : null)).then(async me => {
      if (!me?.staffId) return;
      setName(me.staff?.name || "");
      const s = await fetch(`/api/admin/staff/${me.staffId}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (s) setAvatar(s.avatarUrl ?? null);
    }).catch(() => {});
  }, []);

  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <div className="flex items-center gap-3 mb-6">
        {avatar
          ? <img src={avatar} alt="" className="w-12 h-12 rounded-full object-cover" />
          : <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center font-bold text-teal-700 text-xl">{name[0] || "?"}</div>}
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">ההגדרות שלי</h1>
          <p className="text-neutral-500 text-sm mt-0.5">{name}</p>
        </div>
      </div>

      <div className="max-w-4xl space-y-4">
        {GROUPS.map(group => (
          <section key={group.label} className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-neutral-100">
              <span className={`w-8 h-8 rounded-xl border flex items-center justify-center text-base shrink-0 ${group.tint}`}>
                {group.icon}
              </span>
              <h2 className="font-semibold text-neutral-800">{group.label}</h2>
              <span className="text-xs text-neutral-300 mr-auto">{group.cards.length}</span>
            </div>

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
