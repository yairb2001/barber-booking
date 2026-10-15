"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { C, Btn, Card, PageHead, Tag, useCrm, crmAction, ago, type Tone } from "../ui";
import ConversationSheet from "./ConversationSheet";

/**
 * Agent improvements. The daily review's proposals, the owners' notes and
 * Yair's own ideas go to the fix agent on his Mac (15.10.2026, Yair: "כל הצעה
 * מלבד להחליף מילה או 2 צריכה לעבור אצל סוכן ai פה במחשב שמבין שאסור לנפח
 * פרומטים"), which prepares each fix every morning; nothing goes live before
 * Yair approves it here. Flow: src/lib/agent/fix-queue.ts, docs/fix-agent.md.
 */
type Fix = {
  summary: string; appliesTo: string; before?: string; after?: string; tested?: string;
  promptBefore?: number; promptAfter?: number; growthReason?: string; question?: string;
  plan: { type: string; files?: string[] };
  history?: { at: string; who: string; text: string }[];
};
type Item = {
  id: string; businessId: string; businessName: string; source: string; kind: "rule" | "faq" | "setup" | "base"; title: string; proposal: string;
  evidence: string | null; targetKey: string | null; conversationId: string | null; conversations: string[]; status: string; createdAt: string; decidedAt: string | null; decidedBy: string | null;
  fix: Fix | null; growth: number; growthNeedsOk: boolean;
  reports: { at: string; source: string; businessName: string; author?: string | null; text: string; conversationId?: string | null }[];
};
type Fb = { id: string; businessId: string; businessName: string; author: string | null; conversationId: string | null; text: string; status: string; createdAt: string; reviewNote: string | null };
const KIND: Record<Item["kind"], [string, Tone]> = { rule: ["כלל של העסק", "info"], faq: ["שאלה ותשובה", "ok"], setup: ["הגדרת הסוכן", "warn"], base: ["בסיס, לכל הסוכנים", "bad"] };
const FB_STATUS: Record<string, string> = { new: "חדש", in_review: "בבדיקה", applied: "טופל", dismissed: "נסגר" };
const SOURCE: Record<string, string> = { feedback: "מהערה של בעל העסק", yair: "רעיון שלך", daily_review: "מהבדיקה היומית", chator_question: "מהסוכן של צ׳אטור" };

// Questions Chator's own agent couldn't answer a customer (14.10.2026).
type CQ = { id: string; question: string; stage: string; createdAt: string; businessId: string | null; businessName: string | null; phone: string; conversationId: string };
const STAGE_NAME: Record<string, string> = { setup: "בהקמה", active: "לקוח פעיל", link: "קיבל קישור", lead: "ליד" };

type Tab = "new" | "agent" | "review" | "live";
const AT_AGENT = ["queued", "question", "publish", "revert"];
const num = (n: number) => n.toLocaleString("he-IL");

