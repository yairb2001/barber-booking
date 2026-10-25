"use client";

import { useState } from "react";

/**
 * Login for the CRM's reports screen (25.10.2026, Yair: "אשתי תאשר, תבנה לה כניסה
 * משלה"). Phone and the password Yair set for her in the CRM settings; opens
 * straight on /admin/crm/reports. Yair himself logs in at /admin/login.
 */
const C = { petrol: "#0B3A3C", turquoise: "#4FE3B1", ground: "#F4F7F6", line: "#DCE6E4", muted: "#536B6C", ink: "#0B1F21" };

export default function CrmLogin() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/crm-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, password }) }).catch(() => null);
    if (r?.ok) { window.location.href = "/admin/crm/reports"; return; }
    setBusy(false);
    setErr((await r?.json().catch(() => null))?.error ?? "שגיאת רשת, נסי שוב");
  }
  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center px-4 font-heebo" style={{ background: C.ground, color: C.ink }}>
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-3xl p-7 flex flex-col gap-4" style={{ border: `1px solid ${C.line}` }}>
        <div className="flex items-baseline gap-2 self-center" dir="ltr">
          <span className="text-[28px] font-bold" style={{ color: C.petrol, fontFamily: "Outfit, Heebo, sans-serif", letterSpacing: "-0.5px" }}>Chator</span>
          <span className="text-xs font-semibold tracking-widest" style={{ color: C.petrol }}>CRM</span>
        </div>
        <div className="text-center">
          <h1 className="m-0 text-xl font-extrabold">מסך הדיווחים</h1>
          <p className="m-0 mt-1 text-sm" style={{ color: C.muted }}>הדיווחים של העסקים על הסוכן, והאישורים לתיקונים</p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">טלפון</span>
          <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="username" dir="ltr" className="h-12 rounded-xl px-3 text-right text-[16px]" style={{ border: "1px solid #C7D8D5" }} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">סיסמה</span>
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" className="h-12 rounded-xl px-3 text-[16px]" style={{ border: "1px solid #C7D8D5" }} />
        </label>
        {err && <p className="m-0 text-sm" style={{ color: "#B42318" }}>{err}</p>}
        <button type="submit" disabled={busy || !phone || !password} className="h-12 rounded-xl text-white font-bold disabled:opacity-50" style={{ background: C.petrol }}>{busy ? "נכנסת…" : "כניסה"}</button>
        <a href="/admin/login?next=/admin/crm/reports" className="text-center text-xs" style={{ color: C.muted }}>יאיר? כניסת מנהל</a>
      </form>
    </div>
  );
}
