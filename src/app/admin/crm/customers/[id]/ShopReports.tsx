"use client";

import { useState } from "react";
import { C, Card, ago, useCrm } from "../../ui";
import { Detail, parseReport, type Data as ImpData } from "../../reports/ReportDetail";
import ConversationSheet from "../../improvements/ConversationSheet";

/**
 * The shop's reports on the agent, in its customer card (26.10.2026, Yair:
 * "בכרטיס לקוח שלו יופיע כמו איזשהו בועה אדומה עם כמות הדיווחים ... וגם דרך
 * הכרטיס לקוח אנחנו נוכל לעדכן ... כמה דיווחים והיסטוריה דיווחים"). Every
 * report with its stage; "פתח" opens the same problem as the reports screen,
 * with its actions, right here. Data: customerView.reports (shop-reports.ts).
 */
export type ShopReport = { id: string; at: string; author: string | null; text: string; conversationId: string | null; stage: "new" | "agent" | "approve" | "done" | "closed"; improvementId: string | null; title: string | null };

const STAGE: Record<ShopReport["stage"], { label: string; bg: string; color: string }> = {
  new: { label: "חדש", bg: "#FDECEA", color: "#B42318" },
  agent: { label: "אצל סוכן התיקונים", bg: "#FFF1D6", color: "#7A4A00" },
  approve: { label: "מחכה לאישור", bg: "#FFF1D6", color: "#7A4A00" },
  done: { label: "תוקן", bg: "#E3F7EF", color: "#0F6B4F" },
  closed: { label: "נסגר", bg: "#EEF3F2", color: "#536B6C" },
};
export const isOpenReport = (r: ShopReport) => r.stage === "new" || r.stage === "agent" || r.stage === "approve";

/** The red bubble: open reports, next to the shop's name. */
export function ReportsBubble({ count, href }: { count: number; href?: string }) {
  if (!count) return null;
  const el = <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[12px] font-bold text-white" style={{ background: "#D92D20", fontFamily: "Outfit, Heebo, sans-serif" }}>{count}</span>;
  return href ? <a href={href} title={`${count} דיווחים פתוחים על הסוכן`} aria-label={`${count} דיווחים פתוחים על הסוכן`} style={{ textDecoration: "none" }}>{el}</a> : <span title={`${count} דיווחים פתוחים על הסוכן`}>{el}</span>;
}

/** One problem from the reports queue, managed from the card. */
function ProblemSheet({ improvementId, onClose, onChanged }: { improvementId: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const { data, reload } = useCrm<ImpData>("view=improvements");
  const [conv, setConv] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const item = data?.items.find(i => i.id === improvementId) ?? null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" style={{ background: "rgba(11,31,33,0.45)" }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="הבעיה שדווחה" onClick={e => e.stopPropagation()} dir="rtl"
        className="w-full md:max-w-2xl bg-white rounded-t-3xl md:rounded-3xl p-4 md:p-6 max-h-[92vh] overflow-y-auto flex flex-col gap-3">
        <div className="flex justify-end"><button type="button" onClick={onClose} aria-label="סגור" className="w-10 h-10 rounded-full" style={{ color: C.muted }}>✕</button></div>
        {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}
        {!data && <p className="m-0 text-sm" style={{ color: C.muted }}>טוען…</p>}
        {data && !item && <p className="m-0 text-sm" style={{ color: C.muted }}>הבעיה כבר לא פתוחה במסך הדיווחים.</p>}
        {item && <Detail i={item} openChat={setConv} onDone={async msg => { setFlash(msg); await reload(); await onChanged(); }} />}
      </div>
      {conv && <ConversationSheet id={conv} evidence={null} onClose={() => setConv(null)} />}
    </div>
  );
}

export function ShopReportsCard({ reports, onChanged }: { reports: ShopReport[]; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState<string | null>(null);
  const [conv, setConv] = useState<string | null>(null);
  const openCount = reports.filter(isOpenReport).length;
  if (!reports.length) return null;
  return (
    <div id="reports">
      <Card collapsible defaultOpen={openCount > 0} title={<span className="inline-flex items-center gap-2">דיווחים על הסוכן <ReportsBubble count={openCount} /></span>} aside={`${openCount ? `${openCount} פתוחים · ` : ""}${reports.length} בסך הכל`}>
        <ol className="m-0 p-0 list-none flex flex-col gap-2.5">
          {reports.map(r => {
            const st = STAGE[r.stage];
            const parts = parseReport(r.text);
            return (
              <li key={r.id} className="rounded-xl p-3 flex flex-col gap-1.5" style={{ background: C.ground }}>
                <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: C.muted }}>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                  <span>{ago(r.at)}{r.author ? ` · ${r.author}` : ""}</span>
                </div>
                {parts.slice(0, 3).map((p, k) => (
                  <p key={k} className="m-0 text-sm leading-relaxed">
                    {p.quote && <span className="rounded-lg px-1.5 py-0.5 me-1.5" style={{ background: "#D9FDD3" }}>«{p.quote.length > 70 ? `${p.quote.slice(0, 70)}…` : p.quote}»</span>}
                    {p.why}
                  </p>
                ))}
                {r.title && <p className="m-0 text-xs" style={{ color: C.muted }}>בבעיה: {r.title}</p>}
                <div className="flex flex-wrap gap-3">
                  {r.improvementId && <button type="button" onClick={() => setOpen(r.improvementId)} className="min-h-[36px] text-sm font-bold" style={{ color: C.petrol }}>{isOpenReport(r) ? "לטפל" : "לפרטים"}</button>}
                  {r.conversationId && <button type="button" onClick={() => setConv(r.conversationId)} className="min-h-[36px] text-sm font-semibold" style={{ color: C.muted }}>לשיחה</button>}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
      {open && <ProblemSheet improvementId={open} onClose={() => setOpen(null)} onChanged={onChanged} />}
      {conv && <ConversationSheet id={conv} evidence={null} onClose={() => setConv(null)} />}
    </div>
  );
}
