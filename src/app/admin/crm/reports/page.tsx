"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { C, useCrm, ago } from "../ui";
import ConversationSheet from "../improvements/ConversationSheet";
import { ReportsPushBanner } from "../CrmPush";
import { Detail, STAGES, stageOf, scope, reportsLabel, type Data, type Stage } from "./ReportDetail";

/**
 * The reports screen (25.10.2026, Yair: "אני רוצה מקום סופר מסודר, אשתי תנהל את
 * זה מה-CRM ... אשתי תאשר"). Only the agent's problems, in four stages: חדש →
 * אצל סוכן התיקונים → מחכה לאישור → תוקן. One row per problem (reports from
 * several shops merge into one), one main action per problem, the rest in ⋯.
 * Data and actions are the improvements' (view=improvements, improvement.*),
 * so this and /admin/crm/improvements stay the same queue. Nika logs in with
 * her own reports-only login (members.ts); Yair sees it too.
 * Design: agents/dev-chator/עיצובים/דיווחים/הדמיה.html.
 */
/** Desktop width (md), kept up to date: there the first problem opens next to the list. */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function ReportsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const wide = useWide();
  const sp = useSearchParams();
  const { data, error, reload } = useCrm<Data>("view=improvements");
  const [conv, setConv] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const items = useMemo(() => (data?.items ?? []).filter(i => i.status !== "merged"), [data]);
  const count = (s: Stage) => items.filter(i => stageOf(i.status) === s).length;
  const fallback: Stage = count("approve") ? "approve" : "new";
  const stage = (sp.get("s") as Stage | null) ?? fallback;
  const list = items.filter(i => stageOf(i.status) === stage).sort((a, b) => b.reports.length - a.reports.length || +new Date(b.createdAt) - +new Date(a.createdAt));
  const id = sp.get("id");
  const sel = items.find(i => i.id === id) ?? null;
  const go = (s: Stage, itemId?: string, push = false) => {
    const q = new URLSearchParams({ s, ...(itemId ? { id: itemId } : {}) });
    (push ? router.push : router.replace)(`${pathname}?${q}`, { scroll: false });
  };
  // Desktop: the first problem of the stage is open; on the phone the list comes first.
  const shown = sel ?? (wide ? list[0] ?? null : null);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;

  const steps = (
    <nav aria-label="שלבים" className="grid grid-cols-4 gap-1 md:gap-2">
      {STAGES.map(s => {
        const on = stage === s.key;
        return (
          <button key={s.key} type="button" onClick={() => go(s.key)} aria-current={on ? "page" : undefined}
            className="rounded-xl px-2 py-2 md:px-3.5 md:py-2.5 flex flex-col md:flex-row md:items-center md:justify-between gap-0.5 md:gap-3 text-center md:text-right"
            style={on ? { background: C.petrol, color: "#fff" } : { background: "#fff", color: C.ink, border: `1px solid ${C.line}` }}>
            <span className="flex flex-col">
              <span className="text-[11px] leading-tight md:text-[15px] font-bold">{s.label}</span>
              <span className="hidden md:block text-xs" style={{ color: on ? "#A9D7CF" : C.muted }}>{s.sub}</span>
            </span>
            <span className="order-first md:order-none text-[18px] md:text-[22px] font-bold" style={{ fontFamily: "Outfit, Heebo, sans-serif" }}>{count(s.key)}</span>
          </button>
        );
      })}
    </nav>
  );
  const closed = count("closed");

  return (
    <div className="flex flex-col gap-4 max-w-6xl">
      <header className={`${shown && sel ? "hidden md:flex" : "flex"} flex-col gap-1`}>
        <h1 className="m-0 text-[26px] font-extrabold">דיווחים על הסוכן</h1>
        <p className="m-0 text-sm" style={{ color: C.muted }}>{count("approve") ? `${count("approve")} מחכים לאישור · ` : ""}{count("new")} חדשים לבדוק · תיקונים מוכנים כל בוקר</p>
      </header>
      <div className={sel ? "hidden md:block" : ""}><ReportsPushBanner /></div>
      <div className={sel ? "hidden md:block" : ""}>{steps}</div>
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}

      <div className="flex gap-5 items-start">
        <div className={`${sel ? "hidden md:flex" : "flex"} flex-col gap-2 w-full md:w-[380px] md:shrink-0`}>
          {list.length === 0 && <p className="m-0 rounded-2xl bg-white px-4 py-6 text-center text-sm" style={{ color: C.muted, border: `1px solid ${C.line}` }}>אין כאן כלום כרגע.</p>}
          {list.map(i => {
            const on = shown?.id === i.id;
            return (
              <button key={i.id} type="button" onClick={() => go(stage, i.id, true)} className="text-right bg-white rounded-2xl px-3.5 py-3 flex flex-col gap-1.5"
                style={{ border: on ? `2px solid ${C.petrol}` : `1px solid ${C.line}`, padding: on ? "11px 13px" : undefined }}>
                <span className="flex items-center gap-2 text-[15px] font-bold">{i.status === "pending" && i.reports.some(r => Date.now() - new Date(r.at).getTime() < 86400_000) && <i className="w-2 h-2 rounded-full shrink-0" style={{ background: C.coral }} aria-label="חדש" />}{i.title}</span>
                <span className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: C.muted }}>
                  <em className="not-italic text-xs font-bold px-2 py-0.5 rounded-full" style={i.kind === "base" ? { background: "#FFF1D6", color: "#7A4A00" } : { background: C.mist, color: C.petrol }}>{scope(i)}</em>
                  {reportsLabel(i)} · {ago(i.reports[i.reports.length - 1]?.at ?? i.createdAt)}
                </span>
              </button>
            );
          })}
          {stage !== "closed" && closed > 0 && <button type="button" onClick={() => go("closed")} className="self-start min-h-[36px] text-sm" style={{ color: C.muted }}>נסגרו ({closed})</button>}
          {stage === "closed" && <button type="button" onClick={() => go("new")} className="self-start min-h-[36px] text-sm" style={{ color: C.petrol }}>חזרה לחדשים</button>}
        </div>

        {shown && (
          <div className={`${sel ? "flex" : "hidden md:flex"} flex-col flex-1 min-w-0 bg-white rounded-3xl p-4 md:p-6`} style={{ border: `1px solid ${C.line}` }}>
            <button type="button" onClick={() => router.back()} className="md:hidden self-start mb-3 min-h-[44px] px-3 -ms-1 rounded-full inline-flex items-center gap-1.5 text-sm font-semibold" style={{ background: C.mist, color: C.petrol }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
              לרשימה
            </button>
            <Detail i={shown} openChat={setConv} onDone={async msg => { setFlash(msg); await reload(); if (sel) go(stage); }} />
          </div>
        )}
      </div>
      {conv && <ConversationSheet id={conv} evidence={null} onClose={() => setConv(null)} />}
    </div>
  );
}

export default function ReportsPage() {
  return <Suspense fallback={<p style={{ color: C.muted }}>טוען…</p>}><ReportsInner /></Suspense>;
}
