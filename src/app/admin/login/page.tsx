"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type SetupStatus = {
  hasOwnerPassword: boolean;
  hasBusinessPhone: boolean;
  businessName: string;
  phoneHint: string | null;
};

export default function AdminLoginPage() {
  const router = useRouter();

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

      router.push("/admin");
      router.refresh();
    } catch {
      setError("שגיאה בחיבור לשרת");
      setSubmitting(false);
    }
  };

  if (loadingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <div className="text-neutral-500 text-sm">טוען...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-neutral-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-neutral-900 rounded-2xl border border-neutral-800 p-6 space-y-4"
      >
        <div className="text-center space-y-1">
          <div className="text-4xl">{isSetupMode ? "🔐" : "✂️"}</div>
          <h1 className="text-xl font-bold text-slate-700">
            {isSetupMode ? "הגדרת סיסמה ראשונית" : "כניסת מנהל"}
          </h1>
          <p className="text-[11px] text-neutral-500">
            {isSetupMode
              ? `ברוך הבא ל${status?.businessName || "מערכת"} — אין עדיין סיסמה. הגדר אותה עכשיו.`
              : "מנהל ראשי או ספר — אותו מסך"}
          </p>
        </div>

        {/* Setup mode helper */}
        {isSetupMode && status?.phoneHint && (
          <div className="bg-slate-900/10 border border-slate-900/30 rounded-lg p-3 text-slate-300 text-[12px] leading-relaxed">
            הזן את הטלפון של העסק (4 ספרות אחרונות: <span className="font-mono font-bold">{status.phoneHint}</span>).
            <br />
            אם זה לא תואם — עדכן בהגדרות העסק קודם.
          </div>
        )}
        {isSetupMode && !status?.phoneHint && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-[12px] leading-relaxed">
            לא הוגדר טלפון לעסק. יש להגדיר טלפון ב-DB לפני יצירת סיסמה.
          </div>
        )}

        <div>
          <label className="text-sm text-neutral-400 block mb-1">טלפון</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="050-0000000"
            autoFocus
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-teal-500"
            dir="ltr"
          />
        </div>

        <div>
          <label className="text-sm text-neutral-400 block mb-1">
            {isSetupMode ? "סיסמה חדשה (לפחות 6 תווים)" : "סיסמה"}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-teal-500"
            dir="ltr"
          />
        </div>

        {isSetupMode && (
          <div>
            <label className="text-sm text-neutral-400 block mb-1">אימות סיסמה</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-teal-500"
              dir="ltr"
            />
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !password || !phone || (isSetupMode && !confirmPassword)}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-neutral-700 disabled:text-neutral-500 text-white font-bold py-3 rounded-xl transition"
        >
          {submitting ? (isSetupMode ? "יוצר..." : "נכנס...") : (isSetupMode ? "צור סיסמה והיכנס" : "כניסה")}
        </button>
      </form>
    </div>
  );
}
