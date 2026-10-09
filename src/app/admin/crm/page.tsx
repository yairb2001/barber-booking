"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { C, NUM, TONE, Card, Tag, PageHead, useCrm, crmAction, ils, ago, SOURCE_LABEL, type Tone } from "./ui";
import { CrmPushBanner } from "./CrmPush";

/**
 * CRM home (10.10.2026, Yair: "התראות בנפרד, משימות בנפרד"): three tabs.
 * משימות = what to DO (calls, outcomes to mark, leads to call back, stuck
 * setups, plus tasks he writes himself); התראות = what HAPPENED (every alert
 * that also reaches him on WhatsApp), read/unread; מספרים = the business.
 */

type Task = { id: string; kind: "call" | "outcome" | "followup" | "lead" | "setup" | "customer" | "calendar" | "automations" | "manual"; title: string; detail: string; href: string | null; time?: string | null; due?: string | null; overdue?: boolean; done?: boolean };
type Notif = { id: string; kind: string; title: string; body: string | null; href: string | null; at: string; read: boolean };
type Home = {
  testKey: boolean;
  tasks: Task[];
  notifications: Notif[];
  unread: number;
  kpis: { mrr: number; paying: number; newPayingThisMonth: number; trials: number; trialsEndingWeek: number; leadsWeek: number; leadsWeekBySource: { source: string; n: number }[]; churnedThisMonth: number; churnPct: number };
  funnel: { label: string; n: number }[];
  callsToday: { time: string; leadId: string | null; name: string; shop: string; booked: boolean }[];
  money: { revenue: number; tokensIls: number; infraIls: number; left: number };
};

const TASK_TAG: Record<Task["kind"], [string, Tone]> = {
  call: ["שיחה", "info"], outcome: ["תוצאה", "warn"], followup: ["לחזור", "info"], lead: ["ליד", "warn"],
  setup: ["הקמה", "warn"], customer: ["לקוח", "bad"], calendar: ["יומן", "warn"], automations: ["אוטומציות", "info"], manual: ["שלי", "ok"],
};
const NOTIF_TAG: Record<string, [string, Tone]> = { lead: ["ליד", "ok"], call: ["שיחה", "info"], customer: ["לקוח", "info"], whatsapp: ["וואטסאפ", "warn"], system: ["מערכת", "bad"] };
const FILLS = ["#BDEFDC", "#8FE6C6", C.turquoise, "#2BC293"];
const TABS = [["tasks", "משימות"], ["alerts", "התראות"], ["numbers", "מספרים"]] as const;
type TabKey = (typeof TABS)[number][0];

const isoDay = (offset: number) => {
  const d = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const dueLabel = (iso: string) => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return day === isoDay(0) ? "היום" : day === isoDay(1) ? "מחר" : `${Number(day.slice(8, 10))}.${Number(day.slice(5, 7))}`;
};

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? "בוקר טוב" : h < 17 ? "צהריים טובים" : h < 22 ? "ערב טוב" : "לילה טוב";
}

function CrmHomeInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const tab = (TABS.some(([k]) => k === sp.get("tab")) ? sp.get("tab") : "tasks") as TabKey;
  const { data, error, loading, reload } = useCrm<Home>("view=home");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<string>(isoDay(0));
  const [busy, setBusy] = useState(false);
  const today = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" }).format(new Date());

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>{loading ? "טוען…" : ""}</p>;

  const open = data.tasks.filter(t => !t.done);
  const done = data.tasks.filter(t => t.done);
  const ordered = [...open].sort((a, b) => Number(!!b.overdue) - Number(!!a.overdue) || (a.time ?? "~").localeCompare(b.time ?? "~"));
  const setTab = (k: TabKey) => router.replace(k === "tasks" ? "/admin/crm" : `/admin/crm?tab=${k}`, { scroll: false });

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const r = await crmAction(body);
    setBusy(false);
    if (r.ok) await reload();
    return r;
  }
  async function addTask() {
    if (!title.trim()) return;
    const r = await act({ action: "task.create", title, due });
    if (r.ok) setTitle("");
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHead title={`${greeting()}, יאיר`} sub={`${today} · ${open.length} משימות · ${data.unread} התראות חדשות`} actions={<Link href="/admin/crm/leads?new=1" className="min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center" style={{ background: C.coral, color: C.ink, textDecoration: "none" }}>+ ליד חדש</Link>} />

      {!data.testKey && (
        <p className="m-0 text-[13px] rounded-xl px-4 py-3" style={{ background: TONE.warn.bg, color: TONE.warn.color }}>
          מפתח הבדיקות עוד לא מחובר, אז בדיקות וארגז החול עדיין על המפתח של הפרודקשן. ראה הגדרות.
        </p>
      )}

      <CrmPushBanner />

      <div role="tablist" aria-label="מסך הבית" className="grid grid-cols-3 gap-1 p-1 rounded-2xl" style={{ background: C.soft }}>
        {TABS.map(([k, l]) => {
          const n = k === "tasks" ? open.length : k === "alerts" ? data.unread : 0;
          return (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="min-h-[44px] rounded-xl text-[15px] font-semibold inline-flex items-center justify-center gap-1.5" style={tab === k ? { background: "#fff", color: C.petrol, boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: C.muted }}>
              {l}
              {n > 0 && <span className="min-w-[22px] h-[22px] px-1.5 rounded-full text-xs font-bold inline-flex items-center justify-center" style={{ ...NUM, background: k === "alerts" ? C.coral : C.petrol, color: k === "alerts" ? C.ink : "#fff" }}>{n}</span>}
            </button>
          );
        })}
      </div>

      {tab === "tasks" && (
        <>
          <section className="bg-white rounded-2xl p-3 flex flex-col gap-2" style={{ border: `1px solid ${C.line}` }}>
            <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void addTask(); }} placeholder="משימה חדשה, למשל: להתקשר לדני מחולון" className="h-11 rounded-xl px-3 text-[15px]" style={{ border: "1px solid #C7D8D5" }} aria-label="משימה חדשה" />
            <div className="flex flex-wrap items-center gap-1.5">
              {[["היום", isoDay(0)], ["מחר", isoDay(1)]].map(([l, v]) => (
                <button key={v} type="button" onClick={() => setDue(v)} className="h-9 px-3 rounded-full text-sm" style={due === v ? { background: C.petrol, color: "#fff" } : { border: `1px solid ${C.line}`, color: C.petrol }}>{l}</button>
              ))}
              <input type="date" value={due} min={isoDay(0)} onChange={e => setDue(e.target.value || isoDay(0))} className="h-9 rounded-full px-2 text-sm" style={{ border: `1px solid ${C.line}` }} aria-label="תאריך" />
              <button type="button" disabled={busy || !title.trim()} onClick={() => void addTask()} className="h-9 px-4 rounded-full text-sm font-bold ms-auto disabled:opacity-50" style={{ background: C.coral, color: C.ink }}>הוסף</button>
            </div>
          </section>

          <section className="bg-white rounded-2xl" style={{ border: `1px solid ${C.line}` }}>
            {ordered.length === 0 && <p className="m-0 p-4 text-sm" style={{ color: C.muted }}>אין משימות פתוחות. השולחן נקי.</p>}
            {ordered.map((t, i) => {
              const [tag, tone] = TASK_TAG[t.kind];
              const when = t.time ?? (t.due ? dueLabel(t.due) : null);
              return (
                <div key={t.id} className="flex items-center gap-3 px-3.5 py-3" style={{ borderTop: i ? `1px solid ${C.soft}` : undefined }}>
                  {t.kind === "manual"
                    ? <input type="checkbox" checked={false} disabled={busy} onChange={() => void act({ action: "task.toggle", id: t.id, done: true })} className="w-[22px] h-[22px] shrink-0" style={{ accentColor: C.petrol }} aria-label={`בוצע: ${t.title}`} />
                    : <span className="shrink-0"><Tag tone={tone}>{tag}</Tag></span>}
                  <div className="flex-1 min-w-0">
                    {t.href ? <Link href={t.href} className="font-semibold text-[15px] block" style={{ color: C.ink, textDecoration: "none" }}>{t.title}</Link> : <span className="font-semibold text-[15px] block">{t.title}</span>}
                    {(t.detail || when) && <div className="text-[13px] truncate" style={{ color: t.overdue ? "#B42318" : C.muted }}>{[when && (t.overdue && t.kind === "manual" ? `באיחור · ${when}` : when), t.detail].filter(Boolean).join(" · ")}</div>}
                  </div>
                  {t.kind === "manual"
                    ? <button type="button" disabled={busy} onClick={() => confirm("למחוק את המשימה?") && void act({ action: "task.delete", id: t.id })} className="w-10 h-10 rounded-lg shrink-0" style={{ color: C.muted }} aria-label={`מחק: ${t.title}`}>×</button>
                    : t.href && <Link href={t.href} className="shrink-0 min-h-[40px] px-3 rounded-[10px] text-sm font-semibold inline-flex items-center" style={{ border: `1px solid ${C.petrol}`, color: C.petrol, textDecoration: "none" }}>פתח</Link>}
                </div>
              );
            })}
          </section>

          {done.length > 0 && (
            <details className="bg-white rounded-2xl px-3.5 py-2" style={{ border: `1px solid ${C.line}` }}>
              <summary className="text-sm cursor-pointer min-h-[36px] flex items-center" style={{ color: C.muted }}>בוצעו היום ({done.length})</summary>
              {done.map(t => (
                <label key={t.id} className="flex items-center gap-3 py-2 text-sm" style={{ color: C.muted, textDecoration: "line-through" }}>
                  <input type="checkbox" checked disabled={busy} onChange={() => void act({ action: "task.toggle", id: t.id, done: false })} className="w-[20px] h-[20px]" style={{ accentColor: C.petrol }} />
                  {t.title}
                </label>
              ))}
            </details>
          )}

          <p className="m-0 text-xs" style={{ color: C.muted }}>
            {data.callsToday.filter(c => !c.booked).length > 0 ? `היום פתוחים עוד ${data.callsToday.filter(c => !c.booked).length} זמנים לשיחות. ` : ""}
            <Link href="/admin/crm/calendar" style={{ color: C.petrol }}>ליומן השיחות</Link>
          </p>
        </>
      )}

      {tab === "alerts" && (
        <section className="bg-white rounded-2xl" style={{ border: `1px solid ${C.line}` }}>
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5" style={{ borderBottom: `1px solid ${C.soft}` }}>
            <span className="text-sm" style={{ color: C.muted }}>{data.unread ? `${data.unread} חדשות` : "הכל נקרא"}</span>
            {data.unread > 0 && <button type="button" disabled={busy} onClick={() => void act({ action: "notif.readAll" })} className="min-h-[40px] px-2 text-sm font-semibold" style={{ color: C.petrol }}>סמן הכל כנקרא</button>}
          </div>
          {data.notifications.length === 0 && <p className="m-0 p-4 text-sm" style={{ color: C.muted }}>אין עדיין התראות. ליד חדש, שיחה שנקבעה, וואטסאפ של לקוח שהתנתק, הכל יופיע כאן.</p>}
          {data.notifications.map((n, i) => {
            const [tag, tone] = NOTIF_TAG[n.kind] ?? ["מערכת", "info" as Tone];
            const open = async () => { if (!n.read) await crmAction({ action: "notif.read", id: n.id }); if (n.href) router.push(n.href); else void reload(); };
            return (
              <button key={n.id} type="button" onClick={() => void open()} className="w-full text-right flex items-start gap-3 px-3.5 py-3" style={{ borderTop: i ? `1px solid ${C.soft}` : undefined, background: n.read ? "#fff" : "#F2FBF8" }}>
                <span className="shrink-0 pt-0.5"><Tag tone={tone}>{tag}</Tag></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px]" style={{ fontWeight: n.read ? 400 : 700, color: C.ink }}>{n.title}</span>
                  {n.body && <span className="block text-[13px] truncate" style={{ color: C.muted }}>{n.body}</span>}
                </span>
                <span className="shrink-0 text-xs pt-1 whitespace-nowrap" style={{ color: C.muted }}>{ago(n.at)}</span>
              </button>
            );
          })}
        </section>
      )}

      {tab === "numbers" && <Numbers data={data} />}
    </div>
  );
}

