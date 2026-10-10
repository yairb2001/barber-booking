"use client";

import { useState } from "react";
import Link from "next/link";
import { C, Btn, Card, PageHead, Tag, useCrm, crmAction, ago, type Tone } from "../ui";

/**
 * Agent improvements (10.10.2026): the daily review's proposals, per business,
 * and the owners' notes about their agents. Nothing reaches an agent before
 * Yair approves it here.
 */
type Item = { id: string; businessId: string; businessName: string; source: string; kind: "rule" | "faq" | "setup" | "base"; title: string; proposal: string; evidence: string | null; targetKey: string | null; status: string; createdAt: string; decidedAt: string | null };
type Fb = { id: string; businessId: string; businessName: string; author: string | null; conversationId: string | null; text: string; status: string; createdAt: string };
const KIND: Record<Item["kind"], [string, Tone]> = { rule: ["כלל של העסק", "info"], faq: ["שאלה ותשובה", "ok"], setup: ["הגדרת הסוכן", "warn"], base: ["בסיס, לכל הסוכנים", "bad"] };
const FB_STATUS: Record<string, string> = { new: "חדש", in_review: "בבדיקה", applied: "טופל", dismissed: "נסגר" };

export default function ImprovementsPage() {
  const { data, error, reload } = useCrm<{ items: Item[]; feedback: Fb[] }>("view=improvements");
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);

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
                  {i.evidence && <details><summary className="text-xs cursor-pointer" style={{ color: C.petrol }}>למה</summary><p className="m-0 mt-1 text-xs whitespace-pre-line" style={{ color: C.muted }}>{i.evidence}</p></details>}
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
            {f.conversationId && <span className="text-xs" style={{ color: C.muted }}>על שיחה מסוימת (מצורפת לבדיקה)</span>}
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
    </div>
  );
}
