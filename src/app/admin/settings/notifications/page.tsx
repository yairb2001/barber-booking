"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import NotificationSettings from "@/components/NotificationSettings";

export default function NotificationsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [ownerNotifyScope, setOwnerNotifyScope] = useState<"all" | "mine" | "off">("all");
  const [notifyScopeSaved, setNotifyScopeSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(data => {
      if (data) {
        const s = data.settings || {};
        if (["all", "mine", "off"].includes(s.ownerNotifyScope)) setOwnerNotifyScope(s.ownerNotifyScope);
      }
      setLoading(false);
    });
  }, []);

  async function saveOwnerNotifyScope(next: "all" | "mine" | "off") {
    setOwnerNotifyScope(next);
    setNotifyScopeSaved(false);
    // settingsPatch — server merges against a fresh read, so this can't clobber
    // (or be clobbered by) another settings page's save moments apart.
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settingsPatch: { ownerNotifyScope: next } }),
    });
    setNotifyScopeSaved(true);
    setTimeout(() => setNotifyScopeSaved(false), 2000);
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🔔 התראות</h1>
        <p className="text-neutral-500 text-sm mt-1">מי מקבל התראות, ועל אילו אירועים</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-5 max-w-xl">
          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <label className="text-sm text-neutral-800 font-semibold block">🔔 ההתראות שלי (מנהל ראשי)</label>
                <p className="text-[11px] text-neutral-600 mt-0.5 leading-relaxed">
                  על אילו תורים לקבל התראות לנייד — של כל הספרים, רק שלך, או בכלל לא.
                  התראות ניהול (הודעות חדשות, הסלמות, בקשות שינוי) ממשיכות להגיע כל עוד לא כבוי.
                </p>
              </div>
              {notifyScopeSaved && <span className="text-[11px] text-green-700 font-semibold shrink-0">✓ נשמר</span>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "all",  label: "כל הספרים", desc: "כל תור בעסק" },
                { key: "mine", label: "רק שלי",    desc: "רק היומן שלך" },
                { key: "off",  label: "כבוי",      desc: "בלי התראות" },
              ] as const).map(opt => {
                const active = ownerNotifyScope === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => saveOwnerNotifyScope(opt.key)}
                    className={`rounded-xl border p-3 text-center transition ${active ? "border-teal-500 bg-teal-50 ring-2 ring-teal-200" : "border-slate-300 bg-white hover:border-slate-400"}`}
                  >
                    <div className={`text-[13px] font-semibold ${active ? "text-teal-700" : "text-neutral-800"}`}>{opt.label}</div>
                    <div className="text-[10px] text-neutral-500 mt-0.5">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <NotificationSettings />
        </div>
      )}
    </div>
  );
}
