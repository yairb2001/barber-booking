"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"owner" | "staff">("owner");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!password) { setError("נא להזין סיסמה"); return; }
    if (mode === "staff" && !phone) { setError("נא להזין טלפון"); return; }

    setSubmitting(true);

    try {
      const body: Record<string, string> = { password };
      if (mode === "staff") body.phone = phone;

      const res = await fetch("/api/admin/auth/login", {
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-neutral-900 rounded-2xl border border-neutral-800 p-6 space-y-4"
      >
        <div className="text-center space-y-1">
          <div className="text-4xl">✂️</div>
          <h1 className="text-xl font-bold text-amber-400">כניסת מנהל</h1>
        </div>

        {/* Mode tabs */}
        <div className="flex bg-neutral-800 rounded-xl p-1">
          <button
            type="button"
            onClick={() => { setMode("owner"); setError(""); }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${mode === "owner" ? "bg-amber-500 text-neutral-950" : "text-neutral-400"}`}
          >
            מנהל ראשי
          </button>
          <button
            type="button"
            onClick={() => { setMode("staff"); setError(""); }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${mode === "staff" ? "bg-amber-500 text-neutral-950" : "text-neutral-400"}`}
          >
            ספר
          </button>
        </div>

        {mode === "staff" && (
          <div>
            <label className="text-sm text-neutral-400 block mb-1">טלפון</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="050-0000000"
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-amber-500"
              dir="ltr"
            />
          </div>
        )}

        <div>
          <label className="text-sm text-neutral-400 block mb-1">סיסמה</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={mode === "owner"}
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
          disabled={submitting || !password}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-neutral-700 disabled:text-neutral-500 text-neutral-950 font-bold py-3 rounded-xl transition"
        >
          {submitting ? "נכנס..." : "כניסה"}
        </button>
      </form>
    </div>
  );
}
