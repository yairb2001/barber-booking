"use client";

import Link from "next/link";
import { useState } from "react";
import { C, NUM, TONE, Card, useCrm, ils } from "../ui";
import type { saasDashboard } from "@/lib/crm/saas";
import { Few, Stat, Stats, Note, days } from "./parts";
import Accounts from "./Accounts";

/**
 * The SaaS dashboard (26.10.2026, Yair: "פירוט מעמיק מאוד לסאאס"; the order after GPT's review):
 * what needs action, first value, every account, the funnel and sales, revenue, costs, retention.
 * Data: view=saas (src/lib/crm/saas.ts). A rate on too little data says so.
 */
type Data = Awaited<ReturnType<typeof saasDashboard>>;
const RANGES = [["30", "30 יום"], ["90", "90 יום"], ["all", "מההתחלה"], ["custom", "טווח תאריכים"]] as const;
const isoDay = (offset: number) => new Date(Date.now() + offset * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");

export default function Dashboard() {
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("30");
  // A range of dates of his own (Yair, 26.10.2026: "לבחור טווח תאריכים").
  const [from, setFrom] = useState(isoDay(-30));
  const [to, setTo] = useState(isoDay(0));
  const [allActions, setAllActions] = useState(false);
  const { data, error } = useCrm<Data>(range === "custom" ? `view=saas&range=custom&from=${from}&to=${to}` : `view=saas&range=${range}`);

  const field = "h-9 rounded-lg px-2 text-[13px] bg-white";
  const picker = (
    <div className="flex flex-col gap-2">
    <div role="tablist" aria-label="תקופה" className="flex flex-wrap gap-1.5">
      {RANGES.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={range === k} onClick={() => setRange(k)} className="h-9 px-3 rounded-full text-[13px] font-semibold"
          style={range === k ? { background: C.mist, color: C.petrol, border: `1px solid ${C.petrol2}` } : { background: "#fff", color: C.muted, border: `1px solid ${C.line}` }}>{l}</button>
      ))}
    </div>
    {range === "custom" && (
      <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: C.muted }}>
        <label className="flex items-center gap-1.5">מתאריך<input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} className={field} style={{ border: `1px solid ${C.line}`, color: C.ink }} /></label>
        <label className="flex items-center gap-1.5">עד<input type="date" value={to} min={from} max={isoDay(0)} onChange={e => e.target.value && setTo(e.target.value)} className={field} style={{ border: `1px solid ${C.line}`, color: C.ink }} /></label>
      </div>
    )}
    </div>
  );
  if (error) return <>{picker}<p className="text-red-700">{error}</p></>;
  if (!data) return <>{picker}<p style={{ color: C.muted }}>מחשב את המספרים…</p></>;
  const { firstValue: fv, revenue: rv, costs: cs, retention: rt, sales: sl, few } = data;
  const contacts = data.funnel[0].n + sl.leads;

  // Two groups: the WhatsApp funnel, then the shops that signed up. No rate across the border.
  const BORDER = 4;
  const rated = (i: number) => i > 0 && i !== BORDER && data.funnel[i - 1].n > 0;
  // The step with the biggest drop: "כאן זה דולף".
  const drops = data.funnel.map((f, i) => (rated(i) ? 1 - f.n / data.funnel[i - 1].n : -1));
  const leak = drops.indexOf(Math.max(...drops));
  const top = Math.max(1, ...data.funnel.map(f => f.n));
  const maxMrr = Math.max(1, ...rv.history.map(h => h.mrr));

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

      {/* Revenue */}
      <Card title="הכנסה" aside={<Few n={rv.paying} few={few} />}>
        <Stats>
          <Stat v={ils(rv.mrr)} l="הכנסה חודשית קבועה" />
          <Stat v={ils(rv.arr)} l="בקצב שנתי" />
          <Stat v={rv.paying} l="לקוחות משלמים" />
          <Stat v={rv.arpa == null ? "—" : ils(rv.arpa)} l="ממוצע ללקוח" />
          <Stat v={rv.newMrr ? `+${ils(rv.newMrr)}` : ils(0)} l="חדשה בתקופה" tone={rv.newMrr ? "ok" : undefined} />
          <Stat v={rv.churnedMrr ? `−${ils(rv.churnedMrr)}` : ils(0)} l="נעלמה בנטישה" tone={rv.churnedMrr ? "bad" : undefined} />
          <Stat v={ils(rv.collected)} l="נגבה בחשבוניות" />
          <Stat v={rv.trialsEnding7} l="ניסיונות שנגמרים השבוע" tone={rv.trialsEnding7 ? "warn" : undefined} />
        </Stats>
        {rv.history.every(h => !h.mrr) ? <Note>הגרף של 6 החודשים יתמלא מהלקוח המשלם הראשון.</Note> : <>
        <div className="mt-4 flex items-end gap-2 h-[120px]" aria-label="הכנסה חודשית קבועה, 6 חודשים">
          {rv.history.map(h => (
            <div key={h.month} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
              <span className="text-[11px]" style={{ ...NUM, color: C.muted }}>{h.mrr ? ils(h.mrr) : ""}</span>
              <div className="w-full rounded-t-lg" style={{ height: `${Math.max(h.mrr ? 8 : 2, (h.mrr / maxMrr) * 80)}px`, background: h.mrr ? C.turquoise : C.soft }} />
              <span className="text-[11px]" style={{ ...NUM, color: C.muted }}>{h.month.slice(5)}/{h.month.slice(2, 4)}</span>
            </div>
          ))}
        </div>
        <Note>משוחזר מתאריך התשלום, ההשהיה והמחיר החודשי. עוד אין היסטוריה של שינויי מחיר.</Note>
        </>}
      </Card>

      {/* Costs */}
      <Card title="עלויות" aside="30 יום אחרונים">
        <Stats>
          <Stat v={ils(cs.agentIls30)} l="הסוכנים של כל העסקים" />
          <Stat v={cs.perAccount == null ? "—" : ils(cs.perAccount)} l="לעסק פעיל בממוצע" />
          <Stat v={ils(cs.infraIls)} l="שרתים בחודש" />
          <Stat v={ils(cs.chatorAgentIls)} l="הסוכן של צ׳אטור בתקופה" />
          <Stat v={cs.perLead == null ? "—" : ils(cs.perLead)} l="לכל פנייה" />
          <Stat v={cs.perSignup == null ? "—" : ils(cs.perSignup)} l="לכל הרשמה" />
          <Stat v={cs.grossMarginPct == null ? "—" : `${cs.grossMarginPct}%`} l="רווח גולמי" tone={cs.grossMarginPct == null ? undefined : cs.grossMarginPct >= 80 ? "ok" : "warn"} />
        </Stats>
        {cs.top.length > 0 && <Note>הכי יקרים לנו: {cs.top.map(t => `${t.name} ${ils(t.ils)}${t.price ? ` (משלם ${ils(t.price)})` : ""}`).join(" · ")}</Note>}
        {cs.grossMarginPct == null && <Note>רווח גולמי יחושב כשתהיה הכנסה. עלות גיוס לקוח תתווסף כשנזין הוצאות שיווק.</Note>}
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
