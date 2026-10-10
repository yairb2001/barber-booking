"use client";

import { useEffect, useState } from "react";

/**
 * Per kind of notification: how it reaches me (10.10.2026). Every
 * notification is always in the "התראות" tab; this picks whether it ALSO comes
 * as push or WhatsApp. Serves the owner and each barber (the API knows who).
 */
type Kind = { kind: string; label: string; hint: string; whatsapp: boolean; channel: "push" | "whatsapp" | "screen" };
const OPTS: { v: Kind["channel"]; label: string }[] = [{ v: "whatsapp", label: "וואטסאפ" }, { v: "push", label: "למסך + פוש" }, { v: "screen", label: "רק במסך" }];

export default function NotificationChannels() {
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { fetch("/api/admin/notifications/prefs").then(r => (r.ok ? r.json() : null)).then(j => setKinds(j?.kinds ?? [])).catch(() => setKinds([])); }, []);

  async function pick(kind: string, channel: Kind["channel"]) {
    setKinds(ks => ks?.map(k => (k.kind === kind ? { ...k, channel } : k)) ?? ks);
    const r = await fetch("/api/admin/notifications/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, channel }) });
    if (r.ok) { setSaved(kind); setTimeout(() => setSaved(s => (s === kind ? null : s)), 1500); }
  }

  if (!kinds) return null;
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-neutral-900">מה שהיה מגיע בוואטסאפ</h3>
      <p className="text-xs text-neutral-500 mt-1 mb-4 leading-relaxed">כל אלה נשמרים תמיד בלשונית &quot;התראות&quot;. לכל סוג בוחרים: להמשיך לקבל בוואטסאפ, לקבל פוש שפותח את המסך, או רק במסך בלי להפריע.</p>
      <div className="space-y-4">
        {kinds.map(k => (
          <div key={k.kind} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-neutral-800">{k.label}</p>
              {saved === k.kind && <span className="text-[11px] text-green-700 font-semibold">✓ נשמר</span>}
            </div>
            <p className="text-[11px] text-neutral-400">{k.hint}</p>
            <div className="flex gap-1.5">
              {OPTS.filter(o => o.v !== "whatsapp" || k.whatsapp).map(o => (
                <button key={o.v} type="button" onClick={() => pick(k.kind, o.v)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition ${k.channel === o.v ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
