"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function AccessSecurityPage() {
  const [loading, setLoading] = useState(true);

  // Owner login phone
  const [ownerLoginPhone, setOwnerLoginPhone] = useState("");
  const [ownerPhoneSaving, setOwnerPhoneSaving] = useState(false);
  const [ownerPhoneSaved, setOwnerPhoneSaved] = useState(false);

  // Change password
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(data => {
      if (data) {
        const s = data.settings || {};
        setOwnerLoginPhone(s.ownerLoginPhone || data.phone || "");
      }
      setLoading(false);
    });
  }, []);

  async function saveOwnerLoginPhone() {
    setOwnerPhoneSaving(true);
    setOwnerPhoneSaved(false);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settingsPatch: { ownerLoginPhone: ownerLoginPhone.trim() } }),
    });
    setOwnerPhoneSaving(false);
    setOwnerPhoneSaved(true);
    setTimeout(() => setOwnerPhoneSaved(false), 2000);
  }

  async function changePassword() {
    setPwError("");
    setPwSuccess(false);
    if (!oldPassword) { setPwError("נא להזין את הסיסמה הנוכחית"); return; }
    if (!newPassword || newPassword.length < 6) { setPwError("הסיסמה החדשה חייבת להיות לפחות 6 תווים"); return; }
    if (newPassword !== confirmNewPassword) { setPwError("הסיסמאות החדשות לא תואמות"); return; }
    setPwSaving(true);
    try {
      const res = await fetch("/api/admin/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword: confirmNewPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwError(data.error || "שגיאה");
      } else {
        setPwSuccess(true);
        setOldPassword(""); setNewPassword(""); setConfirmNewPassword("");
        setTimeout(() => setPwSuccess(false), 3000);
      }
    } catch {
      setPwError("שגיאה בחיבור לשרת");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🔐 גישה ואבטחה</h1>
        <p className="text-neutral-500 text-sm mt-1">טלפון כניסה למנהל הראשי והחלפת סיסמה</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-5 max-w-xl">
          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <label className="text-sm text-neutral-800 font-semibold block">🔐 כניסה למנהל ראשי</label>
                <p className="text-[11px] text-neutral-600 mt-0.5">הטלפון שתזין כאן יידרש בעת ההתחברות (יחד עם הסיסמה).</p>
              </div>
              {ownerPhoneSaved && <span className="text-[11px] text-green-700 font-semibold">✓ נשמר</span>}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="tel"
                value={ownerLoginPhone}
                onChange={e => setOwnerLoginPhone(e.target.value)}
                placeholder="050-0000000"
                dir="ltr"
                className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              <button
                type="button"
                onClick={saveOwnerLoginPhone}
                disabled={ownerPhoneSaving || !ownerLoginPhone.trim()}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-neutral-300 text-white text-sm font-semibold rounded-lg transition"
              >
                {ownerPhoneSaving ? "שומר..." : "שמור"}
              </button>
            </div>
            <div className="mt-3 pt-3 border-t border-neutral-100 flex items-center justify-between">
              <span className="text-[12px] text-neutral-700">👥 מנהלים משניים (ספרים עם גישה)</span>
              <a href="/admin/staff" className="text-[12px] font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-2">
                ניהול גישות ←
              </a>
            </div>
            <p className="text-[10px] text-neutral-500 mt-1.5 leading-relaxed">
              כל ספר שתגדיר לו סיסמה (דרך עמוד הצוות) יוכל להיכנס עם הטלפון והסיסמה שלו.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <p className="text-sm text-neutral-800 font-semibold mb-3">🔑 החלפת סיסמה</p>
            <div className="space-y-2">
              <input
                type="password"
                value={oldPassword}
                onChange={e => setOldPassword(e.target.value)}
                placeholder="סיסמה נוכחית"
                autoComplete="current-password"
                dir="ltr"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="סיסמה חדשה (לפחות 6 תווים)"
                autoComplete="new-password"
                dir="ltr"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              <input
                type="password"
                value={confirmNewPassword}
                onChange={e => setConfirmNewPassword(e.target.value)}
                placeholder="אימות סיסמה חדשה"
                autoComplete="new-password"
                dir="ltr"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              {pwError && (
                <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                  {pwError}
                </p>
              )}
              {pwSuccess && (
                <p className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-1.5">
                  ✓ הסיסמה הוחלפה בהצלחה
                </p>
              )}
              <button
                type="button"
                onClick={changePassword}
                disabled={pwSaving || !oldPassword || !newPassword || !confirmNewPassword}
                className="w-full px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition"
              >
                {pwSaving ? "מחליף..." : "החלף סיסמה"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
