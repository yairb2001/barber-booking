"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { C, NUM, TONE, PageHead, useCrm, ils } from "../ui";

type Cust = {
  id: string; name: string; slug: string; ownerPhone: string | null; stage: string; health: "ok" | "warn" | "bad"; issues: { tone: "bad" | "warn"; text: string }[];
  wa: "up" | "down" | "none"; apptsWeek: number; pkgPct: number; costIls: number; price: number; trialDaysLeft: number | null; rep: string | null;
  plan: string | null; apptsMonth: { used: number; cap: number; pct: number } | null;
  segment: "setup" | "live" | "risk" | "suspended"; setup: { doneCount: number; total: number; current: string | null; stuckHours: number } | null;
};
const STAGE: Record<string, string> = { setup: "בהקמה", trial: "בניסיון", paying: "משלם", suspended: "מושהה" };
const HEALTH = { ok: "תקין", warn: "לשים לב", bad: "דורש טיפול" } as const;
const TABS = [["setup", "בהקמה"], ["live", "חיים"], ["risk", "בסיכון"], ["suspended", "מושהים"], ["all", "הכל"]] as const;
type Tab = (typeof TABS)[number][0];

function stuckLabel(h: number) { return h >= 48 ? `תקוע ${Math.floor(h / 24)} ימים` : h >= 24 ? "תקוע יותר מיום" : h > 0 ? `${h} ש׳ בשלב הזה` : ""; }

