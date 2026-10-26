"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { C, NUM, Card, ils } from "../ui";
import type { Account } from "@/lib/crm/saas";
import { STAGE, Stat, Stats, days } from "./parts";

/**
 * Every account, built for 200 of them (26.10.2026, Yair: "אם יהיה 200 עסקים?"): a bar of how
 * many are in each state (a tap filters), the week's totals, and a short list with the ones
 * needing care first, a search, and "עוד".
 */
const SEGMENTS: { key: string; label: string; color: string; of: (a: Account) => boolean }[] = [
  { key: "paying", label: "משלמים", color: "#2BC293", of: a => a.stage === "paying" },
  { key: "value", label: "בניסיון, עם ערך", color: C.turquoise, of: a => a.stage === "trial" && a.firstValueDays != null },
  { key: "novalue", label: "בניסיון, בלי ערך", color: "#F5A623", of: a => a.stage === "trial" && a.firstValueDays == null },
  { key: "setup", label: "בהקמה", color: "#FFB4A8", of: a => a.stage === "setup" },
  { key: "suspended", label: "מושהים", color: "#C7D8D5", of: a => a.stage === "suspended" },
];
const PAGE = 8;

export default function Accounts({ accounts, needsCare }: { accounts: Account[]; needsCare: Set<string> }) {
  const [seg, setSeg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const live = accounts.filter(a => a.live && a.stage !== "suspended");
  const appts = live.reduce((s, a) => s + a.appts7, 0), convs = live.reduce((s, a) => s + a.convs7, 0), esc = live.reduce((s, a) => s + a.escalated7, 0);
  const list = useMemo(() => {
    const of = SEGMENTS.find(s => s.key === seg)?.of;
    return accounts
      .filter(a => (!of || of(a)) && (!q.trim() || a.name.includes(q.trim())))
      .sort((a, b) => Number(needsCare.has(b.id)) - Number(needsCare.has(a.id)) || b.appts7 - a.appts7 || b.cost30Ils - a.cost30Ils);
  }, [accounts, seg, q, needsCare]);

  return (
    <Card title="העסקים" aside={`${accounts.length} עסקים · שבוע אחרון`}>
      <div className="flex flex-col gap-4">
        {/* How many in each state: one bar, a tap filters the list */}
        <div className="flex flex-col gap-2">
          <div className="flex h-3 rounded-full overflow-hidden" style={{ background: C.soft }}>
            {SEGMENTS.map(s => { const n = accounts.filter(s.of).length; return n ? <span key={s.key} style={{ width: `${(n / accounts.length) * 100}%`, background: s.color }} /> : null; })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SEGMENTS.map(s => {
              const n = accounts.filter(s.of).length, on = seg === s.key;
              return (
                <button key={s.key} type="button" aria-pressed={on} onClick={() => { setSeg(on ? null : s.key); setShown(PAGE); }} className="h-8 px-2.5 rounded-full text-[12px] font-semibold inline-flex items-center gap-1.5"
                  style={on ? { background: C.mist, color: C.petrol, border: `1px solid ${C.petrol2}` } : { background: "#fff", color: C.ink, border: `1px solid ${C.line}` }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label}<span style={{ ...NUM, color: C.muted }}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Stats>
          <Stat v={appts} l="תורים מהסוכן השבוע" />
          <Stat v={live.length ? Math.round((appts / live.length) * 10) / 10 : "—"} l="לעסק חי בממוצע" />
          <Stat v={convs} l="שיחות" />
          <Stat v={convs ? `${Math.round((esc / convs) * 100)}%` : "—"} l="הועברו לאדם" />
          <Stat v={live.filter(a => a.appts7 === 0).length} l="חיים בלי תור השבוע" tone={live.some(a => a.appts7 === 0) ? "warn" : undefined} />
        </Stats>

        {accounts.length > PAGE && <input value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }} placeholder="חיפוש עסק" aria-label="חיפוש עסק" className="h-11 rounded-xl px-3 text-[15px]" style={{ border: "1px solid #C7D8D5" }} />}

        <div className="flex flex-col">
          {list.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>אין עסקים כאן.</p>}
          {list.slice(0, shown).map((a, i) => {
            const [label, bg, color] = STAGE[a.stage];
            return (
              <Link key={a.id} href={`/admin/crm/customers/${a.id}`} className="grid items-center gap-3 py-2.5" style={{ gridTemplateColumns: "minmax(0,1fr) 52px 60px", borderTop: i ? `1px solid ${C.soft}` : undefined, color: C.ink, textDecoration: "none" }}>
                <span className="min-w-0 flex flex-col">
                  <span className="flex items-center gap-1.5 min-w-0">
                    {needsCare.has(a.id) && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "#D92D20" }} aria-label="דורש פעולה" />}
                    <b className="text-[15px] truncate">{a.name}</b>
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: bg, color }}>{label}</span>
                  </span>
                  <span className="text-[12px] truncate" style={{ color: C.muted }}>{a.live ? `ערך ראשון: ${a.firstValueDays == null ? "עוד לא" : days(a.firstValueDays)}` : `הקמה ${a.setupDone}/${a.setupTotal}`} · {a.days} ימים</span>
                </span>
                <span className="flex flex-col items-center"><b className="text-[16px]" style={{ ...NUM, color: C.petrol }}>{a.appts7}</b><span className="text-[11px]" style={{ color: C.muted }}>תורים</span></span>
                <span className="flex flex-col items-center"><b className="text-[16px]" style={{ ...NUM, color: a.price > 0 && a.cost30Ils > a.price ? "#B42318" : C.petrol }}>{ils(a.cost30Ils)}</b><span className="text-[11px]" style={{ color: C.muted }}>עלות</span></span>
              </Link>
            );
          })}
        </div>
        {list.length > shown && <button type="button" onClick={() => setShown(n => n + PAGE * 2)} className="self-start min-h-[40px] text-sm font-semibold" style={{ color: C.petrol }}>עוד {Math.min(PAGE * 2, list.length - shown)} מתוך {list.length - shown}</button>}
      </div>
    </Card>
  );
}
