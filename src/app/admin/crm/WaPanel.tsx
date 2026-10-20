"use client";

import { useEffect, useRef } from "react";
import { C } from "./ui";
import { Composer, MsgBody, type VoiceTarget } from "./Composer";

/**
 * The WhatsApp conversation with Chator's line inside a lead or customer card
 * (15.10.2026, Yair: "לחצן וואטסאפ, שאני לוחץ עליו הוא פותח את השיחה בתוך
 * הכרטיס ושאני לוחץ שוב הוא סוגר"). Closed until the button opens it.
 */
export type WaMsg = { id: string; role: string; content: string; source: string | null; createdAt: string; mediaUrl?: string | null; mediaType?: string | null };

const time = (iso: string) => new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
const GREEN = "#1F7A4D";

export function WaButton({ open, onClick, count, waiting }: { open: boolean; onClick: () => void; count: number; waiting: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className="min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center gap-2"
      style={open ? { background: GREEN, color: "#fff", border: `1px solid ${GREEN}` } : { background: "#E7F8EE", color: GREEN, border: "1px solid #9ED9B6" }}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
      {open ? "סגור וואטסאפ" : "וואטסאפ"}
      {!open && count > 0 && <span className="text-xs font-semibold" style={{ opacity: 0.75 }}>{count}</span>}
      {!open && waiting && <span className="w-2 h-2 rounded-full" style={{ background: C.coral }} title="ממתין לתשובה" />}
    </button>
  );
}

export function WaPanel({ status, messages, who, placeholder, onSend, name, voice, onSent }: {
  status?: React.ReactNode;
  messages: WaMsg[];
  who: (m: WaMsg) => string;
  placeholder: string;
  onSend: (text: string) => Promise<boolean>;
  /** For {שם} in the quick replies. */
  name?: string | null;
  /** Where a recorded voice note goes (20.10.2026). */
  voice?: VoiceTarget | null;
  onSent?: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // Opened (or a new message) → the latest at the bottom, like WhatsApp.
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length]);

  return (
    <section aria-label="שיחת וואטסאפ" className="rounded-[18px] p-4 flex flex-col gap-2.5" style={{ background: "#EFE9E1" }}>
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h2 className="m-0 text-base font-bold">וואטסאפ · המספר של צ׳אטור</h2>
        {status}
      </div>
      <div ref={list} className="flex flex-col gap-2 max-h-[560px] overflow-y-auto">
        {messages.length === 0 && <p className="m-0 text-sm text-center py-6" style={{ color: "#6B7F80" }}>עוד אין הודעות בשיחה הזאת.</p>}
        {messages.map(m => {
          const mine = m.role !== "user";
          return (
            <div key={m.id} className="flex" style={{ justifyContent: mine ? "flex-start" : "flex-end" }}>
              <div className="max-w-[78%] rounded-[14px] px-3 py-2 flex flex-col gap-0.5" style={{ background: mine ? "#D9FDD3" : "#fff", boxShadow: "0 1px 0 rgba(0,0,0,0.06)" }}>
                <span className="text-[11px] font-bold" style={{ color: mine ? "#0F6B4F" : "#7A4A00" }}>{who(m)}</span>
                <MsgBody content={m.content} mediaUrl={m.mediaUrl} mediaType={m.mediaType} mine={mine} />
                <span className="text-[11px] self-end" style={{ color: "#6B7F80" }}>{time(m.createdAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <Composer placeholder={placeholder} name={name} onSend={onSend} voice={voice} onSent={onSent} />
    </section>
  );
}
