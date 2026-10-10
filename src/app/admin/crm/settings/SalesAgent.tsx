"use client";

import { useState } from "react";
import { C, Btn, Card, crmAction } from "../ui";

/**
 * The Chator agent (spec "הסוכן של צ'אטור", 10.10.2026): what it knows,
 * edited here instead of in code, and the switch to version 2.
 */
export type SalesAgentData = { v2: boolean; v2At: string | null; knowledge: string; custom: boolean; knowledgeAt: string | null };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" }) : null);

export function SalesAgentCard({ data, onSaved }: { data: SalesAgentData; onSaved: () => Promise<void> | void }) {
  const [text, setText] = useState(data.knowledge);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const changed = text.trim() !== data.knowledge.trim();

  async function act(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const r = await crmAction(body);
    setBusy(false);
    setNote(r.ok ? done : r.error ?? "שגיאה");
    if (r.ok) await onSaved();
  }

  return (
    <Card collapsible title="הסוכן של צ'אטור" aside={data.v2 ? "גרסה חדשה" : "גרסה ישנה"}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: C.soft }}>
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold">גרסה חדשה לפי האפיון</p>
            <p className="m-0 text-xs" style={{ color: C.muted }}>{"\"כאן צ'אטור\", דמו בתוך השיחה, קישור הרשמה למי שחם."}{data.v2At ? ` עודכן ${when(data.v2At)}` : ""}</p>
          </div>
          <Btn kind={data.v2 ? "outline" : "dark"} className="!min-h-[38px] !px-3 !text-[13px] shrink-0" disabled={busy}
            onClick={() => confirm(data.v2 ? "לחזור לגרסה הישנה?" : "להדליק את הגרסה החדשה לכל מי שכותב למספר של צ'אטור?") && act({ action: "salesAgent.v2", on: !data.v2 }, data.v2 ? "חזר לגרסה הישנה" : "הגרסה החדשה פעילה")}>
            {data.v2 ? "כבה" : "הדלק"}
          </Btn>
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-sm font-semibold">ידע הסוכן</span>
            <span className="text-xs" style={{ color: C.muted }}>{data.custom ? `נערך ${when(data.knowledgeAt) ?? ""}` : "ברירת המחדל"}</span>
          </div>
          <p className="m-0 mb-2 text-xs" style={{ color: C.muted }}>{"הסוכן עונה רק מתוך מה שכתוב כאן. פיצ'ר שלא כתוב, הוא אומר שלא קיים היום."}</p>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={14} dir="rtl" className="w-full rounded-xl px-3 py-2 text-[13px] leading-relaxed" style={{ border: "1px solid #C7D8D5" }} />
          <div className="flex flex-wrap gap-2 mt-2">
            <Btn kind="dark" disabled={busy || !changed} onClick={() => act({ action: "salesAgent.knowledge", knowledge: text }, "הידע נשמר")}>שמור</Btn>
            {data.custom && <Btn kind="ghost" disabled={busy} onClick={() => confirm("לחזור לידע ברירת המחדל? מה שערכת יימחק.") && act({ action: "salesAgent.knowledge", knowledge: "" }, "חזר לברירת המחדל")}>חזרה לברירת המחדל</Btn>}
          </div>
        </div>
        {note && <p className="m-0 text-[13px]" style={{ color: C.petrol }}>{note}</p>}
      </div>
    </Card>
  );
}