function Numbers({ data }: { data: Home }) {
  const k = data.kpis;
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
    <>
      <section aria-label="מספרים מרכזיים" className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {kpis.map(x => (
          <div key={x.label} className="rounded-2xl px-4 py-4 flex flex-col gap-1.5" style={{ background: "#fff", border: `1px solid ${C.line}` }}>
            <span className="text-[13px]" style={{ color: C.muted }}>{x.label}</span>
            <span className="text-[28px] font-bold leading-tight" style={{ ...NUM, color: C.petrol }}>{x.value}</span>
            {x.sub && <span className="text-xs font-medium" style={{ color: x.tone === "info" ? C.muted : TONE[x.tone].color }}>{x.sub}</span>}
          </div>
        ))}
      </section>
      <Card title="המשפך החודש" aside="מליד ועד לקוח משלם">
        <div className="flex flex-col gap-3">
          {data.funnel.map((f, i) => {
            const prev = i === 0 ? f.n : data.funnel[i - 1].n;
            return (
              <div key={f.label} className="grid items-center gap-3" style={{ gridTemplateColumns: "96px minmax(0,1fr)" }}>
                <span className="text-sm font-semibold">{f.label}</span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="h-[28px] rounded-lg overflow-hidden" style={{ background: C.soft }}>
                    <div className="h-full rounded-lg flex items-center ps-2.5" style={{ width: `${Math.max(top ? (f.n / top) * 100 : 0, f.n ? 6 : 0)}%`, background: FILLS[i] }}>
                      <span className="text-sm font-bold" style={NUM}>{f.n}</span>
                    </div>
                  </div>
                  {i > 0 && <span className="text-xs" style={{ color: C.muted }}>{pct(f.n, prev)}% מהשלב הקודם</span>}
                </div>
              </div>
            );
          })}
        </div>
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
        <p className="m-0 text-xs" style={{ color: C.muted }}>טוקנים = עלות הסוכנים של כל הלקוחות יחד, בלי בדיקות.</p>
      </Card>
    </>
  );
}

export default function CrmHome() {
  return <Suspense fallback={<p style={{ color: C.muted }}>טוען…</p>}><CrmHomeInner /></Suspense>;
}
