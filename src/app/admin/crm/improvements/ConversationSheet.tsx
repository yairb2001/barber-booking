"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { C, useCrm } from "../ui";

/**
 * The conversation a proposal came from, opened over the improvements screen
 * (15.10.2026, Yair: "בלחיצה שם שזה יפתח לי את השיחה הספציפית שאבין").
 * Read only. The message the proposal quotes is marked and scrolled to.
 */
type Msg = { id: string; role: string; content: string; source: string | null; createdAt: string };
type Data = { conversation: { id: string; businessId: string; businessName: string; name: string | null; phone: string }; messages: Msg[] };

const time = (iso: string) => new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
const who = (m: Msg) => (m.role === "user" ? "הלקוח" : m.source === "admin" ? "העסק" : "הסוכן");
/** Does this message hold the quote? Loosely: punctuation and "לקוח:" prefixes aside, the start of any quoted part. */
function quoted(content: string, evidence: string | null): boolean {
  if (!evidence) return false;
  const norm = (s: string) => s.replace(/["'״׳“”„.,!?:;()\-–—…]/g, " ").replace(/\s+/g, " ").trim();
  const c = norm(content);
  const parts = evidence.split(/["'“”„״׳‘’\n]|(?:הלקוח|לקוח|הסוכן|סוכן|בעל העסק)\s*:/).map(norm).filter(p => p.length >= 12);
  return parts.some(p => c.includes(p.slice(0, 30)));
}

export default function ConversationSheet({ id, evidence, onClose }: { id: string; evidence: string | null; onClose: () => void }) {
  const { data, error } = useCrm<Data>(`view=conversation&id=${id}`);
  const list = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  // Straight to the quoted message, else to the end.
  useEffect(() => {
    if (!data) return;
    if (mark.current) mark.current.scrollIntoView({ block: "center" });
    else if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [data]);

  const firstHit = data?.messages.findIndex(m => quoted(m.content, evidence)) ?? -1;
  return (
    <div className="fixed inset-0 z-50 font-heebo" dir="rtl" role="dialog" aria-modal="true" aria-label="השיחה">
      <div className="absolute inset-0" style={{ background: "rgba(11,31,33,0.45)" }} onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 top-8 md:inset-y-6 md:inset-x-auto md:start-auto md:end-6 md:w-[560px] rounded-t-[20px] md:rounded-[20px] flex flex-col overflow-hidden" style={{ background: "#EFE9E1" }}>
        <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ background: "#fff", borderBottom: `1px solid ${C.line}` }}>
          <div className="min-w-0">
            <div className="font-bold text-[15px] truncate">{data ? `${data.conversation.name ?? data.conversation.phone} · ${data.conversation.businessName}` : "השיחה"}</div>
            {data && <div className="text-xs" style={{ color: C.muted }}>{data.conversation.phone} · {data.messages.length} הודעות{firstHit >= 0 ? " · ההודעה מההצעה מסומנת" : ""}</div>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {data && <Link href={`/admin/crm/customers/${data.conversation.businessId}`} className="text-xs" style={{ color: C.petrol }}>לכרטיס העסק</Link>}
            <button type="button" onClick={onClose} aria-label="סגור" className="w-10 h-10 rounded-lg inline-flex items-center justify-center" style={{ color: C.ink }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>
        <div ref={list} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {error && <p className="text-red-700 text-sm">{error}</p>}
          {!data && !error && <p className="text-sm" style={{ color: C.muted }}>טוען…</p>}
          {data?.messages.map((m, i) => {
            const mine = m.role !== "user";
            const hit = i === firstHit;
            return (
              <div key={m.id} ref={hit ? mark : undefined} className="flex" style={{ justifyContent: mine ? "flex-start" : "flex-end" }}>
                <div className="max-w-[82%] rounded-[14px] px-3 py-2 flex flex-col gap-0.5" style={{ background: mine ? "#D9FDD3" : "#fff", boxShadow: "0 1px 0 rgba(0,0,0,0.06)", outline: hit ? `2px solid ${C.coral}` : undefined }}>
                  <span className="text-[11px] font-bold" style={{ color: mine ? "#0F6B4F" : "#7A4A00" }}>{who(m)}</span>
                  <span className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</span>
                  <span className="text-[11px] self-end" style={{ color: "#6B7F80" }}>{time(m.createdAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
