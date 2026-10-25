"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { C, useCrm, crmAction, PageHead, ago } from "../ui";
import { AreaTabs } from "../Areas";
import { bumpBell } from "../HomeParts";
import { VoiceBubble } from "@/components/Voice";

/**
 * Requests from the shops (15.10.2026, Yair: "צאט של בקשות מה חסר לך או מה
 * היית רוצה לשנות... עוברים על זה כל יום"). Shops write or record on
 * /admin/requests; here every shop is one thread, new ones first. Opening a
 * thread marks it seen; a reply reaches the shop's notification center;
 * "טופל" marks a single request handled (the shop sees "✓ טופל").
 */
type Thread = { businessId: string; name: string; last: string; lastFromChator: boolean; at: string; unseen: number; open: number; total: number };
type Item = { id: string; fromChator: boolean; author: string | null; body: string | null; audioUrl: string | null; audioSecs: number | null; at: string; done: boolean };
const when = (iso: string) => new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });

function RequestsInner() {
  const router = useRouter();
  const open = useSearchParams().get("b");
  const { data, reload } = useCrm<{ threads: Thread[] }>("view=requests");
  const choose = (id: string | null) => router.replace(id ? `/admin/crm/requests?b=${id}` : "/admin/crm/requests", { scroll: false });

  return (
    <div>
      <PageHead title="לקוחות" sub="פניות מהעסקים: מה חסר להם ומה לשנות, בכתב או בהקלטה. חדשות למעלה." />
      <div className="mb-4"><AreaTabs /></div>
      <div className="grid md:grid-cols-[320px_1fr] gap-4">
        <div className={`${open ? "hidden md:block" : ""} rounded-2xl bg-white overflow-hidden`} style={{ border: `1px solid ${C.line}` }}>
          {!data && <p className="p-4 text-sm" style={{ color: C.muted }}>טוען…</p>}
          {data?.threads.length === 0 && <p className="p-4 text-sm" style={{ color: C.muted }}>עוד אין בקשות.</p>}
          {data?.threads.map(t => (
            <button key={t.businessId} type="button" onClick={() => choose(t.businessId)} className="w-full text-start px-4 py-3 flex items-start gap-3" style={{ borderBottom: `1px solid ${C.line}`, background: open === t.businessId ? C.mist : "#fff" }}>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <b className="text-[15px] truncate" style={{ color: C.ink }}>{t.name}</b>
                  {t.unseen > 0 && <span className="shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold" style={{ background: C.turquoise, color: C.ink }}>{t.unseen}</span>}
                </span>
                <span className="block text-[13px] truncate mt-0.5" style={{ color: C.muted }}>{t.lastFromChator ? "אתה: " : ""}{t.last}</span>
                <span className="block text-[11px] mt-0.5" style={{ color: C.muted }}>{ago(t.at)} · {t.open > 0 ? `${t.open} פתוחות` : "הכל טופל"}</span>
              </span>
            </button>
          ))}
        </div>
        {open ? <ThreadView id={open} onBack={() => choose(null)} onChange={() => { void reload(); bumpBell(); }} /> : (
          <div className="hidden md:flex items-center justify-center rounded-2xl bg-white text-sm" style={{ border: `1px solid ${C.line}`, color: C.muted, minHeight: 240 }}>בחר עסק מהרשימה</div>
        )}
      </div>
    </div>
  );
}

function ThreadView({ id, onBack, onChange }: { id: string; onBack: () => void; onChange: () => void }) {
  const { data, error, reload } = useCrm<{ business: { id: string; name: string }; items: Item[] }>(`view=requestThread&id=${encodeURIComponent(id)}`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const end = useRef<HTMLDivElement | null>(null);
  // Opening it marked the shop's requests seen: refresh the counters.
  useEffect(() => { if (data) onChange(); }, [data?.business.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [data?.items.length]);

  async function reply() {
    if (!text.trim()) return;
    setBusy(true); setNote(null);
    const r = await crmAction({ action: "request.reply", businessId: id, body: text });
    setBusy(false);
    if (r.ok) { setText(""); await reload(); onChange(); } else setNote(r.error ?? "לא נשלח");
  }
  // A draft from the system guide (many requests already exist); edited before sending.
  async function draft() {
    setDrafting(true); setNote(null);
    const r = await crmAction({ action: "request.draft", businessId: id });
    setDrafting(false);
    if (r.ok && typeof r.draft === "string") setText(t => (t.trim() ? `${t.trim()}\n\n${r.draft}` : (r.draft as string)));
    else setNote(r.error ?? "לא הצלחתי לנסח");
  }
  async function done(itemId: string) {
    const r = await crmAction({ action: "request.done", id: itemId });
    if (r.ok) { await reload(); onChange(); }
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;
  return (
    <div className="rounded-2xl bg-white flex flex-col min-h-[420px]" style={{ border: `1px solid ${C.line}` }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <button type="button" onClick={onBack} className="md:hidden w-9 h-9 -ms-1 rounded-full inline-flex items-center justify-center" style={{ color: C.petrol }} aria-label="חזרה לרשימה">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
        </button>
        <b className="text-[16px]" style={{ color: C.ink }}>{data.business.name}</b>
      </div>
      <div className="flex-1 px-4 py-3 space-y-2 overflow-y-auto max-h-[60vh]">
        {data.items.map(m => (
          <div key={m.id} className={`flex ${m.fromChator ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[85%] rounded-2xl px-3 py-2 text-[14px]" style={m.fromChator ? { background: C.mist, color: C.ink } : { background: "#fff", border: `1px solid ${C.line}`, color: C.ink }}>
              <div className="text-[11px] font-semibold mb-0.5" style={{ color: C.petrol }}>{m.fromChator ? "אתה" : m.author || "העסק"}</div>
              {m.audioUrl && <div className="min-w-[210px]"><VoiceBubble src={m.audioUrl} /></div>}
              {m.body && <p className="whitespace-pre-line [overflow-wrap:anywhere]">{m.body}</p>}
              <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: C.muted }}>
                <span>{when(m.at)}</span>
                {!m.fromChator && (
                  <button type="button" onClick={() => void done(m.id)} className="font-semibold underline" style={{ color: m.done ? "#0F6B4F" : C.petrol }}>{m.done ? "✓ טופל" : "סמן טופל"}</button>
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="px-3 py-2" style={{ borderTop: `1px solid ${C.line}` }}>
        {note && <p className="text-xs text-red-700 mb-1">{note}</p>}
        <div className="flex gap-2 items-end">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={text.length > 120 ? 6 : 2} placeholder={`תשובה ל${data.business.name}`} className="flex-1 min-w-0 rounded-xl px-3 py-2 text-[15px] resize-y" style={{ border: "1px solid #C7D8D5" }} />
          <button type="button" onClick={() => void reply()} disabled={busy || !text.trim()} className="shrink-0 h-10 px-4 rounded-full text-sm font-semibold text-white disabled:opacity-40" style={{ background: C.petrol }}>{busy ? "…" : "שלח"}</button>
        </div>
        <div className="flex items-center justify-between gap-2 mt-1.5">
          <button type="button" onClick={() => void draft()} disabled={drafting} className="text-[13px] font-semibold rounded-full px-3 py-1.5 disabled:opacity-50" style={{ background: C.mist, color: C.petrol }}>{drafting ? "מנסח…" : "✨ הצע תשובה"}</button>
          <span className="text-[11px]" style={{ color: C.muted }}>התשובה מגיעה לעסק כהתראה.</span>
        </div>
      </div>
    </div>
  );
}

export default function RequestsPage() {
  return <Suspense fallback={null}><RequestsInner /></Suspense>;
}
