"use client";

import { useState, useEffect, useCallback } from "react";

type Suggestion = {
  id: string;
  type: string;
  klass: "prompt" | "code" | "data" | "ops";
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  conversationId: string | null;
  proposedFix: string | null;
  status: "pending" | "applied" | "flagged" | "rejected";
  createdAt: string;
};

const SEV: Record<string, { dot: string; ring: string; label: string }> = {
  high:   { dot: "bg-red-500",    ring: "border-red-200",    label: "דחוף" },
  medium: { dot: "bg-amber-500",  ring: "border-amber-200",  label: "בינוני" },
  low:    { dot: "bg-neutral-400", ring: "border-neutral-200", label: "קל" },
};
const KLASS: Record<string, { label: string; note: string; color: string }> = {
  prompt: { label: "פרומט", note: "אישור → נכנס מיד לפרומט (הפיך)", color: "bg-teal-50 text-teal-700" },
  code:   { label: "קוד",   note: "אישור → יסומן למפתח (לא נכנס לבד)", color: "bg-purple-50 text-purple-700" },
  data:   { label: "דאטה",  note: "אישור → יסומן לטיפול", color: "bg-blue-50 text-blue-700" },
  ops:    { label: "תפעול", note: "אישור → יסומן לטיפול", color: "bg-neutral-100 text-neutral-600" },
};
const STATUS_LABEL: Record<string, string> = { applied: "✅ הוחל", flagged: "🛠️ נשלח למפתח", rejected: "✕ נדחה" };

export default function QaPage() {
  const [pending, setPending] = useState<Suggestion[]>([]);
  const [resolved, setResolved] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/qa/suggestions");
      const d = await r.json();
      setPending(d.pending ?? []);
      setResolved(d.resolved ?? []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: "approve" | "reject" | "undo") => {
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/qa/suggestions/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (!r.ok) { setToast(d.error || "שגיאה"); return; }
      if (d.applied) setToast("התיקון נכנס לפרומט ✅");
      else if (d.flagged) setToast("סומן למפתח 🛠️");
      else if (d.reverted) setToast("בוטל — הפרומט שוחזר");
      else if (action === "reject") setToast("נדחה");
      await load();
    } catch { setToast("שגיאת רשת"); }
    finally { setBusy(null); setTimeout(() => setToast(null), 3000); }
  };

  return (
    <div className="p-4 sm:p-6 overflow-auto h-full max-w-2xl">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-900">בקרת איכות</h1>
        <p className="text-sm text-neutral-500 mt-1">
          בעיות שסוכן ה-QA מצא בסוכן התורים. אשר תיקון — והוא נכנס.
        </p>
      </header>

      {loading ? (
        <p className="text-neutral-400 text-sm">טוען…</p>
      ) : pending.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-6 text-center">
          <p className="text-neutral-600">אין כרגע הצעות לאישור 🎉</p>
          <p className="text-xs text-neutral-400 mt-1">כשה-QA ימצא משהו, זה יופיע כאן.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map(s => {
            const sev = SEV[s.severity] ?? SEV.medium;
            const kl = KLASS[s.klass] ?? KLASS.ops;
            return (
              <div key={s.id} className={`rounded-xl border ${sev.ring} bg-white p-4 shadow-sm`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${sev.dot}`} />
                  <span className="font-semibold text-neutral-900">{s.type}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${kl.color}`}>{kl.label}</span>
                </div>
                <p className="text-sm text-neutral-800">{s.title}</p>
                <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{s.detail}</p>
                {s.proposedFix && (
                  <div className="mt-2 rounded-lg bg-neutral-50 border border-neutral-100 p-2.5">
                    <p className="text-[11px] text-neutral-400 mb-1">ההצעה:</p>
                    <p className="text-xs text-neutral-700 whitespace-pre-wrap leading-relaxed">{s.proposedFix}</p>
                  </div>
                )}
                <p className="text-[11px] text-neutral-400 mt-2">{kl.note}</p>
                <div className="flex gap-2 mt-3">
                  <button
                    disabled={busy === s.id}
                    onClick={() => act(s.id, "approve")}
                    className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg py-2 transition-colors"
                  >
                    {s.klass === "prompt" ? "אשר והחל" : "אשר וסמן"}
                  </button>
                  <button
                    disabled={busy === s.id}
                    onClick={() => act(s.id, "reject")}
                    className="px-4 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-50 text-neutral-700 text-sm font-medium rounded-lg py-2 transition-colors"
                  >
                    דחה
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {resolved.length > 0 && (
        <details className="mt-6">
          <summary className="text-sm text-neutral-500 cursor-pointer">היסטוריה ({resolved.length})</summary>
          <div className="space-y-2 mt-3">
            {resolved.map(s => (
              <div key={s.id} className="rounded-lg border border-neutral-100 bg-neutral-50 p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-neutral-700 truncate">{s.type} — {s.title}</p>
                  <p className="text-[11px] text-neutral-400">{STATUS_LABEL[s.status] ?? s.status}</p>
                </div>
                {s.status === "applied" && s.klass === "prompt" && (
                  <button
                    disabled={busy === s.id}
                    onClick={() => act(s.id, "undo")}
                    className="shrink-0 text-xs text-teal-700 hover:underline disabled:opacity-50"
                  >
                    בטל
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {toast && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 bg-neutral-900 text-white text-sm px-4 py-2 rounded-full shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
