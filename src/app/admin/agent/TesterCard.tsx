"use client";

import { useEffect, useState } from "react";

/**
 * Test mode, before "הפעל" (14.10.2026): the one number the agent answers on
 * WhatsApp so the owner can try it (src/lib/agent/test-mode.ts). Gone once
 * the shop is live.
 */
export default function TesterCard() {
  const [show, setShow] = useState(false);
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [me, biz] = await Promise.all([
        fetch("/api/admin/me").then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/admin/business").then(r => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!me?.isOwner || me.activatedAt) return;
      let t = "";
      try { const s = typeof biz?.settings === "string" ? JSON.parse(biz.settings) : (biz?.settings ?? {}); if (Array.isArray(s.agentTesters) && typeof s.agentTesters[0] === "string") t = s.agentTesters[0]; } catch { /* none yet */ }
      setPhone(t); setSaved(t); setShow(true);
    })();
  }, []);

  if (!show) return null;
  const save = async () => {
    setBusy(true);
    const t = phone.trim();
    const r = await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentTesters: t ? [t] : [] }) }).catch(() => null);
    if (r?.ok) setSaved(t);
    setBusy(false);
  };

  return (
    <div className="mb-6 rounded-2xl border border-teal-200 bg-teal-50 p-4">
      <p className="text-sm font-semibold text-teal-900">מצב בדיקה</p>
      <p className="text-xs text-teal-800 mt-0.5 mb-3">עד ההפעלה הסוכן עונה בוואטסאפ רק למספר הזה. תורים בבדיקה לא נשמרים.</p>
      <div className="flex gap-2">
        <input value={phone} onChange={e => setPhone(e.target.value)} dir="ltr" inputMode="tel" placeholder="מספר לבדיקה" className="flex-1 min-w-0 rounded-xl border border-teal-200 bg-white px-3 py-2 text-[15px]" />
        <button type="button" onClick={() => void save()} disabled={busy || phone.trim() === (saved ?? "")} className="shrink-0 rounded-xl bg-teal-600 text-white text-sm font-semibold px-4 disabled:opacity-40">{busy ? "…" : saved === phone.trim() && saved ? "נשמר ✓" : "שמור"}</button>
      </div>
    </div>
  );
}
