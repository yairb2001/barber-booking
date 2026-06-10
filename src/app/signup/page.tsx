"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * Self-service signup — a new business owner registers their shop.
 * On success the owner is auto-logged-in and sent to the onboarding wizard.
 */
export default function SignupPage() {
  const router = useRouter();

  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!businessName.trim()) { setError("נא להזין שם עסק"); return; }
    if (!phone) { setError("נא להזין טלפון"); return; }
    if (password.length < 6) { setError("סיסמה חייבת להיות לפחות 6 תווים"); return; }
    if (password !== confirmPassword) { setError("הסיסמאות לא תואמות"); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, phone, password, confirmPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "שגיאה בהרשמה");
        setSubmitting(false);
        return;
      }
      // Auto-logged-in (cookie set by the API) → go to the onboarding wizard
      router.push("/admin/onboarding");
      router.refresh();
    } catch {
      setError("שגיאה בחיבור לשרת");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-neutral-950 font-heebo" dir="rtl">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-neutral-900 rounded-2xl border border-neutral-800 p-6 space-y-4"
      >
        <div className="text-center space-y-1">
          <div className="text-4xl">💈</div>
          <h1 className="text-xl font-bold text-white">פתיחת עסק חדש</h1>
          <p className="text-[11px] text-neutral-500">
            הרשמה חינם — תוך דקה יש לכם דף הזמנת תורים משלכם
          </p>
        </div>

        <div>
          <label className="text-sm text-neutral-400 block mb-1">שם העסק</label>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="המספרה של דני"
            autoFocus
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-teal-500"
          />
        </div>

        <div>
          <label className="text-sm text-neutral-400 block mb-1">טלפון (לכניסה למערכת)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="050-0000000"
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-teal-500"
            dir="ltr"
          />
        </div>

        <div>
          <label className="text-sm text-neutral-400 block mb-1">סיסמה (לפחות 6 תווים)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-teal-500"
            dir="ltr"
          />
        </div>

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

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !businessName || !phone || !password || !confirmPassword}
          className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-neutral-700 disabled:text-neutral-500 text-white font-bold py-3 rounded-xl transition"
        >
          {submitting ? "יוצר עסק..." : "פתיחת העסק שלי 🚀"}
        </button>

        <p className="text-center text-[12px] text-neutral-500">
          כבר יש לכם חשבון?{" "}
          <Link href="/admin/login" className="text-teal-400 hover:text-teal-300 font-medium">
            כניסה
          </Link>
        </p>
      </form>
    </div>
  );
}
