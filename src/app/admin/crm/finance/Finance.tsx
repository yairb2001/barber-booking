"use client";

import { useState } from "react";
import { C, NUM, Btn, Card, useCrm, crmAction, ils } from "../ui";
import { Few, Stat, Stats, Note, useSaasRange, type SaasData } from "../numbers/parts";

/**
 * כספים, its own place in the menu (27.10.2026, Yair: "שסקשן כספים יהיה לשונית נפרדת ולא בתוך
 * מספרים"): revenue, costs, and what a new customer costs us, with the monthly marketing spend
 * entered here. Same data as the dashboard (view=saas), the same period picker.
 */
const monthsBack = (n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).slice(0, 7); });
const monthName = (key: string) => new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(new Date(`${key}-15T12:00:00Z`));

/** The marketing spend of the last six months, each editable. */
function SpendEditor({ spend, onSaved }: { spend: Record<string, number>; onSaved: () => Promise<void> }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function save(m: string) {
    setBusy(m); setErr(null);
    const r = await crmAction({ action: "finance.marketingSpend", month: m, ils: Number(vals[m]) });
    setBusy(null);
    if (!r.ok) { setErr(r.error ?? "לא נשמר"); return; }
    setVals(v => { const n = { ...v }; delete n[m]; return n; });
    await onSaved();
  }
  return (
    <div className="flex flex-col gap-1.5 mt-4">
      <span className="text-[13px] font-semibold">הוצאות שיווק לפי חודש</span>
      {monthsBack(6).map(m => {
        const dirty = vals[m] != null && vals[m] !== String(spend[m] ?? "");
        return (
          <div key={m} className="flex items-center gap-2">
            <span className="text-sm flex-1">{monthName(m)}</span>
            <input type="number" min={0} inputMode="numeric" value={vals[m] ?? (spend[m] != null ? String(spend[m]) : "")} placeholder="0" onChange={e => setVals(v => ({ ...v, [m]: e.target.value }))}
              className="w-28 h-10 rounded-lg px-2 text-sm text-left" style={{ ...NUM, border: `1px solid ${C.line}` }} aria-label={`הוצאות שיווק ב${monthName(m)}`} />
            <span className="text-sm" style={{ color: C.muted }}>₪</span>
            <Btn kind="dark" className="!min-h-[38px] !px-3" disabled={!dirty || busy === m || vals[m] === ""} onClick={() => void save(m)}>{busy === m ? "שומר…" : "שמור"}</Btn>
          </div>
        );
      })}
      {err && <p className="m-0 text-sm" style={{ color: "#B42318" }}>{err}</p>}
    </div>
  );
}

export default function Finance() {
  const { query, picker } = useSaasRange();
  const { data, error, reload } = useCrm<SaasData>(query);
  if (error) return <>{picker}<p className="text-red-700">{error}</p></>;
  if (!data) return <>{picker}<p style={{ color: C.muted }}>מחשב את המספרים…</p></>;
  const { revenue: rv, costs: cs, unit, few } = data;
  const maxMrr = Math.max(1, ...rv.history.map(h => h.mrr));

  return (
    <div className="flex flex-col gap-4">
      {picker}

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
        {cs.grossMarginPct == null && <Note>רווח גולמי יחושב כשתהיה הכנסה.</Note>}
      </Card>

      {/* What a new customer costs, and what he leaves */}
      <Card title="עלות גיוס לקוח" aside={<Few n={unit.newPaying} few={few} />}>
        <Stats>
          <Stat v={ils(unit.spendIls)} l="הוצאות שיווק בתקופה" />
          <Stat v={unit.newPaying} l="משלמים חדשים בתקופה" />
          <Stat v={unit.cac == null ? "—" : ils(unit.cac)} l="עלות גיוס לקוח" />
          <Stat v={unit.marginPerCustomer == null ? "—" : ils(unit.marginPerCustomer)} l="רווח חודשי מלקוח" tone={unit.marginPerCustomer != null && unit.marginPerCustomer <= 0 ? "bad" : undefined} />
          <Stat v={unit.paybackMonths == null ? "—" : `${unit.paybackMonths} חודשים`} l="עד שההשקעה חוזרת" />
        </Stats>
        <Note>עלות גיוס = הוצאות השיווק והסוכן של צ׳אטור בתקופה, חלקי המשלמים החדשים בה. רווח חודשי מלקוח = המחיר פחות עלות הסוכן שלו וחלקו בשרתים.</Note>
        <SpendEditor spend={unit.spend} onSaved={reload} />
      </Card>
    </div>
  );
}
