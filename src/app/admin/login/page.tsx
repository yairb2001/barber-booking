"use client";

import { useState, useEffect } from "react";

/** Chator's brand (15.10.2026, Yair: "תעשה את המסך כמו המיתוג שלנו"): the same
 *  petrol ground, white card, one coral button and Outfit wordmark as /signup
 *  and the setup wizard. */
const C = { petrol: "#0B3A3C", turquoise: "#4FE3B1", coral: "#FF6B57", ink: "#0B1F21" };
const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4FE3B1]";

type SetupStatus = {
  hasOwnerPassword: boolean;
  hasBusinessPhone: boolean;
  businessName: string;
  phoneHint: string | null;
};

export default function AdminLoginPage() {
  // ── On mount: check if password is set up. If not, show first-run UI. ──
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    fetch("/api/admin/auth/setup-status")
      .then(r => r.ok ? r.json() : null)
      .then((data: SetupStatus | null) => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setLoadingStatus(false));
  }, []);

  // ── Form state ──
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isSetupMode = Boolean(status && !status.hasOwnerPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!phone) { setError("נא להזין טלפון"); return; }
    if (!password) { setError("נא להזין סיסמה"); return; }

    setSubmitting(true);

    try {
      const url = isSetupMode ? "/api/admin/auth/setup" : "/api/admin/auth/login";
      const body = isSetupMode
        ? { phone, password, confirmPassword }
        : { phone, password };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "שגיאה");
        setSubmitting(false);
        return;
      }

      // Only an /admin path from our own redirect (?next=…), never another site.
      const next = new URLSearchParams(window.location.search).get("next");
      // A real page load, not router.push: the page must start with its own
      // manifest, or "Add to Home Screen" on the CRM saves the bookings app.
      window.location.assign(next && /^\/admin(\/|\?|$)/.test(next) ? next : "/admin");
    } catch {
      setError("שגיאה בחיבור לשרת");
      setSubmitting(false);
    }
  };

  if (loadingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center font-heebo" dir="rtl" style={{ background: C.petrol }}>
        <div className="text-white/60 text-sm">טוען...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-8 flex items-center justify-center font-heebo" dir="rtl" style={{ background: C.petrol }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700&display=swap" rel="stylesheet" />
      <div className="w-full max-w-sm">
        <div className="flex items-baseline justify-center gap-2 mb-5">
          <span className="text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "Outfit, Heebo, sans-serif" }}>Chator</span>
          <span className="text-xs" style={{ color: C.turquoise }}>צ׳אטור</span>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-3xl p-5 shadow-xl space-y-4">
          <div>
            <h1 className="text-xl font-bold" style={{ color: C.ink }}>
              {isSetupMode ? "הגדרת סיסמה ראשונית" : "כניסת מנהל"}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {isSetupMode
                ? `ברוך הבא ל${status?.businessName || "מערכת"}! אין עדיין סיסמה, הגדר אותה עכשיו.`
                : "בעל העסק או ספר, אותו מסך"}
            </p>
          </div>

          {/* Setup mode helper */}
          {isSetupMode && status?.phoneHint && (
            <div className="rounded-xl px-3 py-2.5 text-[13px] leading-relaxed" style={{ background: "#E3F7EF", color: C.petrol }}>
              הזן את הטלפון של העסק (4 ספרות אחרונות: <span className="font-mono font-bold">{status.phoneHint}</span>).
              <br />
              אם זה לא תואם, עדכן בהגדרות העסק קודם.
            </div>
          )}
          {isSetupMode && !status?.phoneHint && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 text-red-700 text-[13px] leading-relaxed">
              לא הוגדר טלפון לעסק. יש להגדיר טלפון ב-DB לפני יצירת סיסמה.
            </div>
          )}

          <div>
            <label className="block text-sm text-slate-600 mb-1.5">טלפון</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-0000000" autoFocus className={input} dir="ltr" />
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1.5">
              {isSetupMode ? "סיסמה חדשה (לפחות 6 תווים)" : "סיסמה"}
            </label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} dir="ltr" />
          </div>

          {isSetupMode && (
            <div>
              <label className="block text-sm text-slate-600 mb-1.5">אימות סיסמה</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={input} dir="ltr" />
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 text-center">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting || !password || !phone || (isSetupMode && !confirmPassword)}
            className="w-full rounded-2xl py-3.5 text-[15px] font-bold text-white disabled:opacity-50 transition active:scale-[0.99]"
            style={{ background: C.coral }}
          >
            {submitting ? (isSetupMode ? "יוצר..." : "נכנס...") : (isSetupMode ? "צור סיסמה והיכנס" : "כניסה")}
          </button>

          {!isSetupMode && (
            <p className="text-center text-[13px] text-slate-500">
              אין לכם עדיין עסק במערכת?{" "}
              <a href="/signup" className="font-semibold underline" style={{ color: C.petrol }}>פתחו עסק חדש</a>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