export default function ImprovementsPage() {
  const { data, error, reload } = useCrm<{ items: Item[]; feedback: Fb[]; chatorQuestions: CQ[]; supportRules: string[]; growthLimit: number }>("view=improvements");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [conv, setConv] = useState<{ id: string; evidence: string | null } | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [growthOk, setGrowthOk] = useState<Record<string, boolean>>({});
  const [idea, setIdea] = useState<string | null>(null);

  async function act(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    const r = await crmAction(body);
    setBusy(null);
    setFlash(r.ok ? done : r.error ?? "שגיאה");
    if (r.ok) await reload();
    return r.ok;
  }

  const items = data?.items ?? [];
  // The most reported first (15.10.2026: only manual reports reach Yair, merged).
  const pending = items.filter(i => i.status === "pending").sort((a, b) => b.reports.length - a.reports.length);
  const atAgent = items.filter(i => AT_AGENT.includes(i.status));
  const review = items.filter(i => i.status === "review");
  const live = items.filter(i => i.status === "applied" || i.status === "approved");
  const closed = items.filter(i => i.status === "rejected");
  const openFb = (data?.feedback ?? []).filter(f => f.status === "new" || f.status === "in_review");
  // Opens where something waits for him: fixes to approve first.
  useEffect(() => { if (data && tab === null) setTab(review.length ? "review" : "new"); }, [data, tab, review.length]);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data || !tab) return <p style={{ color: C.muted }}>טוען…</p>;
  const byBiz = Array.from(new Set(pending.map(i => i.businessId)));
  const TABS: [Tab, string, number][] = [
    ["new", "חדשות", pending.length + data.chatorQuestions.length + openFb.length],
    ["agent", "אצל הסוכן", atAgent.length],
    ["review", "לאישור שלך", review.length],
    ["live", "באוויר", live.length],
  ];
  const convButtons = (i: Item) => i.conversations.map((cid, k) => (
    <button key={cid} type="button" onClick={() => setConv({ id: cid, evidence: i.evidence })} className="text-xs font-semibold underline min-h-[32px]" style={{ color: C.petrol }}>{i.conversations.length > 1 ? `לשיחה ${k + 1}` : "לשיחה"}</button>
  ));

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <PageHead title="שיפורי סוכן" sub={review.length ? `${review.length} תיקונים מחכים לאישור שלך` : pending.length ? `${pending.length} הצעות חדשות` : "אין משהו שמחכה לך"}
        actions={<div className="flex flex-wrap gap-2">
          <Btn kind="dark" onClick={() => setIdea(v => (v === null ? "" : null))}>שיפור חדש</Btn>
          <Btn kind="outline" disabled={!!busy} onClick={() => act("run", { action: "review.runNow" }, "המיון רץ. דיווחים חדשים מופיעים בחדשות.")}>{busy === "run" ? "ממיין…" : "מיין דיווחים עכשיו"}</Btn>
        </div>} />
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}
      <p className="m-0 text-xs" style={{ color: C.muted }}>מגיעות לכאן רק תקלות שדווחו ידנית: הערות של בעלי עסקים על הסוכן ורעיונות שלך. דיווח שדומה לבעיה קיימת מתאחד איתה. כל בוקר ב-06:30 סוכן התיקונים עובר על מה ששלחת לו, מתקן בלי לנפח את הפרומפט ובודק על השיחה האמיתית. התיקון חוזר לכאן, ושום דבר לא עולה לאוויר בלי האישור שלך. הגדלה של הפרומפט צריכה אישור נפרד עם הסבר.</p>

      {idea !== null && (
        <Card title="שיפור חדש">
          <textarea value={idea} onChange={e => setIdea(e.target.value)} rows={3} placeholder="מה לשפר בסוכן? במילים שלך" className="w-full rounded-lg px-3 py-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
          <div className="flex gap-2 mt-2">
            <Btn kind="dark" disabled={!!busy || !idea.trim()} onClick={async () => { if (await act("idea", { action: "improvement.new", text: idea }, "נשלח לסוכן התיקונים. הוא יעבוד על זה מחר בבוקר.")) setIdea(null); }}>לסוכן התיקונים</Btn>
            <Btn kind="ghost" onClick={() => setIdea(null)}>ביטול</Btn>
          </div>
        </Card>
      )}

      <div role="tablist" aria-label="שלב" className="flex flex-wrap gap-2">
        {TABS.map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="h-[38px] px-3.5 rounded-full text-sm font-semibold" style={tab === k ? { background: C.petrol, color: "#fff", border: `1px solid ${C.petrol}` } : { background: "#fff", color: C.ink, border: "1px solid #C7D8D5" }}>{l}{n ? ` (${n})` : ""}</button>
        ))}
      </div>

      {/* ── חדשות: decide, a minute each ── */}
      {tab === "new" && (<>
        {pending.length === 0 && data.chatorQuestions.length === 0 && openFb.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>אין הצעות חדשות.</p>}
        {data.chatorQuestions.length > 0 && (
          <Card title="שאלות מהסוכן של צ׳אטור" aside={`${data.chatorQuestions.length} מחכות`}>
            <div className="flex flex-col gap-3">
              <p className="m-0 text-xs" style={{ color: C.muted }}>לקוח שאל משהו שהסוכן לא ידע. התשובה שלך נשלחת אליו מהמספר של צ׳אטור. אם תשאיר את הסימון, סוכן התיקונים ישלב אותה בידע של הסוכן בלי לנפח, ותאשר את זה בלשונית &quot;לאישור שלך&quot;.</p>
              {data.chatorQuestions.map(q => (
                <div key={q.id} className="rounded-xl p-3 flex flex-col gap-2" style={{ border: `1px solid ${C.line}` }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Tag tone="warn">{STAGE_NAME[q.stage] ?? q.stage}</Tag>
                    <b className="text-sm">{q.businessName ?? q.phone}</b>
                    <span className="text-xs" style={{ color: C.muted }}>{ago(q.createdAt)}</span>
                    <Link href={`/admin/crm/chats/${q.conversationId}`} className="text-xs ms-auto" style={{ color: C.petrol }}>לצ׳אט</Link>
                  </div>
                  <p className="m-0 text-sm font-semibold">״{q.question}״</p>
                  <textarea value={answers[q.id] ?? ""} onChange={e => setAnswers(s => ({ ...s, [q.id]: e.target.value }))} rows={2} placeholder="מה לענות לו?" className="rounded-lg px-3 py-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
                  <label className="flex items-center gap-2 text-xs" style={{ color: C.muted }}>
                    <input type="checkbox" checked={keep[q.id] ?? true} onChange={e => setKeep(s => ({ ...s, [q.id]: e.target.checked }))} style={{ accentColor: C.petrol }} />
                    שהסוכן ידע לענות על זה בפעם הבאה (דרך סוכן התיקונים)
                  </label>
                  <div className="flex gap-2">
                    <Btn kind="dark" disabled={!!busy || !(answers[q.id] ?? "").trim()} onClick={() => act(q.id, { action: "chatorQuestion.answer", id: q.id, answer: answers[q.id], save: keep[q.id] ?? true }, "נשלח ללקוח")}>{busy === q.id ? "שולח…" : "שלח ללקוח"}</Btn>
                    <Btn kind="ghost" disabled={!!busy} onClick={() => act(q.id, { action: "chatorQuestion.dismiss", id: q.id }, "סומן כלא רלוונטי")}>לא רלוונטי</Btn>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {byBiz.map(bid => (
          <Card key={bid} title={pending.find(i => i.businessId === bid)!.businessName} aside={<Link href={`/admin/crm/customers/${bid}`} style={{ color: C.petrol }}>לכרטיס</Link>}>
            <div className="flex flex-col gap-3">
              {pending.filter(i => i.businessId === bid).map(i => {
                const [label, tone] = KIND[i.kind];
                const val = edit[i.id] ?? i.proposal;
                const direct = i.kind === "setup" || i.kind === "faq";
                return (
                  <div key={i.id} className="rounded-xl p-3 flex flex-col gap-2" style={{ border: `1px solid ${C.line}` }}>
                    <div className="flex items-center gap-2 flex-wrap"><Tag tone={tone}>{label}</Tag><b className="text-sm">{i.title}</b><span className="text-xs" style={{ color: C.muted }}>{ago(i.createdAt)} · {SOURCE[i.source] ?? i.source}</span></div>
                    {i.reports.length > 0 && (
                      <details>
                        <summary className="text-xs font-semibold cursor-pointer" style={{ color: C.petrol }}>{i.reports.length > 1 ? `דווח ${i.reports.length} פעמים` : "הדיווח"} · {Array.from(new Set(i.reports.map(r => r.businessName).filter(Boolean))).join(", ")}</summary>
                        <div className="mt-1 flex flex-col gap-1.5">
                          {i.reports.map((r, k) => (
                            <div key={k} className="text-xs rounded-lg px-2.5 py-2" style={{ background: C.soft }}>
                              <span style={{ color: C.muted }}>{r.businessName}{r.author ? ` · ${r.author}` : ""} · {ago(r.at)}{r.source === "daily_review" ? " · מהבדיקה האוטומטית" : ""}</span>
                              <p className="m-0 mt-0.5 whitespace-pre-line">{r.text}</p>
                              {r.conversationId && <button type="button" onClick={() => setConv({ id: r.conversationId!, evidence: null })} className="text-xs font-semibold underline" style={{ color: C.petrol }}>לשיחה</button>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    <label className="text-xs font-semibold" style={{ color: C.muted }} htmlFor={`p-${i.id}`}>מה אתה רוצה, במילים שלך</label>
                    <textarea id={`p-${i.id}`} value={val} onChange={e => setEdit(s => ({ ...s, [i.id]: e.target.value }))} rows={Math.min(6, Math.max(2, Math.ceil(val.length / 60)))} className="rounded-lg px-3 py-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
                    {i.targetKey && <span className="text-xs" style={{ color: C.muted }}>שאלה: {i.targetKey}</span>}
                    {(i.evidence || i.conversations.length > 0) && (
                      <div className="flex flex-wrap items-start gap-3">
                        {i.evidence && <details className="flex-1 min-w-0"><summary className="text-xs cursor-pointer" style={{ color: C.petrol }}>למה</summary><p className="m-0 mt-1 text-xs whitespace-pre-line" style={{ color: C.muted }}>{i.evidence}</p></details>}
                        {convButtons(i)}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Btn kind="dark" disabled={!!busy} onClick={() => act(i.id, { action: "improvement.queue", id: i.id, proposal: val }, "נשלח לסוכן התיקונים. התיקון יחכה לך מחר בבוקר.")}>לסוכן התיקונים</Btn>
                      {direct && <Btn kind="outline" disabled={!!busy} onClick={() => act(i.id, { action: "improvement.decide", id: i.id, approve: true, proposal: val }, "הוחל על הסוכן")}>החל עכשיו</Btn>}
                      <Btn kind="ghost" disabled={!!busy} onClick={() => act(i.id, { action: "improvement.decide", id: i.id, approve: false }, "נדחה")}>דחה</Btn>
                    </div>
                    {direct && <span className="text-[11px]" style={{ color: C.muted }}>&quot;החל עכשיו&quot; רק לשינוי של מילה או שתיים. כל השאר: לסוכן התיקונים.</span>}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}

        {data.supportRules.length > 0 && (
          <details className="rounded-2xl bg-white px-4 py-3" style={{ border: `1px solid ${C.line}` }}>
            <summary className="text-sm font-semibold cursor-pointer">מה הסוכן של צ׳אטור כבר למד ממך ({data.supportRules.length})</summary>
            <ul className="m-0 mt-2 ps-5 text-xs flex flex-col gap-1" style={{ color: C.muted }}>{data.supportRules.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </details>
        )}

        <Card collapsible defaultOpen={data.feedback.some(f => f.status === "new")} title="כל הדיווחים של בעלי עסקים" aside={`${openFb.length} פתוחים`}>
          {data.feedback.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>אין עדיין הערות.</p>}
          {data.feedback.map(f => (
            <div key={f.id} className="py-2.5 flex flex-col gap-1" style={{ borderTop: `1px solid ${C.soft}` }}>
              <div className="flex justify-between gap-2 text-xs" style={{ color: C.muted }}><span>{f.businessName}{f.author ? ` · ${f.author}` : ""} · {ago(f.createdAt)}</span><span>{FB_STATUS[f.status] ?? f.status}</span></div>
              <p className="m-0 text-sm whitespace-pre-line">{f.text}</p>
              {f.reviewNote && <span className="text-xs" style={{ color: C.petrol }}>{f.reviewNote}</span>}
              {f.conversationId && <button type="button" onClick={() => setConv({ id: f.conversationId!, evidence: null })} className="self-start text-xs font-semibold underline min-h-[32px]" style={{ color: C.petrol }}>לשיחה שעליה ההערה</button>}
              {(f.status === "new" || f.status === "in_review") && (
                <div className="flex gap-2">
                  <Btn kind="ghost" className="!px-0" disabled={!!busy} onClick={() => act(f.id, { action: "feedback.status", id: f.id, status: "applied" }, "סומן כטופל")}>סמן כטופל</Btn>
                  <Btn kind="ghost" disabled={!!busy} onClick={() => act(f.id, { action: "feedback.status", id: f.id, status: "dismissed" }, "נסגר")}>סגור</Btn>
                </div>
              )}
            </div>
          ))}
        </Card>
      </>)}

      {/* ── אצל הסוכן: waiting for the morning run, or for an answer from him ── */}
      {tab === "agent" && (<>
        {atAgent.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>אין כרגע משהו אצל סוכן התיקונים.</p>}
        {atAgent.map(i => (
          <div key={i.id} className="bg-white rounded-2xl p-4 flex flex-col gap-2" style={{ border: i.status === "question" ? `2px solid ${C.coral}` : `1px solid ${C.line}` }}>
            <div className="flex items-center gap-2 flex-wrap">
              <Tag tone={i.status === "question" ? "bad" : "info"}>{i.status === "question" ? "הסוכן שואל אותך" : i.status === "publish" ? "אושר, יעלה בבוקר" : i.status === "revert" ? "יוחזר אחורה בבוקר" : "ירוץ מחר ב-06:30"}</Tag>
              <b className="text-sm">{i.title}</b><span className="text-xs" style={{ color: C.muted }}>{i.businessName}</span>
            </div>
            <p className="m-0 text-sm whitespace-pre-line" style={{ color: C.muted }}>{i.proposal}</p>
            {i.status === "question" && i.fix?.question && (<>
              <p className="m-0 text-sm font-semibold">״{i.fix.question}״</p>
              <textarea value={edit[`q-${i.id}`] ?? ""} onChange={e => setEdit(s => ({ ...s, [`q-${i.id}`]: e.target.value }))} rows={2} placeholder="התשובה שלך" className="rounded-lg px-3 py-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
            </>)}
            <div className="flex flex-wrap items-center gap-2">
              {i.status === "question" && <Btn kind="dark" disabled={!!busy || !(edit[`q-${i.id}`] ?? "").trim()} onClick={() => act(i.id, { action: "improvement.revise", id: i.id, text: edit[`q-${i.id}`] }, "נשלח לסוכן. הוא ימשיך מחר בבוקר.")}>שלח תשובה</Btn>}
              {i.status === "queued" && <Btn kind="ghost" disabled={!!busy} onClick={() => act(i.id, { action: "improvement.unqueue", id: i.id }, "הוחזר לחדשות")}>בטל</Btn>}
              {(i.status === "queued" || i.status === "question") && <Btn kind="ghost" disabled={!!busy} onClick={() => act(i.id, { action: "improvement.reject", id: i.id }, "נסגר")}>סגור</Btn>}
              {convButtons(i)}
            </div>
          </div>
        ))}
      </>)}

      {/* ── לאישור שלך: the prepared fixes ── */}
      {tab === "review" && (<>
        {review.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>אין תיקונים שמחכים לאישור.</p>}
        {review.map(i => {
          const fx = i.fix;
          const code = fx?.plan.type === "code";
          const note = edit[`r-${i.id}`] ?? "";
          return (
            <div key={i.id} className="bg-white rounded-2xl p-4 flex flex-col gap-3" style={{ border: `1px solid ${C.line}` }}>
              <div className="flex items-center gap-2 flex-wrap">
                <b className="text-[15px]">{i.title}</b>
                {fx?.appliesTo && <Tag tone={/כל/.test(fx.appliesTo) ? "bad" : "info"}>{fx.appliesTo}</Tag>}
                {code && <Tag tone="warn">תיקון בקוד</Tag>}
              </div>
              {fx?.summary && <p className="m-0 text-sm font-semibold">{fx.summary}</p>}
              {(fx?.before || fx?.after) && (
                <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                  {fx.before && <div className="rounded-xl p-3" style={{ background: "#FDF2EF" }}><span className="text-[11px] font-bold" style={{ color: "#993C1D" }}>לפני</span><p className="m-0 mt-1 text-sm whitespace-pre-wrap">{fx.before}</p></div>}
                  {fx.after && <div className="rounded-xl p-3" style={{ background: "#E3F7EF" }}><span className="text-[11px] font-bold" style={{ color: "#0F6B4F" }}>אחרי</span><p className="m-0 mt-1 text-sm whitespace-pre-wrap">{fx.after}</p></div>}
                </div>
              )}
              {fx?.tested && <p className="m-0 text-xs" style={{ color: C.muted }}>נבדק: {fx.tested}</p>}
              {fx?.promptBefore != null && fx?.promptAfter != null && (
                <p className="m-0 text-xs" style={{ color: i.growth > 0 ? "#854F0B" : C.muted }}>גודל הפרומפט: {num(fx.promptBefore)} ← {num(fx.promptAfter)} תווים ({i.growth > 0 ? "+" : ""}{num(i.growth)})</p>
              )}
              {i.growthNeedsOk && (
                <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: "#FAEEDA" }}>
                  <p className="m-0 text-sm" style={{ color: "#633806" }}><b>הפרומפט גדל ב-{num(i.growth)} תווים.</b> למה: {fx?.growthReason || "הסוכן לא כתב סיבה"}</p>
                  <label className="flex items-center gap-2 text-sm" style={{ color: "#633806" }}>
                    <input type="checkbox" checked={!!growthOk[i.id]} onChange={e => setGrowthOk(s => ({ ...s, [i.id]: e.target.checked }))} style={{ accentColor: "#854F0B" }} />
                    אני מאשר להגדיל
                  </label>
                </div>
              )}
              {code && <p className="m-0 text-xs" style={{ color: C.muted }}>תיקון בקוד: אחרי האישור עולה לאוויר בבוקר הבא</p>}
              {fx?.history && fx.history.length > 0 && (
                <details><summary className="text-xs cursor-pointer" style={{ color: C.petrol }}>היסטוריה ({fx.history.length})</summary>
                  {fx.history.map((h, k) => <p key={k} className="m-0 mt-1 text-xs" style={{ color: C.muted }}><b>{h.who}</b> · {ago(h.at)}: {h.text}</p>)}
                </details>
              )}
              <div className="flex flex-wrap gap-3">{convButtons(i)}</div>
              <textarea value={note} onChange={e => setEdit(s => ({ ...s, [`r-${i.id}`]: e.target.value }))} rows={2} placeholder="מה לתקן? (חוזר לסוכן לבוקר הבא)" className="rounded-lg px-3 py-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
              <div className="flex flex-wrap gap-2">
                <Btn kind="dark" disabled={!!busy || (i.growthNeedsOk && !growthOk[i.id])} onClick={() => act(i.id, { action: "improvement.publish", id: i.id, growthOk: !!growthOk[i.id] }, code ? "אושר. יעלה לאוויר בבוקר." : "באוויר")}>אשר והעלה</Btn>
                <Btn kind="outline" disabled={!!busy || !note.trim()} onClick={() => act(i.id, { action: "improvement.revise", id: i.id, text: note }, "חזר לסוכן עם ההערות שלך")}>תקן</Btn>
                <Btn kind="ghost" disabled={!!busy} onClick={() => act(i.id, { action: "improvement.reject", id: i.id }, "נדחה")}>דחה</Btn>
              </div>
            </div>
          );
        })}
      </>)}

      {/* ── באוויר: last 30 days, undo for 7 ── */}
      {tab === "live" && (<>
        {live.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>עוד לא עלו תיקונים בחודש האחרון.</p>}
        {live.map(i => {
          const undo = i.status === "applied" && !!i.fix && !!i.decidedAt && Date.now() - new Date(i.decidedAt).getTime() < 7 * 86400_000;
          return (
            <div key={i.id} className="bg-white rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2" style={{ border: `1px solid ${C.line}` }}>
              <div className="min-w-0">
                <b className="text-sm">{i.title}</b>
                <p className="m-0 text-xs" style={{ color: C.muted }}>{i.businessName}{i.fix?.summary ? ` · ${i.fix.summary}` : ""}{i.decidedAt ? ` · ${ago(i.decidedAt)}` : ""}{i.status === "approved" ? " · אושר לבסיס (לפני סוכן התיקונים)" : ""}</p>
              </div>
              {undo && <Btn kind="ghost" disabled={!!busy} onClick={() => confirm("להחזיר אחורה את התיקון?") && act(i.id, { action: "improvement.revert", id: i.id }, i.fix?.plan.type === "code" ? "יוחזר אחורה בבוקר" : "הוחזר אחורה")}>החזר אחורה</Btn>}
            </div>
          );
        })}
        {closed.length > 0 && (
          <Card collapsible title="נסגרו" aside={`${closed.length}`}>
            {closed.map(i => (
              <div key={i.id} className="py-2 text-sm flex items-center justify-between gap-2" style={{ borderTop: `1px solid ${C.soft}` }}>
                <span>{i.businessName} · {i.title}{i.decidedBy === "מיון" ? <span className="text-xs" style={{ color: C.muted }}> · נסגר במיון, לא קריטי</span> : null}</span>
                <Btn kind="ghost" disabled={!!busy} onClick={() => act(i.id, { action: "improvement.reopen", id: i.id }, "נפתח מחדש, בחדשות")}>פתח מחדש</Btn>
              </div>
            ))}
          </Card>
        )}
      </>)}

      {conv && <ConversationSheet id={conv.id} evidence={conv.evidence} onClose={() => setConv(null)} />}
    </div>
  );
}
