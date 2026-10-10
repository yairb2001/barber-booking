"use client";

import { useEffect, useState } from "react";

/**
 * "Something you didn't like?" (10.10.2026). The owner tells us what the agent
 * did wrong, optionally pointing at a conversation. A daily review turns these
 * into fixes, which Chator approves before they reach the agent.
 */
type Fb = { id: string; text: string; status: string; at: string; conversationId: string | null };
type Conv = { id: string; name: string; at: string | null; last: string };
const STATUS: Record<string, string> = { new: "התקבל", in_review: "בבדיקה", applied: "טופל", dismissed: "נסגר" };

export default function AgentFeedbackCard() {
  const [items, setItems] = useState<Fb[]>([]);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [text, setText] = useState("");
  const [conv, setConv] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = () => fetch("/api/admin/agent/feedback", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => { if (j) { setItems(j.items); setConvs(j.conversations); } }).catch(() => {});
  useEffect(() => { void load(); }, []);

  async function send() {
    setBusy(true); setNote(null);
    const r = await fetch("/api/admin/agent/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, conversationId: conv || null }) });
    setBusy(false);
    if (r.ok) { setText(""); setConv(""); setNote("תודה. נבדוק ונתקן, ותראה כאן מתי זה טופל."); void load(); }
    else setNote((await r.json().catch(() => ({}))).error || "לא נשלח");
  }

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" }) : "");
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-3">
      <div>
        <h2 className="font-semibold text-neutral-800">משהו שלא אהבת אצל הסוכן?</h2>
        <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">כתוב מה הוא עשה ומה היית רוצה במקום. אפשר לבחור שיחה מסוימת. אנחנו עוברים על זה כל יום ומתקנים.</p>
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder='למשל: "הוא הציע ללקוח תור אצל ספר אחר בלי לשאול, אני רוצה שישאל קודם"' className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
      <select value={conv} onChange={e => setConv(e.target.value)} className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white">
        <option value="">על שיחה מסוימת? (לא חובה)</option>
        {convs.map(c => <option key={c.id} value={c.id}>{c.name} · {when(c.at)} · {c.last}</option>)}
      </select>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy || !text.trim()} onClick={send} className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold disabled:opacity-50">{busy ? "שולח..." : "שלח"}</button>
        {note && <span className="text-xs text-teal-700">{note}</span>}
      </div>
      {items.length > 0 && (
        <details className="rounded-xl border border-neutral-200 px-3 py-2">
          <summary className="text-sm text-neutral-700 cursor-pointer">ההערות שלך ({items.length})</summary>
          <ul className="mt-2 space-y-2">
            {items.map(f => (
              <li key={f.id} className="text-sm">
                <div className="flex justify-between gap-2 text-[11px] text-neutral-400"><span>{when(f.at)}{f.conversationId ? " · על שיחה" : ""}</span><span className={f.status === "applied" ? "text-emerald-600 font-semibold" : ""}>{STATUS[f.status] ?? f.status}</span></div>
                <p className="text-neutral-700 whitespace-pre-line">{f.text}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
