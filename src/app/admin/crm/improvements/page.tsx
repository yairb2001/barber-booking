"use client";

import { useState } from "react";
import Link from "next/link";
import { C, Btn, Card, PageHead, Tag, useCrm, crmAction, ago, type Tone } from "../ui";
import ConversationSheet from "./ConversationSheet";

/**
 * Agent improvements (10.10.2026): the daily review's proposals, per business,
 * and the owners' notes about their agents. Nothing reaches an agent before
 * Yair approves it here.
 */
type Item = { id: string; businessId: string; businessName: string; source: string; kind: "rule" | "faq" | "setup" | "base"; title: string; proposal: string; evidence: string | null; targetKey: string | null; conversationId: string | null; conversations: string[]; status: string; createdAt: string; decidedAt: string | null };
type Fb = { id: string; businessId: string; businessName: string; author: string | null; conversationId: string | null; text: string; status: string; createdAt: string };
const KIND: Record<Item["kind"], [string, Tone]> = { rule: ["כלל של העסק", "info"], faq: ["שאלה ותשובה", "ok"], setup: ["הגדרת הסוכן", "warn"], base: ["בסיס, לכל הסוכנים", "bad"] };
const FB_STATUS: Record<string, string> = { new: "חדש", in_review: "בבדיקה", applied: "טופל", dismissed: "נסגר" };

// Questions Chator's own agent couldn't answer a customer (14.10.2026).
type CQ = { id: string; question: string; stage: string; createdAt: string; businessId: string | null; businessName: string | null; phone: string; conversationId: string };
const STAGE_NAME: Record<string, string> = { setup: "בהקמה", active: "לקוח פעיל", link: "קיבל קישור", lead: "ליד" };

