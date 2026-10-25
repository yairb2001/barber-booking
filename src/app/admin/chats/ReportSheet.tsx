"use client";

import { useEffect, useRef, useState } from "react";
import { REPORT_REASONS } from "@/lib/agent/report-reasons";

/**
 * "דווח על השיחה" (25.10.2026, Yair: "אני רוצה דיווח על צ'אט מסוים, ואז אני יכול
 * לבחור איזה הודעות לא אהבתי, ולהסביר מה לא אהבתי בהם"). The chat opens again
 * inside the sheet; tapping an agent message marks it and opens "מה לא היה בסדר"
 * under it (ready reasons + his words). One report for the whole chat goes to
 * /api/admin/agent/feedback, sorted at once and seen by Chator in the CRM.
 */
type Msg = { id: string; role: string; source: string | null; content: string; createdAt: string };
type Pick = { reasons: string[]; text: string };

const hm = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

export type ReportPayload = { conversationId: string; items: { messageId: string; reasons: string[]; text: string }[]; text: string };

export default function ReportSheet({ conversationId, messages, reported, onClose, onSent, submit, doneText }: {
  conversationId: string;
  messages: Msg[];
  /** Agent messages already reported in this chat. */
  reported: Record<string, string>;
  onClose: () => void;
  onSent: (ids: string[]) => void;
  /** Where the report goes; a shop's by default. Chator's CRM sends its own (26.10.2026). */
  submit?: (p: ReportPayload) => Promise<{ ok: boolean; error?: string }>;
  doneText?: string;
}) {
  const [picked, setPicked] = useState<Record<string, Pick>>({});
  const [general, setGeneral] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  // The latest messages first in view, like the chat itself.
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, []);

  const shown = messages.filter(m => m.role === "user" || m.role === "assistant").slice(-60);
  const isAgent = (m: Msg) => m.role === "assistant" && m.source !== "admin";
  const ids = Object.keys(picked);
  const ready = ids.length > 0 || general.trim().length > 0;

  const toggle = (id: string) => setPicked(p => { const n = { ...p }; if (n[id]) delete n[id]; else n[id] = { reasons: [], text: "" }; return n; });
  const setPick = (id: string, f: (x: Pick) => Pick) => setPicked(p => ({ ...p, [id]: f(p[id]) }));

  async function send() {
    setBusy(true); setErr(null);
    const items = ids.map(id => ({ messageId: id, reasons: picked[id].reasons, text: picked[id].text }));
    const payload = { conversationId, items, text: general };
    const r = submit
      ? await submit(payload)
      : await fetch("/api/admin/agent/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
          .then(async res => (res.ok ? { ok: true } : { ok: false, error: (await res.json().catch(() => null))?.error }))
          .catch(() => ({ ok: false, error: undefined as string | undefined }));
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "הדיווח לא נשלח, נסה שוב"); return; }
    setDone(true); onSent(ids);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="דיווח על השיחה" onClick={e => e.stopPropagation()} dir="rtl"
        className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl flex flex-col h-[92vh] sm:h-[85vh] overflow-hidden">
        {done ? (
          <div className="p-6 flex flex-col gap-4">
            <p className="text-lg font-bold text-slate-900">תודה, קיבלנו.</p>
            <p className="text-sm text-slate-600 leading-relaxed">{doneText ?? "הדיווח הגיע לצוות של צ'אטור עם השיחה כולה. כשנתקן, תקבל הודעה."}</p>
            <button type="button" onClick={onClose} className="h-12 rounded-xl bg-teal-600 text-white font-semibold">סגור</button>
          </div>
        ) : (
          <>
            <header className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
              <div>
                <p className="text-lg font-bold text-slate-900">דיווח על השיחה</p>
                <p className="text-sm text-slate-500 mt-0.5">סמן את ההודעות של הסוכן שלא אהבת, וכתוב מה לא היה בסדר בכל אחת.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="סגור" className="w-10 h-10 -mt-1 shrink-0 rounded-full text-slate-500 hover:bg-slate-100">✕</button>
            </header>

            <div ref={list} className="flex-1 overflow-y-auto px-4 py-3 bg-slate-50 flex flex-col gap-2">
              {shown.map(m => {
                if (!isAgent(m)) {
                  const mine = m.role === "assistant";
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <p className={`max-w-[75%] text-[13px] rounded-2xl px-3 py-1.5 whitespace-pre-wrap break-words ${mine ? "bg-teal-600/80 text-white" : "bg-white border border-slate-200 text-slate-500"}`}>{m.content}</p>
                    </div>
                  );
                }
                const p = picked[m.id];
                const was = reported[m.id];
                return (
                  <div key={m.id} className="flex flex-col items-end gap-1.5">
                    <button type="button" onClick={() => toggle(m.id)} aria-pressed={!!p}
                      className={`max-w-[85%] text-right rounded-2xl px-3 py-2 border-2 transition ${p ? "bg-amber-50 border-amber-400" : "bg-emerald-100 border-emerald-200 hover:border-emerald-400"}`}>
                      <span className="flex items-center justify-between gap-3 text-[11px] mb-0.5">
                        <span className={p ? "text-amber-800 font-semibold" : "text-emerald-700"}>{p ? "✓ סימנת" : "🤖 סוכן · לחץ כדי לסמן"}</span>
                        <span className="text-slate-400" dir="ltr">{hm(m.createdAt)}</span>
                      </span>
                      <span className="block text-sm text-slate-800 whitespace-pre-wrap break-words">{m.content}</span>
                      {was && !p && <span className="block text-[11px] text-emerald-700 mt-1">{was === "applied" ? "דיווחת ותוקן ✓" : "כבר דיווחת על ההודעה הזו"}</span>}
                    </button>
                    {p && (
                      <div className="w-[85%] bg-white rounded-2xl border border-amber-200 p-3 flex flex-col gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          {REPORT_REASONS.map(r => {
                            const on = p.reasons.includes(r);
                            return <button key={r} type="button" aria-pressed={on} onClick={() => setPick(m.id, x => ({ ...x, reasons: on ? x.reasons.filter(y => y !== r) : [...x.reasons, r] }))}
                              className={`min-h-[36px] px-3 rounded-full text-[13px] border ${on ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-slate-200 text-slate-700"}`}>{r}</button>;
                          })}
                        </div>
                        <textarea value={p.text} onChange={e => setPick(m.id, x => ({ ...x, text: e.target.value }))} rows={2} aria-label="מה לא היה בסדר בהודעה הזו"
                          placeholder="מה לא היה בסדר, ומה הוא היה צריך לענות?" className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <footer className="shrink-0 border-t border-slate-100 px-4 pt-3 pb-[max(14px,env(safe-area-inset-bottom))] flex flex-col gap-2 bg-white">
              <textarea value={general} onChange={e => setGeneral(e.target.value)} rows={1} aria-label="הערה כללית על השיחה"
                placeholder="משהו כללי על השיחה? (לא חובה)" className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              {err && <p className="text-xs text-red-600">{err}</p>}
              <button type="button" disabled={busy || !ready} onClick={() => void send()} className="h-12 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-semibold">
                {busy ? "שולח…" : ids.length ? `שלח דיווח (${ids.length === 1 ? "הודעה אחת" : `${ids.length} הודעות`})` : "שלח דיווח"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
