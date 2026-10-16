"use client";

import { useState } from "react";

/**
 * "במילים שלך" (16.10.2026, Yair: free writing, an LLM puts it into the
 * system prompt): the owner writes what matters to him, sees how the agent will
 * understand it, and only then saves. The model maps it onto the existing
 * answers, rules and FAQs (src/lib/agent/free-text.ts), so nothing piles up.
 */
export type FreeTextPlan = {
  setup: Record<string, string | boolean>;
  rules: string | null;
  faqs: { question: string; answer: string; replaceQuestion?: string }[];
  understood: string[];
  notUsed: string[];
};

export default function FreeTextCard({ onApplied, author = "owner" }: { onApplied?: (p: FreeTextPlan) => void; author?: "owner" | "wizard" }) {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<FreeTextPlan | null>(null);
  const [busy, setBusy] = useState<"plan" | "apply" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function call(body: Record<string, unknown>) {
    const r = await fetch("/api/admin/agent/free-text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    return { ok: !!r?.ok, ...j } as { ok: boolean; plan?: FreeTextPlan; error?: string };
  }

  return (
    <div className="rounded-2xl border border-teal-200 bg-white p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-neutral-800">במילים שלך</p>
        <p className="text-xs text-neutral-500 mt-0.5">כתוב חופשי מה חשוב לך שהסוכן ידע או יעשה. לפני ששומרים תראה בדיוק איך הוא הבין.</p>
      </div>
      {!plan && (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
            placeholder="למשל: בשישי עובדים רק עד 14:00. ילדים מתחת לגיל 5 רק עם הורה. כשמישהו שואל על חניה, יש חניה כחולה לבנה ברחוב"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          <button type="button" disabled={busy !== null || text.trim().length < 3}
            onClick={async () => { setBusy("plan"); setMsg(null); const r = await call({ action: "plan", text }); setBusy(null); if (r.ok && r.plan) setPlan(r.plan); else setMsg(r.error ?? "משהו השתבש, נסה שוב"); }}
            className="rounded-xl bg-teal-700 text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-40">{busy === "plan" ? "בודק איך הסוכן יבין…" : "בדוק איך הסוכן יבין"}</button>
        </>
      )}
      {plan && (
        <div className="space-y-2.5">
          <div>
            <p className="text-xs font-semibold text-teal-800 mb-1">ככה הסוכן יבין:</p>
            {plan.understood.length
              ? <ul className="list-disc ps-5 text-sm text-neutral-800 space-y-0.5">{plan.understood.map((l, i) => <li key={i}>{l}</li>)}</ul>
              : <p className="text-sm text-neutral-500">לא מצאתי פה משהו שמשנה את הסוכן.</p>}
          </div>
          {plan.notUsed.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-800 mb-1">לא נכנס:</p>
              <ul className="list-disc ps-5 text-xs text-neutral-600 space-y-0.5">{plan.notUsed.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy !== null || !plan.understood.length}
              onClick={async () => { setBusy("apply"); const r = await call({ action: "apply", plan, author }); setBusy(null); if (r.ok && r.plan) { onApplied?.(r.plan); setPlan(null); setText(""); setMsg("נשמר. הסוכן עובד ככה מעכשיו."); } else setMsg(r.error ?? "השמירה נכשלה"); }}
              className="rounded-xl bg-teal-700 text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-40">{busy === "apply" ? "שומר…" : "שמור"}</button>
            <button type="button" disabled={busy !== null} onClick={() => setPlan(null)} className="rounded-xl border border-neutral-200 text-sm px-4 py-2.5">תקן את מה שכתבתי</button>
          </div>
        </div>
      )}
      {msg && <p className="text-xs text-teal-800">{msg}</p>}
    </div>
  );
}
