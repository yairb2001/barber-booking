"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { C, useCrm, crmAction, ago } from "../ui";
import ConversationSheet from "../improvements/ConversationSheet";

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
type Fix = {
  summary: string; appliesTo: string; before?: string; after?: string; tested?: string;
  promptBefore?: number; promptAfter?: number; growthReason?: string; question?: string;
  history?: { at: string; who: string; text: string }[];
};
type Report = { at: string; source: string; businessName: string; author?: string | null; text: string; evidence?: string | null; conversationId?: string | null };
type Item = {
  id: string; businessId: string; businessName: string; source: string; kind: "rule" | "faq" | "setup" | "base"; title: string; proposal: string;
  evidence: string | null; conversations: string[]; status: string; createdAt: string; decidedAt: string | null; decidedBy: string | null;
  fix: Fix | null; growthNeedsOk: boolean; reports: Report[];
};
type Data = { items: Item[] };
type Stage = "new" | "agent" | "approve" | "done" | "closed";

const STAGES: { key: Exclude<Stage, "closed">; label: string; sub: string; st: string[] }[] = [
  { key: "new", label: "חדש", sub: "לבדוק ולשלוח לתיקון", st: ["pending"] },
  { key: "agent", label: "אצל סוכן התיקונים", sub: "מכין תיקון בבוקר", st: ["queued", "publish", "revert"] },
  { key: "approve", label: "מחכה לאישור", sub: "לפני ואחרי, ואישור", st: ["review", "question"] },
  { key: "done", label: "תוקן", sub: "העסק קיבל הודעה", st: ["applied", "approved"] },
];
const stageOf = (status: string): Stage => STAGES.find(s => s.st.includes(status))?.key ?? "closed";
const PROMPT_MAX = 15_000;
const n = (x: number) => x.toLocaleString("he-IL");
const scope = (i: Item) => (i.kind === "base" ? "כל העסקים" : `רק ${i.businessName}`);
const reportsLabel = (i: Item) => (i.source === "yair" ? "רעיון של יאיר" : i.reports.length > 1 ? `${i.reports.length} דיווחים` : i.reports.length === 1 ? "דיווח אחד" : "מהבדיקה");

/** "על התשובה «...»: why" lines (a report from a chat) → quote + why; anything else stays text. */
function parseReport(text: string): { quote: string | null; why: string }[] {
  return text.split("\n").filter(Boolean).map(line => {
    const m = line.match(/^על התשובה «(.+?)»: (.*)$/);
    return m ? { quote: m[1], why: m[2] } : { quote: null, why: line.replace(/^ובכללי: /, "") };
  });
}

function Dots() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>;
}

