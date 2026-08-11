"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SocialLinks = { whatsapp?: string; instagram?: string; facebook?: string; waze?: string };

export default function SocialLinksPage() {
  const [links, setLinks] = useState<SocialLinks>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(data => {
      if (data) setLinks(data.socialLinks || {});
      setLoading(false);
    });
  }, []);

  function setSocial(key: string, value: string) { setLinks(p => ({ ...p, [key]: value })); }

  async function save() {
    setSaving(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socialLinks: links }),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🔗 רשתות חברתיות</h1>
        <p className="text-neutral-500 text-sm mt-1">קישורים המוצגים בדף הבית ללקוחות</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-5 max-w-xl">
          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="space-y-3">
              {[
                { key: "whatsapp", label: "WhatsApp", placeholder: "972501234567", icon: "📱" },
                { key: "instagram", label: "Instagram", placeholder: "dominant_barbershop", icon: "📸" },
                { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/...", icon: "👍" },
                { key: "waze", label: "Waze", placeholder: "https://waze.com/...", icon: "🗺️" },
              ].map(({ key, label, placeholder, icon }) => (
                <div key={key}>
                  <label className="text-xs text-neutral-500 block mb-1">{icon} {label}</label>
                  <input value={(links as Record<string, string>)[key] || ""} onChange={e => setSocial(key, e.target.value)} dir="ltr" placeholder={placeholder}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                </div>
              ))}
            </div>
          </div>

          <button onClick={save} disabled={saving}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition ${saved ? "bg-emerald-500 text-white" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
            {saving ? "שומר..." : saved ? "✓ נשמר!" : "שמור שינויים"}
          </button>
        </div>
      )}
    </div>
  );
}
