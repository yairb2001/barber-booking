"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { C, Btn, useCrm, crmAction, STAGE_TONE } from "../ui";

/**
 * One chat on Chator's WhatsApp (10.10.2026). Writing here sends from
 * Chator's number and pauses the agent in this chat for 24 hours; "החזר
 * לסוכן" lets it answer again.
 */
type Msg = { id: string; role: "user" | "assistant"; content: string; source: string | null; createdAt: string };
type Data = { chat: { id: string; phone: string; name: string | null; paused: boolean; lead: { id: string; name: string | null; stage: string; businessName: string | null; businessId: string | null } | null }; messages: Msg[] };
const time = (iso: string) => new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });

export default function ChatThread({ id }: { id: string }) {
  const { data, error, reload } = useCrm<Data>(`view=chat&id=${encodeURIComponent(id)}`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  // Scroll the chat itself to the latest message (scrollIntoView would also shift the sheet).
  useEffect(() => {
    let el = end.current?.parentElement ?? null;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    if (el) el.scrollTop = el.scrollHeight; else window.scrollTo(0, document.body.scrollHeight);
  }, [data?.messages.length]);
  useEffect(() => { const t = setInterval(() => void reload(), 15000); return () => clearInterval(t); }, [reload]);

  async function send() {
    if (!text.trim()) return;
    setBusy(true); setNote(null);
    const r = await crmAction({ action: "chat.send", id, body: text });
    setBusy(false);
    if (r.ok) { setText(""); await reload(); } else setNote(r.error ?? "לא נשלח");
  }
  async function agent(on: boolean) {
    setBusy(true);
    await crmAction({ action: "chat.agent", id, on });
    setBusy(false);
    await reload();
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;
  const { chat, messages } = data;
  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="m-0 text-xl font-extrabold truncate">{chat.name || chat.phone}</h1>
          <span className="text-sm" style={{ color: C.muted }}>{[chat.phone, chat.lead?.businessName].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {chat.lead && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: C.soft, borderInlineStart: `3px solid ${STAGE_TONE[chat.lead.stage]?.accent ?? C.line}` }}>{STAGE_TONE[chat.lead.stage]?.label ?? chat.lead.stage}</span>}
          {chat.lead && <Link href={`/admin/crm/leads/${chat.lead.id}`} className="text-sm font-semibold" style={{ color: C.petrol }}>כרטיס המכירה</Link>}
          {chat.lead?.businessId && <Link href={`/admin/crm/customers/${chat.lead.businessId}`} className="text-sm font-semibold" style={{ color: C.petrol }}>כרטיס הלקוח</Link>}
          <a href={`tel:${chat.phone}`} className="text-sm font-semibold" style={{ color: C.petrol }}>חייג</a>
        </div>
      </header>

      <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[13px]" style={{ background: chat.paused ? "#FFF1D6" : C.mist, color: chat.paused ? "#7A4A00" : C.petrol }}>
        <span>{chat.paused ? "הסוכן מושהה בשיחה הזו, אתה עונה." : "הסוכן עונה בשיחה הזו."}</span>
        <button type="button" disabled={busy} onClick={() => agent(chat.paused)} className="font-semibold underline">{chat.paused ? "החזר לסוכן" : "השהה את הסוכן"}</button>
      </div>

      <div className="flex flex-col gap-1.5">
        {messages.length === 0 && <p className="text-sm" style={{ color: C.muted }}>אין הודעות.</p>}
        {messages.map(m => {
          const mine = m.role === "assistant";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[82%] rounded-2xl px-3 py-2 text-[14px] whitespace-pre-line" style={mine ? { background: m.source === "admin" ? "#DDF3EA" : "#fff", border: `1px solid ${C.line}` } : { background: C.petrol, color: "#fff" }}>
                {m.content}
                <div className="text-[10px] mt-1 opacity-70">{mine ? (m.source === "admin" ? "אתה" : "הסוכן") : "הוא"} · {time(m.createdAt)}</div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>

      <div className="flex gap-2 items-end sticky bottom-0 pt-2" style={{ background: C.ground }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="כתוב הודעה מהמספר של צ'אטור" className="flex-1 rounded-xl px-3 py-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
        <Btn kind="dark" disabled={busy || !text.trim()} onClick={send}>{busy ? "…" : "שלח"}</Btn>
      </div>
      {note && <p className="m-0 text-xs text-red-700">{note}</p>}
      <p className="m-0 text-[11px]" style={{ color: C.muted }}>הודעה שאתה שולח משהה את הסוכן בשיחה ל־24 שעות.</p>
    </div>
  );
}
