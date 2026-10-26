"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { C, useCrm, crmAction, STAGE_TONE } from "../ui";
import { bumpBell } from "../HomeParts";
import { Composer, MsgBody } from "../Composer";
import ReportSheet from "../../chats/ReportSheet";

/**
 * One chat on Chator's WhatsApp (10.10.2026). Writing here sends from
 * Chator's number and pauses the agent in this chat for 24 hours; "החזר
 * לסוכן" lets it answer again. An Instagram DM (12.10) answers from
 * @chator.il, only within 24h of the customer's last message; the sales
 * agent answers there only when settings.instagram.agent allows this person.
 *
 * Laid out like the shop's chat (13.10.2026, Yair: "למעלה תמיד את הפרטים של
 * הלקוח, כרטיס הליד אם יש, כרטיס לקוח אם יש"): the person and his cards stay
 * on top, the messages scroll in the middle, the reply box stays at the bottom.
 * Nothing is wider than the screen (it used to slide sideways on the phone).
 */
type Msg = { id: string; role: "user" | "assistant"; content: string; source: string | null; createdAt: string; mediaUrl?: string | null; mediaType?: string | null };
type Data = { seen?: number; chat: { id: string; channel: "whatsapp" | "instagram"; agent: boolean; phone: string; name: string | null; paused: boolean; handledAt?: string | null; lead: { id: string; name: string | null; stage: string; businessName: string | null; businessId: string | null } | null }; messages: Msg[]; reported?: { messageId: string; status: string }[] };
const time = (iso: string) => new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
const pill = "shrink-0 inline-flex items-center h-8 px-3 rounded-full text-[13px] font-semibold whitespace-nowrap";

