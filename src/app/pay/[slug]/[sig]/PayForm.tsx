"use client";

import { useState } from "react";

const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4FE3B1]";

export default function PayForm({ slug, sig, defaultName, defaultEmail }: { slug: string; sig: string; defaultName: string; defaultEmail: string }) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true);
    const r = await fetch("/api/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, sig, name, email }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (j.url) { window.location.href = j.url; return; }
    setBusy(false);
    if (j.paid) { window.location.reload(); return; }
    if (j.pending) { setPending(true); return; }
    setError(j.error || "משהו השתבש, נסה שוב");
  }

  if (pending) return <div className="rounded-2xl bg-emerald-50 text-emerald-800 text-sm px-4 py-3 leading-relaxed">רשמנו שאתה ממשיך. דף התשלום ייפתח ממש בקרוב ונשלח לך אותו. בינתיים הכל ממשיך לעבוד כרגיל.</div>;

  return (
    <form onSubmit={go} className="space-y-3">
      <div>
        <label className="block text-sm text-slate-600 mb-1.5">שם מלא (לחשבונית)</label>
        <input value={name} onChange={e => setName(e.target.value)} className={input} />
      </div>
      <div>
        <label className="block text-sm text-slate-600 mb-1.5">מייל לחשבוניות</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} dir="ltr" placeholder="name@gmail.com" className={input} />
      </div>
      {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 text-center">{error}</div>}
      <button type="submit" disabled={busy || !email} className="w-full rounded-2xl py-3.5 text-[15px] font-bold text-white disabled:opacity-50" style={{ background: "#FF6B57" }}>
        {busy ? "רגע…" : "להזנת כרטיס אשראי"}
      </button>
    </form>
  );
}
