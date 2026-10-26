"use client";

import { useEffect, useState } from "react";
import { C, crmAction, ago, MoreMenu } from "../ui";

/**
 * One agent problem and what to do with it (25.10.2026): what the shops
 * reported, the fix waiting for approval, and the one main action of its
 * stage. Shared by the reports screen (/admin/crm/reports) and the customer
 * card's reports (26.10.2026, Yair: "דרך הכרטיס לקוח אנחנו נוכל לעדכן").
 */
export type Fix = {
  summary: string; appliesTo: string; before?: string; after?: string; tested?: string;
  promptBefore?: number; promptAfter?: number; growthReason?: string; question?: string;
  understood?: string; verdict?: "fix" | "not_a_problem" | "need_info"; read?: string[]; plan?: { type?: string };
  history?: { at: string; who: string; text: string }[];
};
export type Report = { at: string; source: string; businessName: string; author?: string | null; text: string; evidence?: string | null; conversationId?: string | null };
export type Item = {
  id: string; businessId: string; businessName: string; source: string; kind: "rule" | "faq" | "setup" | "base"; title: string; proposal: string;
  evidence: string | null; conversations: string[]; status: string; createdAt: string; decidedAt: string | null; decidedBy: string | null;
  fix: Fix | null; growthNeedsOk: boolean; reports: Report[];
  /** What exactly changes (fix-report.ts). */
  change?: { what: string; before?: string | null; after?: string | null; files?: string[]; url?: string | null } | null;
};
export type Data = { items: Item[] };
export type Stage = "new" | "agent" | "approve" | "done" | "closed";

export const STAGES: { key: Exclude<Stage, "closed">; label: string; sub: string; st: string[] }[] = [
  { key: "new", label: "חדש", sub: "לבדוק ולשלוח לתיקון", st: ["pending"] },
  { key: "agent", label: "אצל סוכן התיקונים", sub: "מכין תיקון בבוקר", st: ["queued", "publish", "revert"] },
  { key: "approve", label: "מחכה לאישור", sub: "לפני ואחרי, ואישור", st: ["review", "question"] },
  { key: "done", label: "תוקן", sub: "העסק קיבל הודעה", st: ["applied", "approved"] },
];
export const stageOf = (status: string): Stage => STAGES.find(s => s.st.includes(status))?.key ?? "closed";
const PROMPT_MAX = 15_000;
const n = (x: number) => x.toLocaleString("he-IL");
export const scope = (i: Item) => (i.kind === "base" ? "כל העסקים" : `רק ${i.businessName}`);
export const reportsLabel = (i: Item) => (i.source === "yair" ? "רעיון של יאיר" : i.reports.length > 1 ? `${i.reports.length} דיווחים` : i.reports.length === 1 ? "דיווח אחד" : "מהבדיקה");

