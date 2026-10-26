"use client";

import Link from "next/link";
import { useState } from "react";
import { C, NUM, TONE, Card, useCrm, ils } from "../ui";
import { Few, Stat, Stats, Note, days, useSaasRange, type SaasData } from "./parts";
import Accounts from "./Accounts";

/**
 * The SaaS dashboard (26.10.2026, Yair: "פירוט מעמיק מאוד לסאאס"; the order after GPT's review):
 * what needs action, first value, every account, the funnel and sales, retention. Revenue and costs
 * have their own screen, כספים (27.10.2026).
 * Data: view=saas (src/lib/crm/saas.ts). A rate on too little data says so.
 */
type Data = SaasData;
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");

export default function Dashboard() {
  const [allActions, setAllActions] = useState(false);
  const { query, picker } = useSaasRange();
  const { data, error } = useCrm<Data>(query);

  if (error) return <>{picker}<p className="text-red-700">{error}</p></>;
  if (!data) return <>{picker}<p style={{ color: C.muted }}>מחשב את המספרים…</p></>;
  const { firstValue: fv, revenue: rv, retention: rt, sales: sl, few } = data;
  const contacts = data.funnel[0].n + sl.leads;

  // Two groups: the WhatsApp funnel, then the shops that signed up. No rate across the border.
  const BORDER = 4;
  const rated = (i: number) => i > 0 && i !== BORDER && data.funnel[i - 1].n > 0;
  // The step with the biggest drop: "כאן זה דולף".
  const drops = data.funnel.map((f, i) => (rated(i) ? 1 - f.n / data.funnel[i - 1].n : -1));
  const leak = drops.indexOf(Math.max(...drops));
  const top = Math.max(1, ...data.funnel.map(f => f.n));

  return (
    <div className="flex flex-col gap-4">
      {picker}

      {/* The number that runs the business now */}
      <section className="rounded-[20px] p-5 flex flex-col gap-4" style={{ background: C.petrol, color: "#fff" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold" style={{ color: "#A9D7CF" }}>ערך ראשון בתוך 7 ימים</span>
            <b className="text-[40px] leading-none" style={NUM}>{fv.within7}<span className="text-[20px] font-semibold" style={{ color: "#A9D7CF" }}> מתוך {fv.signedUp}</span></b>
            <span className="text-[13px] max-w-[46ch]" style={{ color: "#CFE3DF" }}>עסקים שנרשמו בתקופה, והסוכן שלהם קבע תור אמיתי בשבוע הראשון. זה המספר שמנהל את העסק עכשיו.</span>
          </div>
          {fv.signedUp < few && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,.14)", color: "#fff" }}>מעט נתונים ({fv.signedUp})</span>}
        </div>
        <div className="grid gap-3 pt-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", borderTop: "1px solid rgba(255,255,255,.14)" }}>
          {[
            [days(fv.medianDays), "זמן עד ערך ראשון (חציון)"],
            [`${rv.trialToPaid.paid}/${rv.trialToPaid.ended || 0}`, "שילמו מתוך ניסיונות שנגמרו"],
            [ils(rv.mrr), "הכנסה חודשית קבועה"],
            [String(contacts), "פניות בתקופה"],
          ].map(([v, l]) => (
            <div key={l} className="flex flex-col"><b className="text-[22px]" style={NUM}>{v}</b><span className="text-[12px]" style={{ color: "#A9D7CF" }}>{l}</span></div>
          ))}
        </div>
      </section>

      {/* What needs action */}
      <Card title="מה דורש פעולה" aside={data.action.length ? `${data.action.length} עסקים` : "הכל בסדר"}>
        {data.action.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>אין עסק שמחכה להתערבות.</p>}
        <div className="flex flex-col">
          {(allActions ? data.action : data.action.slice(0, 5)).map((a, i) => (
            <Link key={a.id} href={`/admin/crm/customers/${a.id}`} className="flex items-center gap-2.5 py-2.5" style={{ borderTop: i ? `1px solid ${C.soft}` : undefined, color: C.ink, textDecoration: "none" }}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: TONE[a.tone as "bad" | "warn"].dot }} />
              <span className="flex-1 min-w-0"><b className="text-[15px]">{a.name}</b><span className="block text-[13px]" style={{ color: TONE[a.tone as "bad" | "warn"].color }}>{a.reason}</span></span>
              <span aria-hidden="true" style={{ color: C.muted }}>‹</span>
            </Link>
          ))}
        </div>
        {data.action.length > 5 && <button type="button" onClick={() => setAllActions(v => !v)} className="mt-1 min-h-[40px] text-sm font-semibold" style={{ color: C.petrol }}>{allActions ? "פחות" : `ועוד ${data.action.length - 5}`}</button>}
      </Card>

      {/* Every account: a bar by state, the week's totals, a short list with the ones needing care first */}
      <Accounts accounts={data.accounts} needsCare={new Set(data.action.map(x => x.id))} />

      {/* The funnel and sales */}
      <Card title="משפך הגיוס" aside={<Few n={data.funnel[0].n} few={few} />}>
        <div className="flex flex-col gap-2">
          {data.funnel.map((f, i) => {
            const prev = i ? data.funnel[i - 1].n : 0;
            return (
              <div key={f.label} className="flex flex-col gap-2">
              {i === BORDER && <span className="text-[12px] font-semibold pt-2 mt-1" style={{ color: C.muted, borderTop: `1px dashed ${C.line}` }}>מכאן: עסקים שנרשמו בתקופה</span>}
              <div className="grid items-center gap-2.5" style={{ gridTemplateColumns: "minmax(96px, 128px) minmax(0, 1fr) 52px" }}>
                <span className="text-[13px] font-semibold">{f.label}</span>
                <div className="h-7 rounded-lg overflow-hidden" style={{ background: C.soft }}>
                  <div className="h-full rounded-lg flex items-center ps-2" style={{ width: `${Math.max(f.n ? 6 : 0, (f.n / top) * 100)}%`, background: i === leak ? "#F5A623" : i < 4 ? "#8FE6C6" : C.turquoise }}>
                    <span className="text-[13px] font-bold" style={NUM}>{f.n}</span>
                  </div>
                </div>
                <span className="text-[12px] text-left" style={{ ...NUM, color: i === leak ? "#B54708" : C.muted }}>{rated(i) ? pct(f.n, prev) : ""}</span>
              </div>
              </div>
            );
          })}
        </div>
        {leak > 0 && <p className="m-0 mt-3 text-[13px] font-semibold" style={{ color: "#B54708" }}>כאן זה דולף: מ&quot;{data.funnel[leak - 1].label}&quot; ל&quot;{data.funnel[leak].label}&quot;.</p>}
        <Note>ארבעת השלבים הראשונים הם משפך הוואטסאפ ב-45 הימים האחרונים. מ&quot;נרשמו&quot; והלאה: עסקים שנרשמו בתקופה. האחוז ליד כל שלב הוא מהשלב שלפניו, בתוך אותה קבוצה.</Note>
        {data.bySource.length > 0 && (
          <div className="mt-4 flex flex-col">
            <div className="grid text-[12px] font-semibold pb-1.5" style={{ gridTemplateColumns: "1fr repeat(4, 56px)", color: C.muted }}><span>מקור</span><span>כתבו</span><span>ניסו</span><span>לליד</span><span>נרשמו</span></div>
            {data.bySource.map(s => (
              <div key={s.source} className="grid text-[14px] py-1.5" style={{ gridTemplateColumns: "1fr repeat(4, 56px)", borderTop: `1px solid ${C.soft}`, ...NUM }}>
                <span className="font-semibold" style={{ fontFamily: "Heebo, sans-serif" }}>{s.source}</span><span>{s.contacts}</span><span>{s.tried}</span><span>{s.toLead}</span><span>{s.signedUp}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="מכירות" aside={<Few n={sl.callsHeld} few={few} />}>
        <Stats>
          <Stat v={sl.leads} l="לידים אמיתיים בתקופה" />
          <Stat v={sl.callsBooked} l="שיחות שנקבעו" />
          <Stat v={sl.callsHeld} l="שיחות שהתקיימו" />
          <Stat v={sl.won} l="נסגרו" />
          <Stat v={sl.closeRate == null ? "—" : `${sl.closeRate}%`} l="אחוז סגירה" />
        </Stats>
        {sl.leadsBySource.length > 0 && <Note>לידים לפי מקור: {sl.leadsBySource.map(s => `${s.source} ${s.n}`).join(" · ")}</Note>}
      </Card>

      {/* Retention */}
      <Card title="שימור" aside={<Few n={rt.cohorts.reduce((s, c) => s + c.signed, 0)} few={few} />}>
        <div className="flex flex-col">
          <div className="grid text-[12px] font-semibold pb-1.5" style={{ gridTemplateColumns: "1fr repeat(5, 48px)", color: C.muted }}><span>חודש הרשמה</span><span>נרשמו</span><span>חודש 1</span><span>חודש 2</span><span>חודש 3</span><span>משלמים</span></div>
          {rt.cohorts.map(c => (
            <div key={c.month} className="grid text-[14px] py-1.5" style={{ gridTemplateColumns: "1fr repeat(5, 48px)", borderTop: `1px solid ${C.soft}`, ...NUM }}>
              <span>{c.month.slice(5)}/{c.month.slice(2, 4)}</span><span>{c.signed}</span>
              {[c.m1, c.m2, c.m3].map((v, k) => <span key={k} style={{ color: v == null ? C.line : C.ink }}>{v == null ? "·" : v}</span>)}
              <span>{c.paying}</span>
            </div>
          ))}
        </div>
        <Note>כמה מהעסקים שנרשמו באותו חודש עדיין איתנו בסוף החודש הראשון, השני והשלישי. נטישה = השהיה. {rt.suspendedInRange ? `הושהו בתקופה: ${rt.suspendedInRange}.` : ""}{rt.logoChurnPct != null && rt.startActive >= few ? ` נטישה בתקופה: ${rt.logoChurnPct}%.` : ""}</Note>
      </Card>
    </div>
  );
}
