"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

/**
 * The notification center (10.10.2026, Yair: "שם יהיה כל מה שעד כה נשלח
 * אליי לווצאפ"): the agent's questions (answered here), escalations, swap and
 * late-arrival requests (answered with a button), day closures, reports and
 * system alerts. Bookings and cancellations are not here; they stay push.
 */
type Item = { id: string; kind: string; title: string; body: string | null; href: string | null; at: string; read: boolean; done: boolean; questionId: string | null; ask: string | null };
type Question = { id: string; question: string; customerName: string | null; customerPhone: string; at: string };
type Row = { key: string; at: string; tag: string; tone: string; title: string; body: string | null; href: string | null; unread: boolean; id: string; ask: string | null; done: boolean };

const TAG: Record<string, [string, string]> = {
  agent_question: ["שאלה", "bg-amber-50 text-amber-700"],
  escalation: ["טיפול אנושי", "bg-red-50 text-red-700"],
  swap: ["החלפה / איחור", "bg-sky-50 text-sky-700"],
  closure: ["סגירת יום", "bg-indigo-50 text-indigo-700"],
  report: ["דוח", "bg-emerald-50 text-emerald-700"],
  system: ["תקלה", "bg-red-50 text-red-700"],
  account: ["החשבון שלי", "bg-teal-50 text-teal-700"],
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.round(m / 60);
  if (h < 24) return `לפני ${h} ש׳`;
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" });
};

function QuestionCard({ q, focus, onDone }: { q: Question; focus: boolean; onDone: () => void }) {
  const [answer, setAnswer] = useState("");
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function post(body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin/notification-center", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) onDone(); else setErr((await r.json().catch(() => ({}))).error || "לא נשלח");
  }
  return (
    <div id={`q-${q.id}`} className={`bg-white rounded-2xl border p-4 space-y-2 ${focus ? "border-amber-400 ring-2 ring-amber-200" : "border-amber-200"}`}>
      <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
        <span>{q.customerName || q.customerPhone} שאל את הסוכן</span><span>{ago(q.at)}</span>
      </div>
      <p className="text-sm font-semibold text-neutral-800">״{q.question}״</p>
      <textarea value={answer} onChange={e => setAnswer(e.target.value)} rows={2} placeholder="מה לענות? התשובה תישלח אליו בוואטסאפ" className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
      <label className="flex items-center gap-2 text-xs text-neutral-600">
        <input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} className="accent-teal-600" />
        לשמור, כדי שהסוכן יענה על זה לבד בפעם הבאה
      </label>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !answer.trim()} onClick={() => post({ action: "answer", questionId: q.id, answer, save })} className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold disabled:opacity-50">{busy ? "שולח..." : "שלח ללקוח"}</button>
        <button type="button" disabled={busy} onClick={() => post({ action: "dismiss", questionId: q.id })} className="px-3 py-2 rounded-xl text-sm text-neutral-500">לא רלוונטי</button>
      </div>
    </div>
  );
}

function CenterInner() {
  const router = useRouter();
  const focusQ = useSearchParams().get("q");
  const [items, setItems] = useState<Item[] | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const c = await fetch("/api/admin/notification-center", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    setItems(c?.items ?? []);
    setQuestions(c?.questions ?? []);
    // Opening the screen = seen (the badge clears).
    if (c?.unread) await fetch("/api/admin/notification-center", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "readAll" }) }).catch(() => {});
    window.dispatchEvent(new Event("center:read"));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (focusQ && questions.length) document.getElementById(`q-${focusQ}`)?.scrollIntoView({ block: "center" }); }, [focusQ, questions]);

  if (!items) return <div className="p-8 text-center text-neutral-400">טוען...</div>;

  const rows: Row[] = items
    .filter(i => !(i.kind === "agent_question" && !i.done))
    .map(i => ({ key: i.id, id: i.id, at: i.at, tag: TAG[i.kind]?.[0] ?? "עדכון", tone: TAG[i.kind]?.[1] ?? "bg-neutral-100 text-neutral-600", title: i.title, body: i.body, href: i.href && !i.href.startsWith("/admin/notifications") ? i.href : null, unread: !i.read, ask: i.ask, done: i.done }));

  async function reply(id: string, yes: boolean) {
    setBusy(id); setErr(null);
    const r = await fetch("/api/admin/notification-center", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reply", id, yes }) });
    setBusy(null);
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error || "לא נשלח");
    await load();
  }

  return (
    <div className="p-4 sm:p-8 overflow-auto h-full">
      <div className="max-w-2xl space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">התראות</h1>
            <p className="text-neutral-500 text-sm mt-1">כל מה שהיה מגיע אליך בוואטסאפ, במקום אחד</p>
          </div>
          <Link href="/admin/settings/notifications" className="text-sm text-teal-700 shrink-0">איך זה מגיע אליי ←</Link>
        </div>

        {questions.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-neutral-700">שאלות שהסוכן לא ידע ({questions.length})</h2>
            {questions.map(q => <QuestionCard key={q.id} q={q} focus={q.id === focusQ} onDone={() => void load()} />)}
          </section>
        )}

        {err && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{err}</p>}
        <section className="bg-white rounded-2xl border border-neutral-200 divide-y divide-neutral-100">
          {rows.length === 0 && <p className="p-5 text-sm text-neutral-500">אין עדיין התראות.</p>}
          {rows.map(r => {
            const waiting = !!r.ask && !r.done;
            const inner = (
              <div className={`flex items-start gap-3 px-4 py-3 ${r.unread || waiting ? "bg-teal-50/40" : ""}`}>
                <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full mt-0.5 ${r.tone}`}>{r.tag}</span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm ${r.unread || waiting ? "font-semibold text-neutral-900" : "text-neutral-800"}`}>{r.title}</span>
                  {r.body && <span className={`block text-xs text-neutral-500 mt-0.5 whitespace-pre-line ${waiting ? "" : "line-clamp-3"}`}>{r.body}</span>}
                  {waiting && (
                    <span className="flex gap-2 mt-2">
                      <button type="button" disabled={!!busy} onClick={e => { e.stopPropagation(); void reply(r.id, true); }} className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-semibold disabled:opacity-50">{busy === r.id ? "..." : "מאשר"}</button>
                      <button type="button" disabled={!!busy} onClick={e => { e.stopPropagation(); void reply(r.id, false); }} className="px-4 py-1.5 rounded-lg border border-neutral-300 text-neutral-700 text-sm disabled:opacity-50">לא מאשר</button>
                    </span>
                  )}
                  {r.ask && r.done && <span className="block text-[11px] text-emerald-600 mt-1">נענה</span>}
                </span>
                <span className="shrink-0 text-[11px] text-neutral-400 mt-0.5">{ago(r.at)}</span>
              </div>
            );
            return r.href && !waiting
              ? <button key={r.key} type="button" onClick={() => router.push(r.href!)} className="block w-full text-right">{inner}</button>
              : <div key={r.key}>{inner}</div>;
          })}
        </section>
      </div>
    </div>
  );
}

export default function NotificationCenterPage() {
  return <Suspense fallback={<div className="p-8 text-center text-neutral-400">טוען...</div>}><CenterInner /></Suspense>;
}