/** "על התשובה «...»: why" lines (a report from a chat) → quote + why; anything else stays text. */
export function parseReport(text: string): { quote: string | null; why: string }[] {
  return text.split("\n").filter(Boolean).map(line => {
    const m = line.match(/^על התשובה «(.+?)»: (.*)$/);
    return m ? { quote: m[1], why: m[2] } : { quote: null, why: line.replace(/^ובכללי: /, "") };
  });
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

export function Detail({ i, onDone, openChat }: { i: Item; onDone: (msg: string) => Promise<void>; openChat: (id: string) => void }) {
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
  } else if (st === "review" && !revising && (fx?.verdict === "not_a_problem" || fx?.plan?.type === "none")) {
    // The fix agent says there is nothing to fix: close it, or ask for a fix anyway.
    main = <button type="button" disabled={busy} onClick={() => void act({ action: "improvement.reject" }, "נסגר")} className="flex-1 min-h-[52px] rounded-2xl text-white text-[16px] font-extrabold disabled:opacity-50" style={{ background: C.petrol }}>{busy ? "סוגר…" : "לסגור, אין מה לתקן"}</button>;
    more = [{ label: "בקש תיקון בכל זאת", onClick: () => setRevising(true) }];
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
      {/* The fix report (26.10.2026, Yair: "לפתוח את הדוח תיקון, לראות מה הסוכן הבין, האם יש
          מה לתקן"): what it understood, the verdict, what exactly changes, what it read. */}
      {(st === "review" || st === "applied" || st === "publish") && fx && (
        <details open={st !== "applied"} className="rounded-2xl" style={{ border: `1px solid ${C.line}` }}>
          <summary className="cursor-pointer min-h-[48px] px-4 flex items-center justify-between gap-2 text-[15px] font-bold">דוח התיקון<span className="text-xs font-semibold" style={{ color: C.muted }}>{fx.verdict === "not_a_problem" ? "אין מה לתקן" : fx.appliesTo || ""}</span></summary>
          <div className="px-4 pb-4 flex flex-col gap-4">
            {fx.understood && (
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-bold" style={{ color: C.muted }}>מה הסוכן הבין</span>
                <p className="m-0 text-[15px] leading-relaxed">{fx.understood}</p>
              </div>
            )}
            {fx.verdict && (
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold" style={{ color: C.muted }}>יש מה לתקן?</span>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={fx.verdict === "fix" ? { background: "#FDECEA", color: "#B42318" } : fx.verdict === "not_a_problem" ? { background: "#E3F7EF", color: "#0F6B4F" } : { background: "#FFF1D6", color: "#7A4A00" }}>{fx.verdict === "fix" ? "כן" : fx.verdict === "not_a_problem" ? "לא, זו לא תקלה" : "צריך מידע"}</span>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-bold" style={{ color: C.muted }}>מה עושים</span>
              <p className="m-0 text-[15px] leading-relaxed">{fx.summary}</p>
            </div>
            {i.change && (i.change.after || i.change.files) && (
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-bold" style={{ color: C.muted }}>מה משתנה בדיוק: {i.change.what}</span>
                {i.change.after != null && (
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="rounded-xl p-3 flex flex-col gap-1" style={{ background: "#FDF2F1" }}>
                      <span className="text-[11px] font-bold" style={{ color: "#B42318" }}>{st === "applied" ? "היה" : "עכשיו"}</span>
                      <p className="m-0 text-sm leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto [overflow-wrap:anywhere]">{i.change.before || "ריק"}</p>
                    </div>
                    <div className="rounded-xl p-3 flex flex-col gap-1" style={{ background: "#EDF9F3" }}>
                      <span className="text-[11px] font-bold" style={{ color: "#0F6B4F" }}>{st === "applied" ? "עכשיו" : "אחרי התיקון"}</span>
                      <p className="m-0 text-sm leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto [overflow-wrap:anywhere]">{i.change.after}</p>
                    </div>
                  </div>
                )}
                {i.change.files && i.change.files.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <p className="m-0 text-xs" style={{ color: C.muted }}>קבצים: <span dir="ltr">{i.change.files.join(", ")}</span></p>
                    {i.change.url && <a href={i.change.url} target="_blank" rel="noreferrer" className="self-start min-h-[36px] inline-flex items-center text-sm font-bold" style={{ color: C.petrol }}>לראות את השינוי בקוד</a>}
                  </div>
                )}
              </div>
            )}
            {fx.read && fx.read.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-bold" style={{ color: C.muted }}>עבר על השיחות:</span>
                {fx.read.map((cid, k) => <button key={cid} type="button" onClick={() => openChat(cid)} className="min-h-[36px] px-3 rounded-full text-sm font-semibold" style={{ background: C.mist, color: C.petrol }}>שיחה {k + 1}</button>)}
              </div>
            )}
          {fx.appliesTo && <p className="m-0 text-xs" style={{ color: C.muted }}>חל על: {fx.appliesTo}</p>}
          {fx.before && <Bubble label="התשובה לפני" text={fx.before} tone="bad" />}
          {fx.after && <Bubble label="התשובה אחרי, בבדיקה" text={fx.after} tone="good" />}
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
          </div>
        </details>
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
          <MoreMenu items={more} up />
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