export default function ImprovementsPage() {
  const { data, error, reload } = useCrm<{ items: Item[]; feedback: Fb[]; chatorQuestions: CQ[]; supportRules: string[] }>("view=improvements");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [conv, setConv] = useState<{ id: string; evidence: string | null } | null>(null);

  async function act(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    const r = await crmAction(body);
    setBusy(null);
    setFlash(r.ok ? done : r.error ?? "שגיאה");
    if (r.ok) await reload();
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;
  const pending = data.items.filter(i => i.status === "pending");
  const decided = data.items.filter(i => i.status !== "pending");
  const byBiz = Array.from(new Set(pending.map(i => i.businessId)));

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <PageHead title="שיפורי סוכן" sub={pending.length ? `${pending.length} הצעות מחכות לך` : "אין הצעות פתוחות"}
        actions={<Btn kind="outline" disabled={!!busy} onClick={() => act("run", { action: "review.runNow" }, "הבדיקה רצה. הצעות חדשות יופיעו כאן.")}>{busy === "run" ? "בודק…" : "הרץ בדיקה עכשיו"}</Btn>} />
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}
      <p className="m-0 text-xs" style={{ color: C.muted }}>כל בוקר הבדיקה עוברת על שיחות היממה של כל עסק, על ההערות של בעלי העסקים ועל שאלות שהסוכן לא ידע. אישור מחיל את השינוי על הסוכן של אותו עסק בלבד. הצעה מסוג &quot;בסיס&quot; היא לכל הסוכנים, ואני מבצע אותה בקוד.</p>

      {data.chatorQuestions.length > 0 && (
        <Card title="שאלות מהסוכן של צ׳אטור" aside={`${data.chatorQuestions.length} מחכות`}>
          <div className="flex flex-col gap-3">
            <p className="m-0 text-xs" style={{ color: C.muted }}>לקוח שאל משהו שהסוכן לא ידע. התשובה שלך נשלחת אליו מהמספר של צ׳אטור, ואם תשאיר את הסימון היא נשמרת ככלל, והסוכן יענה עליה לבד בפעם הבאה.</p>
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
                  לשמור ככלל, כדי שהסוכן יענה על זה לבד בפעם הבאה
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
      {data.supportRules.length > 0 && (
        <details className="rounded-2xl bg-white px-4 py-3" style={{ border: `1px solid ${C.line}` }}>
          <summary className="text-sm font-semibold cursor-pointer">מה הסוכן של צ׳אטור כבר למד ממך ({data.supportRules.length})</summary>
          <ul className="m-0 mt-2 ps-5 text-xs flex flex-col gap-1" style={{ color: C.muted }}>{data.supportRules.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </details>
      )}

      {byBiz.map(bid => (
        <Card key={bid} title={pending.find(i => i.businessId === bid)!.businessName} aside={<Link href={`/admin/crm/customers/${bid}`} style={{ color: C.petrol }}>לכרטיס</Link>}>
          <div className="flex flex-col gap-3">
            {pending.filter(i => i.businessId === bid).map(i => {
              const [label, tone] = KIND[i.kind];
              const val = edit[i.id] ?? i.proposal;
              return (
                <div key={i.id} className="rounded-xl p-3 flex flex-col gap-2" style={{ border: `1px solid ${C.line}` }}>
                  <div className="flex items-center gap-2 flex-wrap"><Tag tone={tone}>{label}</Tag><b className="text-sm">{i.title}</b><span className="text-xs" style={{ color: C.muted }}>{ago(i.createdAt)}{i.source === "feedback" ? " · מהערה של בעל העסק" : ""}</span></div>
                  <textarea value={val} onChange={e => setEdit(s => ({ ...s, [i.id]: e.target.value }))} rows={Math.min(5, Math.max(2, Math.ceil(val.length / 60)))} className="rounded-lg px-3 py-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
                  {i.targetKey && <span className="text-xs" style={{ color: C.muted }}>שאלה: {i.targetKey}</span>}
                  {(i.evidence || i.conversations.length > 0) && (
                    <div className="flex flex-wrap items-start gap-3">
                      {i.evidence && <details className="flex-1 min-w-0"><summary className="text-xs cursor-pointer" style={{ color: C.petrol }}>למה</summary><p className="m-0 mt-1 text-xs whitespace-pre-line" style={{ color: C.muted }}>{i.evidence}</p></details>}
                      {i.conversations.map((cid, k) => <button key={cid} type="button" onClick={() => setConv({ id: cid, evidence: i.evidence })} className="text-xs font-semibold underline min-h-[32px]" style={{ color: C.petrol }}>{i.conversations.length > 1 ? `לשיחה ${k + 1}` : "לשיחה"}</button>)}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Btn kind="dark" disabled={!!busy} onClick={() => act(i.id, { action: "improvement.decide", id: i.id, approve: true, proposal: val }, i.kind === "base" ? "אושר. אבצע בבסיס." : "הוחל על הסוכן")}>{i.kind === "base" ? "אשר" : "אשר והחל"}</Btn>
                    <Btn kind="ghost" disabled={!!busy} onClick={() => act(i.id, { action: "improvement.decide", id: i.id, approve: false }, "נדחה")}>דחה</Btn>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}

      <Card collapsible defaultOpen={data.feedback.some(f => f.status === "new")} title="הערות של בעלי עסקים על הסוכן" aside={`${data.feedback.filter(f => f.status === "new" || f.status === "in_review").length} פתוחות`}>
        {data.feedback.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>אין עדיין הערות.</p>}
        {data.feedback.map(f => (
          <div key={f.id} className="py-2.5 flex flex-col gap-1" style={{ borderTop: `1px solid ${C.soft}` }}>
            <div className="flex justify-between gap-2 text-xs" style={{ color: C.muted }}><span>{f.businessName}{f.author ? ` · ${f.author}` : ""} · {ago(f.createdAt)}</span><span>{FB_STATUS[f.status] ?? f.status}</span></div>
            <p className="m-0 text-sm whitespace-pre-line">{f.text}</p>
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

      {decided.length > 0 && (
        <Card collapsible title="הוחלטו בשבועיים האחרונים" aside={`${decided.length}`}>
          {decided.map(i => (
            <div key={i.id} className="py-2 text-sm flex justify-between gap-2" style={{ borderTop: `1px solid ${C.soft}` }}>
              <span>{i.businessName} · {i.title}</span>
              <span className="text-xs shrink-0" style={{ color: C.muted }}>{i.status === "applied" ? "הוחל" : i.status === "approved" ? "אושר לבסיס" : "נדחה"}</span>
            </div>
          ))}
        </Card>
      )}
      {conv && <ConversationSheet id={conv.id} evidence={conv.evidence} onClose={() => setConv(null)} />}
    </div>
  );
}
