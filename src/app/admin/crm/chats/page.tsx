"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { C, PageHead, Tag, useCrm, ago, STAGE_TONE } from "../ui";

/** Chator's WhatsApp chats (10.10.2026, Yair: "צ'אטים בתפריט, בלי קבוצות"). */
type Chat = { id: string; phone: string; name: string | null; shop: string | null; leadId: string | null; stage: string | null; mode: string | null; at: string; last: { role: string; source: string | null; text: string } | null; waiting: boolean; paused: boolean };

export default function ChatsPage() {
  const { data, error, reload } = useCrm<{ chats: Chat[] }>("view=chats");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setInterval(() => void reload(), 30000); return () => clearInterval(t); }, [reload]);
  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;
  const list = data.chats.filter(c => !q.trim() || [c.name, c.phone, c.shop].some(x => (x ?? "").includes(q.trim())));
  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <PageHead title="צ׳אטים" sub={`השיחות בוואטסאפ של צ'אטור · ${data.chats.filter(c => c.waiting).length} מחכות לתשובה`} />
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי שם, טלפון או מספרה" className="h-11 rounded-xl px-3 text-[15px]" style={{ border: "1px solid #C7D8D5" }} />
      <section className="bg-white rounded-2xl" style={{ border: `1px solid ${C.line}` }}>
        {list.length === 0 && <p className="m-0 p-4 text-sm" style={{ color: C.muted }}>אין שיחות.</p>}
        {list.map((c, i) => (
          <Link key={c.id} href={`/admin/crm/chats/${c.id}`} className="flex items-start gap-3 px-3.5 py-3" style={{ borderTop: i ? `1px solid ${C.soft}` : undefined, color: C.ink, textDecoration: "none" }}>
            <span className="w-10 h-10 rounded-full shrink-0 inline-flex items-center justify-center font-bold" style={{ background: C.mist, color: C.petrol }}>{(c.name || "?").trim().charAt(0)}</span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-2">
                <b className="text-[15px] truncate">{c.name || c.phone}</b>
                {c.stage && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: C.soft, borderInlineStart: `3px solid ${STAGE_TONE[c.stage]?.accent ?? C.line}` }}>{STAGE_TONE[c.stage]?.label ?? c.stage}</span>}
                {c.paused && <Tag tone="warn">אתה עונה</Tag>}
              </span>
              <span className="block text-[13px] truncate" style={{ color: c.waiting ? C.ink : C.muted, fontWeight: c.waiting ? 600 : 400 }}>{c.last ? `${c.last.role === "assistant" ? (c.last.source === "admin" ? "אתה: " : "הסוכן: ") : ""}${c.last.text}` : ""}</span>
            </span>
            <span className="shrink-0 text-xs flex flex-col items-end gap-1" style={{ color: C.muted }}>
              {ago(c.at)}
              {c.waiting && <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.coral }} aria-label="מחכה לתשובה" />}
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}