/** The ⋯ menu: plain details/summary, closes after a choice. */
function More({ items }: { items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="relative">
      <button type="button" aria-label="עוד פעולות" aria-expanded={open} onClick={() => setOpen(o => !o)} className="w-12 h-12 rounded-xl inline-flex items-center justify-center bg-white" style={{ border: `1px solid ${C.line}`, color: C.petrol }}><Dots /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute bottom-14 end-0 z-20 w-64 bg-white rounded-2xl p-1.5 flex flex-col" style={{ border: `1px solid ${C.line}`, boxShadow: "0 14px 34px rgba(11,31,33,0.16)" }}>
            {items.map((it, k) => (
              <button key={k} type="button" role="menuitem" onClick={() => { setOpen(false); it.onClick(); }} className="min-h-[44px] px-3 rounded-xl text-right text-[15px] hover:bg-[#F4F7F6]" style={{ color: it.danger ? "#B42318" : C.ink }}>{it.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Bubble({ label, text, tone }: { label: string; text: string; tone: "agent" | "bad" | "good" }) {
  const bg = tone === "bad" ? "#FDECEA" : tone === "good" ? "#E3F7EF" : "#D9FDD3";
  const fg = tone === "bad" ? "#B42318" : "#0F6B4F";
  return (
    <p className="m-0 rounded-2xl px-3 py-2 text-[15px] leading-relaxed self-start max-w-[92%] whitespace-pre-wrap [overflow-wrap:anywhere] flex flex-col gap-0.5" style={{ background: bg }}>
      <span className="text-[11px] font-bold" style={{ color: fg }}>{label}</span>{text}
    </p>
  );
}

function Detail({ i, onDone, openChat }: { i: Item; onDone: (msg: string) => Promise<void>; openChat: (id: string) => void }) {
  const [proposal, setProposal] = useState(i.proposal);
  const [answer, setAnswer] = useState("");
  const [revising, setRevising] = useState(false);
  const [growthOk, setGrowthOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setProposal(i.proposal); setAnswer(""); setRevising(false); setGrowthOk(false); setErr(null); }, [i.id, i.proposal]);

  async function act(body: Record<string, unknown>, msg: string) {
    setBusy(true); setErr(null);
    const r = await crmAction({ ...body, id: i.id });
    setBusy(false);
    if (r.ok) await onDone(msg); else setErr(r.error ?? "הפעולה נכשלה");
  }
  const st = i.status;
  const fx = i.fix;
  const recent = !!i.decidedAt && Date.now() - new Date(i.decidedAt).getTime() < 7 * 86400_000;
  const reject = { label: "זו לא בעיה, לסגור", danger: true, onClick: () => void act({ action: "improvement.reject" }, "נסגר") };

  let main: React.ReactNode = null;
  let more: { label: string; danger?: boolean; onClick: () => void }[] = [];
  if (st === "pending") {
    main = <button type="button" disabled={busy || !proposal.trim()} onClick={() => void act({ action: "improvement.queue", proposal }, "נשלח לסוכן התיקונים. התיקון יחכה לאישור מחר בבוקר.")} className="flex-1 min-h-[52px] rounded-2xl text-white text-[16px] font-extrabold disabled:opacity-50" style={{ background: C.petrol }}>{busy ? "שולח…" : "שלח לתיקון"}</button>;
    more = [...(i.kind === "setup" || i.kind === "faq" ? [{ label: "החל עכשיו (מילה או שתיים)", onClick: () => void act({ action: "improvement.decide", approve: true, proposal }, "הוחל על הסוכן") }] : []), reject];
  } else if (st === "review" && !revising) {
    main = <button type="button" disabled={busy || (i.growthNeedsOk && !growthOk)} onClick={() => void act({ action: "improvement.publish", growthOk }, fx && (fx as { plan?: { type?: string } }).plan?.type === "code" ? "אושר. עולה לאוויר בריצה של הבוקר." : "אושר והוחל. העסק קיבל הודעה.")} className="flex-1 min-h-[52px] rounded-2xl text-white text-[16px] font-extrabold disabled:opacity-50" style={{ background: C.petrol }}>{busy ? "מאשר…" : "אשר והעלה"}</button>;
    more = [{ label: "בקש שינוי בתיקון", onClick: () => setRevising(true) }, { label: "דחה את התיקון", danger: true, onClick: () => void act({ action: "improvement.reject" }, "נדחה") }];
  } else if (st === "question" || (st === "review" && revising)) {
    main = <button type="button" disabled={busy || !answer.trim()} onClick={() => void act({ action: "improvement.revise", text: answer }, "נשלח לסוכן התיקונים. התיקון יחזור לאישור מחר בבוקר.")} className="flex-1 min-h-[52px] rounded-2xl text-white text-[16px] font-extrabold disabled:opacity-50" style={{ background: C.petrol }}>{busy ? "שולח…" : st === "question" ? "שלח תשובה" : "שלח לתיקון מחדש"}</button>;
    more = st === "question" ? [reject] : [{ label: "ביטול", onClick: () => setRevising(false) }];
  } else if (st === "queued") {
    more = [{ label: "החזר לחדש", onClick: () => void act({ action: "improvement.unqueue" }, "חזר לחדש") }, reject];
  } else if (st === "applied" && recent) {
    more = [{ label: "החזר אחורה", danger: true, onClick: () => { if (confirm("להחזיר את התיקון אחורה?")) void act({ action: "improvement.revert" }, "מוחזר אחורה") } }];
  } else if (st === "rejected") {
    more = [{ label: "פתח מחדש", onClick: () => void act({ action: "improvement.reopen" }, "נפתח מחדש") }];
  }
  const info: Record<string, string> = {
    queued: "סוכן התיקונים יכין תיקון בריצה של מחר בבוקר, ואז זה יעבור למחכה לאישור.",
    publish: "אושר. עולה לאוויר בריצה של הבוקר.",
    revert: "מוחזר אחורה בריצה של הבוקר.",
    applied: `עלה לאוויר${i.decidedAt ? ` ${ago(i.decidedAt)}` : ""}${i.decidedBy ? ` · אישר: ${i.decidedBy}` : ""}${i.reports.some(r => r.source === "feedback") ? " · העסק קיבל הודעה שתוקן" : ""}`,
    approved: "אושר לביצוע ידני.",
    rejected: `נסגר${i.decidedBy ? ` · ${i.decidedBy}` : ""}`,
  };

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <span className="self-start text-xs font-bold px-2.5 py-1 rounded-full" style={i.kind === "base" ? { background: "#FFF1D6", color: "#7A4A00" } : { background: C.mist, color: C.petrol }}>{scope(i)}</span>
        <h2 className="m-0 text-[22px] font-extrabold leading-snug">{i.title}</h2>
        <p className="m-0 text-[13px]" style={{ color: C.muted }}>{STAGES.find(s => s.key === stageOf(st))?.label ?? "נסגר"} · {reportsLabel(i)} · {ago(i.createdAt)}</p>
      </header>

      {info[st] && <p className="m-0 text-sm rounded-2xl px-4 py-3" style={{ background: C.soft, color: C.ink }}>{info[st]}</p>}

      {/* The fix to approve: what changes, before and after, the prompt's size. */}
      {(st === "review" || st === "applied") && fx && (
        <section className="flex flex-col gap-3">
          <h3 className="m-0 text-[13px] font-bold" style={{ color: C.muted }}>התיקון</h3>
          <p className="m-0 text-[16px] leading-relaxed">{fx.summary}</p>
          {fx.appliesTo && <p className="m-0 text-xs" style={{ color: C.muted }}>חל על: {fx.appliesTo}</p>}
          {fx.before && <Bubble label="לפני" text={fx.before} tone="bad" />}
          {fx.after && <Bubble label="אחרי" text={fx.after} tone="good" />}
          {fx.promptBefore != null && fx.promptAfter != null && (
            <div className="flex flex-col gap-1.5">
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "#E3ECEA" }}><div className="h-full rounded-full" style={{ width: `${Math.min(100, (fx.promptAfter / PROMPT_MAX) * 100)}%`, background: fx.promptAfter > PROMPT_MAX ? "#D92D20" : C.petrol2 }} /></div>
              <span className="text-xs" style={{ color: C.muted }}>גודל הפרומפט: {n(fx.promptBefore)} → {n(fx.promptAfter)} תווים, מתוך {n(PROMPT_MAX)}</span>
            </div>
          )}
          {st === "review" && i.growthNeedsOk && (
            <div className="rounded-2xl px-4 py-3 flex flex-col gap-2" style={{ background: "#FFF1D6", color: "#633806" }}>
              <p className="m-0 text-sm"><b>התיקון מגדיל את הפרומפט.</b> {fx.growthReason}</p>
              <label className="flex items-center gap-2 text-sm min-h-[36px]"><input type="checkbox" checked={growthOk} onChange={e => setGrowthOk(e.target.checked)} className="w-5 h-5" />מאשר להגדיל</label>
            </div>
          )}
          {fx.tested && <p className="m-0 text-xs" style={{ color: C.muted }}>נבדק: {fx.tested}</p>}
        </section>
      )}

      {st === "question" && fx?.question && <Bubble label="סוכן התיקונים שואל" text={fx.question} tone="agent" />}

      {/* What the shops reported. */}
      {i.reports.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h3 className="m-0 text-[13px] font-bold" style={{ color: C.muted }}>מה דיווחו</h3>
          {i.reports.map((r, k) => (
            <div key={k} className="rounded-2xl p-3.5 flex flex-col gap-2" style={{ background: C.ground }}>
              <p className="m-0 text-[13px]" style={{ color: C.muted }}><b style={{ color: C.ink }}>{r.businessName}</b>{r.author ? ` · ${r.author}` : ""} · {ago(r.at)}</p>
              {parseReport(r.text).map((p, j) => (
                <div key={j} className="flex flex-col gap-1.5">
                  {p.quote && <Bubble label="הסוכן כתב" text={p.quote} tone="agent" />}
                  <p className="m-0 text-[15px] leading-relaxed whitespace-pre-wrap">{p.why}</p>
                </div>
              ))}
              {r.conversationId && <button type="button" onClick={() => openChat(r.conversationId!)} className="self-start min-h-[36px] text-sm font-bold" style={{ color: C.petrol }}>לפתוח את כל השיחה</button>}
            </div>
          ))}
        </section>
      )}
      {i.reports.length === 0 && i.conversations[0] && <button type="button" onClick={() => openChat(i.conversations[0])} className="self-start min-h-[36px] text-sm font-bold" style={{ color: C.petrol }}>לפתוח את השיחה</button>}

      {st === "pending" && (
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 text-[13px] font-bold" style={{ color: C.muted }}>מה שולחים לתיקון</h3>
          <textarea value={proposal} onChange={e => setProposal(e.target.value)} rows={Math.min(7, Math.max(3, Math.ceil(proposal.length / 55)))} aria-label="מה שולחים לתיקון" className="rounded-xl px-3 py-2.5 text-[15px] leading-relaxed bg-white" style={{ border: "1px solid #C7D8D5" }} />
          <p className="m-0 text-xs" style={{ color: C.muted }}>זה מה שסוכן התיקונים יקרא. אפשר לערוך במילים שלך.</p>
        </section>
      )}
      {(st === "question" || (st === "review" && revising)) && (
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 text-[13px] font-bold" style={{ color: C.muted }}>{st === "question" ? "התשובה שלך" : "מה לשנות בתיקון"}</h3>
          <textarea value={answer} onChange={e => setAnswer(e.target.value)} rows={3} aria-label={st === "question" ? "התשובה שלך" : "מה לשנות בתיקון"} className="rounded-xl px-3 py-2.5 text-[15px] bg-white" style={{ border: "1px solid #C7D8D5" }} />
        </section>
      )}

      {err && <p className="m-0 text-sm" style={{ color: "#B42318" }}>{err}</p>}
      {(main || more.length > 0) && (
        <footer className="sticky bottom-0 -mx-1 px-1 pt-2 pb-1 flex items-center gap-2.5" style={{ background: "linear-gradient(to top, #fff 80%, rgba(255,255,255,0))" }}>
          {main ?? <span className="flex-1" />}
          <More items={more} />
        </footer>
      )}

      {fx?.history && fx.history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer min-h-[36px] font-semibold" style={{ color: C.petrol }}>מה קרה עד עכשיו</summary>
          <ol className="m-0 mt-1 ps-5 flex flex-col gap-1" style={{ color: C.muted }}>{fx.history.map((h, k) => <li key={k}>{h.who}: {h.text} · {ago(h.at)}</li>)}</ol>
        </details>
      )}
    </article>
  );
}

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
