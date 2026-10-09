"use client";

import Link from "next/link";
import { C, NUM, TONE, Card, Tag, PageHead, useCrm, ils, SOURCE_LABEL, type Tone } from "./ui";

type Home = {
  testKey: boolean;
  kpis: { mrr: number; paying: number; newPayingThisMonth: number; trials: number; trialsEndingWeek: number; leadsWeek: number; leadsWeekBySource: { source: string; n: number }[]; churnedThisMonth: number; churnPct: number };
  todo: { tone: Tone; tag: string; title: string; detail: string; href: string }[];
  funnel: { label: string; n: number }[];
  callsToday: { time: string; leadId: string | null; name: string; shop: string; booked: boolean }[];
  money: { revenue: number; tokensIls: number; infraIls: number; left: number };
};

const FILLS = ["#BDEFDC", "#8FE6C6", C.turquoise, "#2BC293"];

export default function CrmHome() {
  const { data, error, loading } = useCrm<Home>("view=home");
  const today = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" }).format(new Date());
  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>{loading ? "טוען…" : ""}</p>;
  const k = data.kpis;
  const calls = data.callsToday.filter(c => c.booked).length;
  const bySource = k.leadsWeekBySource.map(s => `${s.n} ${SOURCE_LABEL[s.source] ?? s.source}`).join(" · ");
  const top = data.funnel[0]?.n || 0;
  const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
  const kpis = [
    { label: "הכנסה חודשית קבועה", value: ils(k.mrr), sub: k.newPayingThisMonth ? `+${k.newPayingThisMonth} משלמים החודש` : "אין משלמים חדשים החודש", tone: k.newPayingThisMonth ? "ok" : "info" },
    { label: "לקוחות משלמים", value: String(k.paying), sub: "", tone: "info" },
    { label: "בניסיון חינם", value: String(k.trials), sub: k.trialsEndingWeek ? `${k.trialsEndingWeek} מסתיימים השבוע` : "", tone: "warn" },
    { label: "לידים השבוע", value: String(k.leadsWeek), sub: bySource, tone: "info" },
    { label: "עזבו החודש", value: String(k.churnedThisMonth), sub: `נטישה ${k.churnPct}%`, tone: k.churnedThisMonth ? "bad" : "info" },
  ] as const;

  return (
    <div className="flex flex-col gap-5">
      <PageHead title="בוקר טוב, יאיר" sub={`${today} · ${calls} שיחות היום · ${data.todo.length} דברים לטפל`} actions={<Link href="/admin/crm/leads?new=1" className="min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center" style={{ background: C.coral, color: C.ink, textDecoration: "none" }}>+ ליד חדש</Link>} />

      {!data.testKey && (
        <p className="m-0 text-[13px] rounded-xl px-4 py-3" style={{ background: TONE.warn.bg, color: TONE.warn.color }}>
          מפתח הבדיקות עוד לא מחובר, אז בדיקות וארגז החול עדיין על המפתח של הפרודקשן. ראה הגדרות.
        </p>
      )}

      <section aria-label="מספרים מרכזיים" className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        {kpis.map(x => (
          <div key={x.label} className="rounded-2xl px-4 py-4 flex flex-col gap-1.5" style={{ background: "#fff", border: `1px solid ${C.line}` }}>
            <span className="text-[13px]" style={{ color: C.muted }}>{x.label}</span>
            <span className="text-[30px] font-bold leading-tight" style={{ ...NUM, color: C.petrol }}>{x.value}</span>
            {x.sub && <span className="text-xs font-medium" style={{ color: x.tone === "info" ? C.muted : TONE[x.tone].color }}>{x.sub}</span>}
          </div>
        ))}
      </section>

      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[999_1_520px] min-w-0 flex flex-col gap-5">
          <Card title="צריך טיפול היום" aside="נבנה אוטומטית מהלקוחות והלידים">
            {data.todo.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>הכול תקין. אין כרגע לקוח או ליד שמחכה לך.</p>}
            {data.todo.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-3.5 py-3.5" style={{ borderTop: `1px solid ${C.soft}` }}>
                <Tag tone={t.tone}>{t.tag}</Tag>
                <div className="flex-[1_1_220px] min-w-0">
                  <Link href={t.href} className="font-bold text-[15px]" style={{ color: C.ink, textDecoration: "none" }}>{t.title}</Link>
                  {t.detail && <div className="text-[13px]" style={{ color: C.muted }}>{t.detail}</div>}
                </div>
                <Link href={t.href} className="min-h-[40px] px-3.5 rounded-[10px] text-sm font-semibold inline-flex items-center" style={{ border: `1px solid ${C.petrol}`, color: C.petrol, textDecoration: "none" }}>פתח</Link>
              </div>
            ))}
          </Card>

          <Card title="המשפך החודש" aside="מליד ועד לקוח משלם">
            <div className="flex flex-col gap-3">
              {data.funnel.map((f, i) => {
                const prev = i === 0 ? f.n : data.funnel[i - 1].n;
                return (
                  <div key={f.label} className="grid items-center gap-3.5" style={{ gridTemplateColumns: "120px minmax(0,1fr) 140px" }}>
                    <span className="text-sm font-semibold">{f.label}</span>
                    <div className="h-[30px] rounded-lg overflow-hidden" style={{ background: C.soft }}>
                      <div className="h-full rounded-lg flex items-center ps-2.5" style={{ width: `${Math.max(top ? (f.n / top) * 100 : 0, f.n ? 6 : 0)}%`, background: FILLS[i] }}>
                        <span className="text-sm font-bold" style={NUM}>{f.n}</span>
                      </div>
                    </div>
                    <span className="text-[13px]" style={{ color: C.muted }}>{i === 0 ? "" : `${pct(f.n, prev)}% מהשלב הקודם`}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <aside className="flex-[1_1_300px] min-w-0 flex flex-col gap-5">
          <Card dark title="השיחות שלי היום" aside={<Link href="/admin/crm/calendar" style={{ color: C.turquoise }}>ליומן</Link>}>
            {data.callsToday.length === 0 && <p className="m-0 text-sm" style={{ color: "#A9C9C4" }}>אין היום חלון שיחות פתוח.</p>}
            {data.callsToday.map((c, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5" style={{ borderTop: "1px solid #1E5C5B" }}>
                <span className="w-12 font-semibold" style={{ ...NUM, color: C.turquoise }}>{c.time}</span>
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="font-semibold text-sm" style={{ color: c.booked ? "#fff" : "#A9C9C4" }}>{c.name}</span>
                  <span className="text-xs" style={{ color: "#A9C9C4" }}>{c.shop}</span>
                </div>
                {c.leadId && <Link href={`/admin/crm/leads/${c.leadId}`} className="text-xs font-bold rounded-lg px-2.5 py-1.5" style={{ background: C.turquoise, color: C.ink, textDecoration: "none" }}>כרטיס</Link>}
              </div>
            ))}
          </Card>

          <Card title="רווחיות החודש">
            {[
              ["הכנסה חודשית", ils(data.money.revenue), C.ink],
              ["טוקנים (כל הסוכנים)", `−${ils(data.money.tokensIls)}`, "#B42318"],
              ["שרתים ודאטה בייס", `−${ils(data.money.infraIls)}`, "#B42318"],
              ["נשאר", `${ils(data.money.left)}${data.money.revenue > 0 ? ` · ${pct(data.money.left, data.money.revenue)}%` : ""}`, data.money.left >= 0 ? "#0F6B4F" : "#B42318"],
            ].map(([l, v, col]) => (
              <div key={l} className="flex justify-between text-sm pb-2 mb-2" style={{ borderBottom: `1px solid ${C.soft}` }}>
                <span style={{ color: C.muted }}>{l}</span>
                <span className="font-bold" style={{ ...NUM, color: col }}>{v}</span>
              </div>
            ))}
            <p className="m-0 text-xs" style={{ color: C.muted }}>טוקנים = עלות הסוכנים של כל הלקוחות יחד, בלי בדיקות. לקוח שעולה יותר ממה שהוא משלם מסומן בלקוחות.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