function CustomersInner() {
  const sp = useSearchParams();
  const focus = sp.get("focus");
  const { data, error } = useCrm<{ customers: Cust[] }>("view=customers");
  const [tab, setTab] = useState<Tab>("setup");
  const all = useMemo(() => data?.customers ?? [], [data]);
  const count = (t: Tab) => (t === "all" ? all.length : all.filter(c => c.segment === t).length);
  const list = useMemo(() => {
    const l = tab === "all" ? all : all.filter(c => c.segment === tab);
    return tab === "setup" ? [...l].sort((a, b) => (b.setup?.stuckHours ?? 0) - (a.setup?.stuckHours ?? 0)) : l;
  }, [all, tab]);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="לקוחות" sub={`${all.length} עסקים · ${count("setup")} בהקמה · ${count("live")} חיים · ${count("risk")} בסיכון`} actions={
        <Link href="/admin/crm/leads?new=1" className="min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center" style={{ background: C.coral, color: C.ink, textDecoration: "none" }}>+ הקם לקוח (מליד)</Link>
      } />
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="h-[38px] px-3.5 rounded-full text-sm font-semibold" style={tab === k ? { background: C.petrol, color: "#fff", border: `1px solid ${C.petrol}` } : { background: "#fff", color: C.ink, border: "1px solid #C7D8D5" }}>{l} ({count(k)})</button>
        ))}
      </div>

      {list.length === 0 && <p className="text-sm" style={{ color: C.muted }}>אין כאן עסקים.</p>}

      {tab === "setup" ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {list.map(c => {
            const st = c.setup;
            const stuck = (st?.stuckHours ?? 0) >= 24;
            return (
              <Link key={c.id} href={`/admin/crm/customers/${c.id}`} className="bg-white rounded-2xl p-4 flex flex-col gap-2.5" style={{ border: stuck ? `2px solid ${TONE.bad.dot}` : `1px solid ${C.line}`, color: C.ink, textDecoration: "none", background: c.id === focus ? C.mist : "#fff" }}>
                <div className="flex justify-between items-start gap-2">
                  <div><div className="font-bold">{c.name}</div><div className="text-xs" style={{ color: C.muted }}>{c.ownerPhone ?? "בלי טלפון"}{c.rep ? ` · ${c.rep}` : ""}</div></div>
                  {stuck && <span className="text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap" style={{ background: TONE.bad.bg, color: TONE.bad.color }}>{stuckLabel(st!.stuckHours)}</span>}
                </div>
                {st && (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: C.soft }}><div className="h-full rounded-full" style={{ width: `${(st.doneCount / st.total) * 100}%`, background: stuck ? "#F5A623" : C.turquoise }} /></div>
                      <span className="text-xs font-bold" style={NUM}>{st.doneCount}/{st.total}</span>
                    </div>
                    <div className="text-[13px]"><span style={{ color: C.muted }}>השלב הבא: </span><b>{st.current ?? "סיים"}</b>{!stuck && st.stuckHours > 0 ? <span style={{ color: C.muted }}> · {stuckLabel(st.stuckHours)}</span> : null}</div>
                  </>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <section className="bg-white rounded-[18px] overflow-x-auto" style={{ border: `1px solid ${C.line}` }}>
          <table className="w-full text-sm" style={{ minWidth: 1080, borderCollapse: "collapse" }}>
            <thead>
              <tr className="text-right text-xs" style={{ color: C.muted }}>
                {["עסק", "מצב", "מסלול", "בריאות", "וואטסאפ", "תורים החודש", "חבילת הסוכן", "משלם / עולה לנו", "נציג"].map((h, i) => <th key={i} scope="col" className="px-3 py-3.5 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {list.map(c => (
                <tr key={c.id} style={{ borderTop: `1px solid ${C.soft}`, background: c.id === focus ? C.mist : undefined }}>
                  <td className="px-3 py-3"><Link href={`/admin/crm/customers/${c.id}`} className="font-bold" style={{ color: C.ink }}>{c.name}</Link><div className="text-xs" style={{ color: C.muted }}>{c.ownerPhone ?? "בלי טלפון"}</div></td>
                  <td className="px-3 py-3"><span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: C.soft, color: C.petrol }}>{STAGE[c.stage]}{c.trialDaysLeft != null && c.stage === "trial" ? ` · ${c.trialDaysLeft} ימים` : ""}</span></td>
                  <td className="px-3 py-3 text-[13px]">{c.plan ?? <span style={{ color: C.muted }}>—</span>}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: TONE[c.health].color }}><span className="w-2.5 h-2.5 rounded-full" style={{ background: TONE[c.health].dot }} />{HEALTH[c.health]}</span>
                    {c.issues.length > 0 && <div className="text-xs" style={{ color: C.muted }}>{c.issues.map(i => i.text).join(" · ")}</div>}
                  </td>
                  <td className="px-3 py-3 text-[13px] font-semibold" style={{ color: c.wa === "up" ? "#0F6B4F" : c.wa === "down" ? "#B42318" : C.muted }}>{c.wa === "up" ? "מחובר" : c.wa === "down" ? "מנותק" : "לא חובר"}</td>
                  <td className="px-3 py-3 font-semibold" style={{ ...NUM, color: c.apptsMonth && c.apptsMonth.cap > 0 && c.apptsMonth.pct >= 80 ? "#B54708" : C.ink }}>{c.apptsMonth ? (c.apptsMonth.cap > 0 ? `${c.apptsMonth.used} / ${c.apptsMonth.cap}` : c.apptsMonth.used) : "—"}</td>
                  <td className="px-3 py-3"><div className="flex items-center gap-2"><div className="w-[90px] h-2 rounded-full overflow-hidden" style={{ background: C.soft }}><div className="h-full" style={{ width: `${c.pkgPct}%`, background: c.pkgPct >= 80 ? "#F5A623" : C.turquoise }} /></div><span className="text-xs" style={{ color: C.muted }}>{c.pkgPct}%</span></div></td>
                  <td className="px-3 py-3 text-[13px]" style={{ ...NUM, color: c.price > 0 && c.costIls > c.price ? "#B42318" : C.ink }}>{c.price > 0 ? ils(c.price) : "ניסיון"} / {ils(c.costIls)}</td>
                  <td className="px-3 py-3 text-[13px]">{c.rep ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

export default function CustomersPage() {
  return <Suspense fallback={<p>טוען…</p>}><CustomersInner /></Suspense>;
}
