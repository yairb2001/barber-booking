"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { C, PageHead, Tag, useCrm, ago, STAGE_TONE, crmAction } from "../ui";

/**
 * Chator's WhatsApp chats (10.10.2026, Yair: "צ'אטים בתפריט, בלי קבוצות"), and its Instagram DMs (12.10).
 * Inside each tab, two inboxes like the shop's chat (12.10, Yair: "טיפול אנושי והסוכן"):
 * "טיפול אנושי" (you took the chat, or the agent doesn't answer this person), waiting first;
 * then "מטופל ע״י הסוכן".
 * Two tabs (26.10.2026, Yair: "פיצול לשוניות למעלה, מתעניינים, לקוחות"): people still interested,
 * and our customers' owners. Instagram is a tag on the row, not a tab.
 */
type Chat = { id: string; channel: "whatsapp" | "instagram"; agent: boolean; handled?: boolean; phone: string; name: string | null; shop: string | null; customer: string | null; leadId: string | null; stage: string | null; mode: string | null; at: string; last: { role: string; source: string | null; text: string } | null; waiting: boolean; paused: boolean };

const TABS: { key: "leads" | "customers"; label: string }[] = [
  { key: "leads", label: "מתעניינים" },
  { key: "customers", label: "לקוחות" },
];

export default function ChatsPage() {
  return <Suspense fallback={<p style={{ color: C.muted }}>טוען…</p>}><ChatsInner /></Suspense>;
}

