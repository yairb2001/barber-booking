"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!phone) { setError("נא להזין טלפון"); return; }
    if (!password) { setError("נא להזין סיסמה"); return; }

    setSubmitting(true);

    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-neutral-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-neutral-900 rounded-2xl border border-neutral-800 p-6 space-y-4"
      >
        <div className="text-center space-y-1">
          <div className="text-4xl">✂️</div>
          <h1 className="text-xl font-bold text-amber-400">כניסת מנהל</h1>
          <p className="text-[11px] text-neutral-500">מנהל ראשי או ספר — אותו מסך</p>
        </div>

        <div>
          <label className="text-sm text-neutral-400 block mb-1">טלפון</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="050-0000000"
            autoFocus
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-amber-500"
            dir="ltr"
          />
        </div>

        <div>
          <label className="text-sm text-neutral-400 block mb-1">סיסמה</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-amber-500"
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
          disabled={submitting || !password || !phone}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-neutral-700 disabled:text-neutral-500 text-neutral-950 font-bold py-3 rounded-xl transition"
        >
          {submitting ? "נכנס..." : "כניסה"}
        </button>
      </form>
    </div>
  );
}