export default function ChatThread({ id, onBack }: { id: string; onBack?: () => void }) {
  const { data, error, reload } = useCrm<Data>(`view=chat&id=${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Report what Chator's agent wrote here, like a shop reports its own (26.10.2026).
  const [reportOpen, setReportOpen] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  // Newest message in view whenever the thread grows.
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [data?.messages.length]);
  useEffect(() => { const t = setInterval(() => void reload(), 15000); return () => clearInterval(t); }, [reload]);
  // The server marked this chat's alerts read: refresh the bell now, not on the next screen change.
  useEffect(() => { if (data?.seen) bumpBell(); }, [data]);

  async function send(text: string) {
    setNote(null);
    const r = await crmAction({ action: "chat.send", id, body: text });
    if (r.ok) { await reload(); return true; }
    setNote(r.error ?? "לא נשלח");
    return false;
  }
  async function handled() {
    setBusy(true);
    await crmAction({ action: "chat.handled", id });
    setBusy(false);
    await reload();
  }
  // A personal chat (someone Yair knows, 27.10.2026): out of the lists, no agent, no follow-ups.
  async function hide() {
    if (!confirm("להסתיר את השיחה? היא תצא מהרשימות, והסוכן וההודעות האוטומטיות לא יכתבו לו. אפשר להחזיר אותה בכל רגע.")) return;
    setBusy(true);
    const r = await crmAction({ action: "chat.hide", id, on: true });
    setBusy(false);
    if (!r.ok) { setNote(r.error ?? "לא הצלחתי להסתיר"); return; }
    if (onBack) onBack(); else await reload();
  }
  async function agent(on: boolean) {
    setBusy(true);
    await crmAction({ action: "chat.agent", id, on });
    setBusy(false);
    await reload();
  }

  if (error) return <p className="p-4 text-red-700">{error}</p>;
  if (!data) return <p className="p-4" style={{ color: C.muted }}>טוען…</p>;
  const { chat, messages } = data;
  const ig = chat.channel === "instagram";
  const title = chat.name || chat.phone || "לקוח מאינסטגרם";
  // Waiting = he wrote last and it wasn't marked "טופל" since (13.10.2026).
  const lastMsg = messages[messages.length - 1];
  const waiting = lastMsg?.role === "user" && !(chat.handledAt && new Date(lastMsg.createdAt) <= new Date(chat.handledAt));
  const stage = chat.lead ? STAGE_TONE[chat.lead.stage] : null;
  const reportedIds = new Set((data.reported ?? []).map(r => r.messageId));

  return (
    <div className="flex flex-col h-full min-h-0 w-full overflow-hidden" style={{ background: C.ground }}>
      {/* Who he is and his cards: always on top. */}
      <header className="shrink-0 bg-white px-3 pt-2.5 pb-2" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-center gap-2.5 min-w-0">
          {onBack && (
            <button type="button" onClick={onBack} aria-label="חזרה לצ׳אטים" className="shrink-0 w-9 h-9 -ms-1 rounded-full inline-flex items-center justify-center" style={{ color: C.petrol }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          )}
          <span className="shrink-0 w-10 h-10 rounded-full inline-flex items-center justify-center font-bold" style={{ background: C.mist, color: C.petrol }}>{title.trim().charAt(0)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <b className="text-[16px] truncate" style={{ color: C.ink }}>{title}</b>
              {stage && <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: C.soft, color: C.petrol }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: stage.accent }} aria-hidden="true" />{stage.label}</span>}
            </div>
            <div className="text-[12px] truncate" style={{ color: C.muted }}>
              {ig ? "אינסטגרם" : <span dir="ltr">{chat.phone}</span>}{chat.lead?.businessName ? ` · ${chat.lead.businessName}` : ""}
            </div>
          </div>
          {!ig && chat.phone && (
            <a href={`tel:${chat.phone}`} aria-label="חייג" className="shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center" style={{ background: C.mist, color: C.petrol }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
            </a>
          )}
        </div>
        {(
          <div className="flex gap-1.5 mt-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {chat.lead && <Link href={`/admin/crm/leads/${chat.lead.id}`} className={pill} style={{ background: C.petrol, color: "#fff", textDecoration: "none" }}>כרטיס הליד</Link>}
            {chat.lead?.businessId && <Link href={`/admin/crm/customers/${chat.lead.businessId}`} className={pill} style={{ border: `1px solid ${C.petrol}`, color: C.petrol, textDecoration: "none" }}>כרטיס הלקוח</Link>}
            {waiting && <button type="button" disabled={busy} onClick={() => void handled()} className={pill} style={{ background: "#E3F7EF", color: "#0F6B4F", border: "1px solid #BFE8D6" }} title="מסיר את הסימון האדום בלי לענות">✓ סמן טופל</button>}
            <button type="button" onClick={() => setReportOpen(true)} className={pill} style={{ border: `1px solid ${C.line}`, color: C.muted, background: "#fff" }} title="סמן תשובות של הסוכן שלא אהבת, ומה לא היה בסדר">דווח על השיחה</button>
            <button type="button" disabled={busy} onClick={() => void hide()} className={pill} style={{ border: `1px solid ${C.line}`, color: C.muted, background: "#fff" }} title="שיחה אישית: יוצאת מהרשימות, בלי סוכן ובלי הודעות אוטומטיות">הסתר</button>
          </div>
        )}
      </header>

      {/* Who answers in this chat. */}
      {ig && !chat.agent ? (
        <div className="shrink-0 px-3 py-1.5 text-[12px]" style={{ background: "#FFF1D6", color: "#7A4A00" }}>באינסטגרם הסוכן לא עונה בשיחה הזו. אתה עונה.</div>
      ) : (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 text-[12px]" style={{ background: chat.paused ? "#FFF1D6" : C.mist, color: chat.paused ? "#7A4A00" : C.petrol }}>
          <span className="min-w-0 truncate">{chat.paused ? "טיפול אנושי: הסוכן מושהה, אתה עונה." : "הסוכן עונה בשיחה הזו."}</span>
          <button type="button" disabled={busy} onClick={() => agent(chat.paused)} className="shrink-0 font-semibold underline">{chat.paused ? "החזר לסוכן" : "העבר לטיפול אנושי"}</button>
        </div>
      )}

      {/* The messages: the only part that scrolls. */}
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-3 flex flex-col gap-1.5">
        {messages.length === 0 && <p className="text-sm text-center" style={{ color: C.muted }}>אין הודעות.</p>}
        {messages.map(m => {
          const mine = m.role === "assistant";
          return (
            <div key={m.id} className={`flex min-w-0 ${mine ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[82%] min-w-0 rounded-2xl px-3 py-2 text-[14px] whitespace-pre-line [overflow-wrap:anywhere]" style={mine ? { background: m.source === "admin" ? "#DDF3EA" : "#fff", border: `1px solid ${C.line}`, color: C.ink } : { background: C.petrol, color: "#fff" }}>
                <div className="flex flex-col gap-1"><MsgBody content={m.content} mediaUrl={m.mediaUrl} mediaType={m.mediaType} mine={mine} /></div>
                <div className="text-[10px] mt-1 opacity-70">{mine ? (m.source === "admin" ? "אתה" : "הסוכן") : "הוא"} · {time(m.createdAt)}{reportedIds.has(m.id) ? " · דיווחת ✓" : ""}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply: always at the bottom. */}
      <div className="shrink-0 bg-white px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]" style={{ borderTop: `1px solid ${C.line}` }}>
        {note && <p className="m-0 mb-1.5 text-xs text-red-700">{note}</p>}
        <Composer placeholder={ig ? "הודעה מהאינסטגרם של צ'אטור" : "הודעה מהמספר של צ'אטור"} name={chat.name} onSend={send} voice={ig ? null : { to: "chat", id: chat.id }} onSent={() => void reload()} />
        <p className="m-0 mt-1 text-[11px]" style={{ color: C.muted }}>{ig ? "באינסטגרם אפשר לענות עד 24 שעות אחרי ההודעה האחרונה שלו. " : ""}הודעה שאתה שולח משהה את הסוכן בשיחה ל־24 שעות.</p>
      </div>
      {reportOpen && (
        <ReportSheet conversationId={chat.id} messages={messages} reported={Object.fromEntries((data.reported ?? []).map(r => [r.messageId, r.status]))}
          onClose={() => setReportOpen(false)} onSent={() => void reload()}
          submit={p => crmAction({ action: "chat.report", ...p })}
          doneText="נכנס לתור הדיווחים. סוכן התיקונים יכין תיקון, וכשיאושר הוא עולה." />
      )}
    </div>
  );
}