function ChatsInner() {
  const { data, error, reload } = useCrm<{ chats: Chat[] }>("view=chats");
  const [q, setQ] = useState("");
  const sp = useSearchParams();
  const router = useRouter();
  const tab = TABS.find(t => t.key === sp.get("t"))?.key ?? "leads";
  const waitingOnly = sp.get("w") === "1";
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(sp.toString()); if (v) p.set(k, v); else p.delete(k); const qs = p.toString(); router.replace(`/admin/crm/chats${qs ? `?${qs}` : ""}`, { scroll: false }); };
  const setTab = (k: string) => setParam("t", k === "leads" ? null : k);
  useEffect(() => { const t = setInterval(() => void reload(), 30000); return () => clearInterval(t); }, [reload]);
  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;
  const inTab = (k: string) => data.chats.filter(c => (k === "customers") === !!c.customer);
  const list = inTab(tab).filter(c => (!waitingOnly || c.waiting) && (!q.trim() || [c.name, c.phone, c.shop, c.customer].some(x => (x ?? "").includes(q.trim()))));
  // "✓ טופל" from the list, without opening the chat (13.10.2026).
  const markHandled = async (e: React.MouseEvent, id: string) => { e.preventDefault(); e.stopPropagation(); await crmAction({ action: "chat.handled", id }); void reload(); };
  const human = list.filter(c => c.paused || !c.agent).sort((a, b) => Number(b.waiting) - Number(a.waiting));
  const byAgent = list.filter(c => !c.paused && c.agent);
  const row = (c: Chat, i: number) => (
    <Link key={c.id} href={`/admin/crm/chats/${c.id}`} className="flex items-start gap-3 px-3.5 py-3" style={{ borderTop: i ? `1px solid ${C.soft}` : undefined, color: C.ink, textDecoration: "none" }}>
      <span className="w-10 h-10 rounded-full shrink-0 inline-flex items-center justify-center font-bold" style={{ background: C.mist, color: C.petrol }}>{(c.name || "?").trim().charAt(0)}</span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <b className="text-[15px] truncate">{c.name || c.phone || "לקוח מאינסטגרם"}</b>
          {c.customer && c.customer !== c.name && <span className="text-[13px] truncate" style={{ color: "#3E5A5B" }}>{c.customer}</span>}
          {c.channel === "instagram" && <Tag>אינסטגרם</Tag>}
          {c.stage && <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: C.soft }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: STAGE_TONE[c.stage]?.accent ?? C.line }} aria-hidden="true" />{STAGE_TONE[c.stage]?.label ?? c.stage}</span>}
          {c.paused && <Tag tone="warn">אתה עונה</Tag>}
        </span>
        <span className="block text-[13px] truncate" style={{ color: c.waiting ? C.ink : C.muted, fontWeight: c.waiting ? 600 : 400 }}>{c.last ? `${c.last.role === "assistant" ? (c.last.source === "admin" ? "אתה: " : "הסוכן: ") : ""}${c.last.text}` : ""}</span>
      </span>
      <span className="shrink-0 text-xs flex flex-col items-end gap-1" style={{ color: C.muted }}>
        {ago(c.at)}
        {c.waiting && <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.coral }} aria-label="מחכה לתשובה" />}
        {c.waiting && <button type="button" onClick={e => void markHandled(e, c.id)} className="text-[11px] font-semibold px-2 py-1 rounded-full" style={{ background: "#E3F7EF", color: "#0F6B4F", border: "1px solid #BFE8D6" }} title="מסיר את הסימון האדום בלי לענות">✓ טופל</button>}
        {c.handled && <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: C.soft, color: C.muted }}>✓ טופל</span>}
      </span>
    </Link>
  );
  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <PageHead title="צ׳אטים" sub={`השיחות בוואטסאפ ובאינסטגרם של צ'אטור · ${data.chats.filter(c => c.waiting).length} מחכות לתשובה`} />
      <div role="tablist" aria-label="מי" className="flex gap-1.5">
        {TABS.map(t => {
          const on = tab === t.key;
          const n = inTab(t.key).length;
          const waiting = inTab(t.key).some(c => c.waiting);
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)} className="h-11 px-4 rounded-full text-[15px] font-bold inline-flex items-center gap-2" style={on ? { background: C.petrol, color: "#fff", border: `1px solid ${C.petrol}` } : { background: "#fff", color: C.muted, border: `1px solid ${C.line}` }}>
              {t.label}<span className="text-xs" style={{ opacity: 0.75 }}>{n}</span>
              {waiting && <span className="w-2 h-2 rounded-full" style={{ background: C.coral }} aria-label="יש שיחה שמחכה לתשובה" />}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 items-center">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי שם, טלפון או מספרה" className="flex-1 min-w-0 h-11 rounded-xl px-3 text-[15px]" style={{ border: "1px solid #C7D8D5" }} />
        <button type="button" aria-pressed={waitingOnly} onClick={() => setParam("w", waitingOnly ? null : "1")} className="shrink-0 h-11 px-3.5 rounded-xl text-sm font-semibold" style={waitingOnly ? { background: C.mist, color: C.petrol, border: `1px solid ${C.petrol2}` } : { background: "#fff", color: C.petrol, border: `1px solid ${C.line}` }}>מחכים לתשובה</button>
      </div>
      {list.length === 0 && <p className="m-0 p-4 text-sm bg-white rounded-2xl" style={{ color: C.muted, border: `1px solid ${C.line}` }}>{q.trim() ? "אין שיחות שמתאימות לחיפוש." : waitingOnly ? "אף אחד לא מחכה לתשובה." : tab === "customers" ? "אין שיחות עם לקוחות." : "אין שיחות."}</p>}
      {human.length > 0 && (
        <section className="bg-white rounded-2xl" style={{ border: `1px solid ${C.line}` }}>
          <p className="m-0 px-3.5 py-2 text-[12px] font-bold rounded-t-2xl" style={{ background: "#FDE7E3", color: "#9A3412" }}>טיפול אנושי ({human.length})</p>
          {human.map(row)}
        </section>
      )}
      {byAgent.length > 0 && (
        <section className="bg-white rounded-2xl" style={{ border: `1px solid ${C.line}` }}>
          <p className="m-0 px-3.5 py-2 text-[12px] font-bold rounded-t-2xl" style={{ background: C.soft, color: C.muted }}>מטופל ע״י הסוכן ({byAgent.length})</p>
          {byAgent.map(row)}
        </section>
      )}
    </div>
  );
}
