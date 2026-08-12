"use client";

import Link from "next/link";
import { useState } from "react";

export default function BarberPasswordPage() {
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function savePassword() {
    setError("");
    if (newPass.length < 6) { setError("הסיסמה החדשה חייבת להיות לפחות 6 תווים"); return; }
    if (newPass !== confirmPass) { setError("הסיסמאות לא תואמות"); return; }
    setSaving(true);
    const res = await fetch("/api/admin/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass, confirmPassword: confirmPass }),
    });
    setSaving(false);
    if (!res.ok) { const d = await res.json(); setError(d.error || "שגיאה"); return; }
    setSaved(true); setOldPass(""); setNewPass(""); setConfirmPass("");
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <Link href="/admin/barber-settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות שלי</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🔒 סיסמה</h1>
        <p className="text-neutral-500 text-sm mt-1">החלפת סיסמת הכניסה שלך</p>
      </div>

      <div className="space-y-4 max-w-xl">
        {saved && <div className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ סיסמה עודכנה בהצלחה</div>}
        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

        <div className="bg-white border border-neutral-200 rounded-2xl p-4 space-y-3">
          <div>
            <label className="text-xs text-neutral-500 block mb-1">סיסמה נוכחית</label>
            <input type="password" value={oldPass} onChange={e => setOldPass(e.target.value)}
              placeholder="סיסמה נוכחית" dir="ltr"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">סיסמה חדשה (מינ׳ 6 תווים)</label>
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
              placeholder="סיסמה חדשה" dir="ltr"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">אימות סיסמה</label>
            <input type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)}
              placeholder="הכנס שוב את הסיסמה החדשה" dir="ltr"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
          </div>
        </div>

        <button onClick={savePassword} disabled={saving || !oldPass || !newPass || !confirmPass}
          className="w-full bg-violet-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition">
          {saving ? "שומר..." : "🔒 שמור סיסמה"}
        </button>
      </div>
    </div>
  );
}
