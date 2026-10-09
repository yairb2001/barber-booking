"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { C, NUM, TONE, Btn, Card, useCrm, crmAction, ils } from "../../ui";

type Field = { key: string; label: string; group: string; question: string; type: "choice" | "text" | "bool"; options: string[] | null; core: boolean; value: string | boolean | null; default: string | boolean | null };
type Data = {
  customer: { id: string; name: string; slug: string; ownerPhone: string | null; stage: string; health: "ok" | "warn" | "bad"; issues: { tone: "bad" | "warn"; text: string }[]; wa: string; apptsWeek: number; pkgPct: number; costIls: number; price: number; trialDaysLeft: number | null; rep: string | null };
  business: { id: string; name: string; slug: string; monthlyPrice: number | null; paidAt: string | null; trialEndsAt: string | null; suspendedAt: string | null; createdAt: string; tier: string; tokenBudgetIls: number };
  setup: { steps: { key: string; label: string; done: boolean; at: string | null }[]; doneCount: number; current: { label: string } | null; stuckHours: number; isLive: boolean; missingAgentFields: string[] };
  agent: { enabled: boolean; customPrompt: boolean; name: string | null; fields: Field[]; faqs: { id: string; question: string; answer: string }[]; history: { id: string; author: string; createdAt: string }[] };
  quality: { conversationsWeek: number; escalatedWeek: number; agentBookingsWeek: number };
  notes: { id: string; author: string; body: string; createdAt: string }[];
  lead: { id: string; name: string | null; phone: string; createdAt: string } | null;
};
const d = (iso: string | null) => (iso ? new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" }).format(new Date(iso)) : "");
const AUTHOR: Record<string, string> = { owner: "בעל העסק", wizard: "אשף ההקמה", owner_agent: "סוכן הבעלים", crm: "CRM" };

export default function CustomerCard() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useCrm<Data>(`view=customer&id=${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [budget, setBudget] = useState<string>("");

  async function act(key: string, body: Record<string, unknown>, done?: string) {
    setBusy(key); setFlash(null);
    const r = await crmAction(body);
    setBusy(null); setFlash(r.ok ? done ?? null : r.error ?? "שגיאה");
    if (r.ok) await reload();
    return r;
  }
  async function patchBiz(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key); setFlash(null);
    const r = await fetch(`/api/admin/super/businesses/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null); setFlash(r.ok ? done : "השמירה נכשלה");
    if (r.ok) await reload();
  }
  async function impersonate() {
    setBusy("imp");
    const r = await fetch("/api/admin/super/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: id }) });
    if (r.ok) window.location.href = "/admin"; else { setBusy(null); setFlash("לא הצלחתי להיכנס לעסק"); }
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;
  const c = data.customer, b = data.business, st = data.setup, ag = data.agent;
  const answered = ag.fields.filter(f => f.value !== null && f.value !== "").length;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/crm/customers" className="text-sm" style={{ color: C.petrol }}>→ חזרה ללקוחות</Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-extrabold">{c.name}</h1>
          <span className="text-sm" style={{ color: C.muted }}>{[c.ownerPhone, `/${c.slug}`, c.rep ? `נציג: ${c.rep}` : null, `נפתח ${d(b.createdAt)}`].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn kind="dark" disabled={busy === "imp"} onClick={impersonate}>{busy === "imp" ? "נכנס…" : "היכנס כמנהל"}</Btn>
          <Btn disabled={!!busy || !c.ownerPhone} onClick={() => act("link", { action: "customer.resendLink", id }, "קישור ההקמה נשלח לו בוואטסאפ")}>שלח קישור הקמה</Btn>
          {c.ownerPhone && <a href={`tel:${c.ownerPhone}`} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold inline-flex items-center" style={{ border: `1px solid ${C.petrol}`, color: C.petrol, textDecoration: "none" }}>חייג</a>}
        </div>
      </header>
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}
      {c.issues.length > 0 && <div className="flex flex-wrap gap-2">{c.issues.map((i, k) => <span key={k} className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: TONE[i.tone].bg, color: TONE[i.tone].color }}>{i.text}</span>)}</div>}

      <div className="flex flex-wrap gap-4 items-start">
        <div className="flex-[999_1_480px] min-w-0 flex flex-col gap-4">
          <Card title="שלבי ההקמה" aside={st.isLive ? "חי" : `${st.doneCount}/${st.steps.length}${st.stuckHours >= 24 ? ` · תקוע ${Math.floor(st.stuckHours / 24) || 1} ימים` : ""}`}>
            <ol className="m-0 p-0 list-none flex flex-col gap-2">
              {st.steps.map((s, i) => {
                const isCurrent = !s.done && st.steps.findIndex(x => !x.done) === i;
                return (
                  <li key={s.key} className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full text-xs font-bold inline-flex items-center justify-center shrink-0" style={s.done ? { background: TONE.ok.bg, color: TONE.ok.color } : isCurrent ? { background: TONE.warn.bg, color: TONE.warn.color } : { background: C.soft, color: C.muted }}>{s.done ? "✓" : i + 1}</span>
                    <span className="text-sm flex-1" style={{ fontWeight: isCurrent ? 700 : 400, color: s.done || isCurrent ? C.ink : C.muted }}>{s.label}{s.key === "agent" && !s.done && st.missingAgentFields.length ? ` (חסרות ${st.missingAgentFields.length} תשובות חובה)` : ""}</span>
                    <span className="text-xs" style={{ color: C.muted }}>{s.done ? d(s.at) : isCurrent ? "כאן הוא עכשיו" : ""}</span>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card title="הסוכן שלו" aside={`${answered}/${ag.fields.length} תשובות · ${ag.enabled ? "פעיל" : "כבוי"}`}>
            {ag.customPrompt && <p className="m-0 mb-3 text-[13px] rounded-lg px-3 py-2" style={{ background: TONE.warn.bg, color: TONE.warn.color }}>לעסק הזה יש פרומפט שנכתב ביד, אז התשובות למטה לא משפיעות עליו והוא לא מקבל שיפורים של הבסיס.</p>}
            <div className="flex flex-col">
              {ag.fields.map(f => {
                const has = f.value !== null && f.value !== "";
                const shown = typeof f.value === "boolean" ? (f.value ? "כן" : "לא") : (f.value as string | null);
                return (
                  <div key={f.key} className="py-2.5 flex flex-col gap-1" style={{ borderTop: `1px solid ${C.soft}` }}>
                    <div className="flex justify-between gap-2 items-start">
                      <span className="text-[13px] font-semibold" title={f.question}>{f.label}{f.core && <span style={{ color: "#B42318" }}> *</span>}</span>
                      <button type="button" className="text-xs underline min-h-[28px] shrink-0" style={{ color: C.petrol }} onClick={() => { setEditing(f.key); setVal(typeof f.value === "boolean" ? String(f.value) : (f.value as string) ?? (typeof f.default === "string" ? f.default : "")); }}>{has ? "שנה" : "מלא"}</button>
                    </div>
                    {editing === f.key ? (
                      <div className="flex flex-wrap gap-2 items-center">
                        {f.type === "choice" && f.options ? (
                          <select value={val} onChange={e => setVal(e.target.value)} className="h-10 rounded-lg px-2 text-sm" style={{ border: "1px solid #C7D8D5" }}>{f.options.map(o => <option key={o} value={o}>{o}</option>)}</select>
                        ) : f.type === "bool" ? (
                          <select value={val} onChange={e => setVal(e.target.value)} className="h-10 rounded-lg px-2 text-sm" style={{ border: "1px solid #C7D8D5" }}><option value="true">כן</option><option value="false">לא</option></select>
                        ) : (
                          <input value={val} onChange={e => setVal(e.target.value)} className="flex-1 min-w-[200px] h-10 rounded-lg px-3 text-sm" style={{ border: "1px solid #C7D8D5" }} />
                        )}
                        <Btn kind="dark" disabled={busy === "setup"} onClick={async () => { const r = await act("setup", { action: "customer.setup", id, key: f.key, value: f.type === "bool" ? val === "true" : val }, "נשמר בסוכן שלו"); if (r.ok) setEditing(null); }}>שמור</Btn>
                        <Btn kind="ghost" onClick={() => setEditing(null)}>ביטול</Btn>
                      </div>
                    ) : (
                      <span className="text-[13px]" style={{ color: has ? "#3E5A5B" : "#B42318" }}>{has ? shown : "לא ענה"}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {ag.faqs.length > 0 && <p className="m-0 mt-2 text-xs" style={{ color: C.muted }}>{ag.faqs.length} שאלות ותשובות נפוצות שמורות.</p>}
            {ag.history.length > 0 && (
              <details className="mt-3">
                <summary className="text-[13px] cursor-pointer min-h-[32px]" style={{ color: C.petrol }}>היסטוריית שינויים ({ag.history.length})</summary>
                {ag.history.map((h, i) => (
                  <div key={h.id} className="flex justify-between items-center text-xs py-1.5" style={{ borderTop: `1px solid ${C.soft}` }}>
                    <span>{d(h.createdAt)} · {AUTHOR[h.author] ?? h.author}{i === 0 ? " · הגרסה הנוכחית" : ""}</span>
                    {i > 0 && <button type="button" className="underline min-h-[28px]" style={{ color: C.petrol }} onClick={() => confirm("להחזיר את התשובות לגרסה הזאת?") && act("restore", { action: "customer.setupRestore", id, historyId: h.id }, "הגרסה הוחזרה")}>החזר לגרסה הזאת</button>}
                  </div>
                ))}
              </details>
            )}
          </Card>
        </div>

        <aside className="flex-[1_1_320px] min-w-0 flex flex-col gap-4">
          <Card title="איכות הסוכן · 7 ימים">
            {[["שיחות", data.quality.conversationsWeek], ["תורים שהסוכן קבע", data.quality.agentBookingsWeek], ["הועברו לאדם", data.quality.escalatedWeek], ["תורים השבוע (כל המקורות)", c.apptsWeek]].map(([l, v]) => (
              <div key={String(l)} className="flex justify-between text-sm py-1.5" style={{ borderBottom: `1px solid ${C.soft}` }}><span style={{ color: C.muted }}>{l}</span><b style={NUM}>{v}</b></div>
            ))}
          </Card>

          <Card title="כסף">
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between"><span style={{ color: C.muted }}>מצב</span><b>{b.suspendedAt ? "מושהה" : b.paidAt ? `משלם מ-${d(b.paidAt).split(",")[0]}` : b.trialEndsAt ? `ניסיון עד ${d(b.trialEndsAt).split(",")[0]}` : "—"}</b></div>
              <div className="flex justify-between"><span style={{ color: C.muted }}>עולה לנו החודש</span><b style={{ ...NUM, color: c.price > 0 && c.costIls > c.price ? "#B42318" : C.ink }}>{ils(c.costIls)} ({c.pkgPct}% מהחבילה)</b></div>
              <label className="flex justify-between items-center gap-2"><span style={{ color: C.muted }}>מחיר חודשי (₪)</span>
                <span className="flex gap-1.5"><input type="number" min={0} placeholder={String(b.monthlyPrice ?? "")} value={price} onChange={e => setPrice(e.target.value)} className="w-24 h-9 rounded-lg px-2" style={{ border: "1px solid #C7D8D5" }} /><Btn className="!min-h-[36px]" disabled={!price || !!busy} onClick={() => patchBiz("price", { monthlyPrice: Number(price) }, "המחיר עודכן").then(() => setPrice(""))}>שמור</Btn></span>
              </label>
              <label className="flex justify-between items-center gap-2"><span style={{ color: C.muted }}>חבילת סוכן (₪ עלות)</span>
                <span className="flex gap-1.5"><input type="number" min={0} placeholder={String(b.tokenBudgetIls)} value={budget} onChange={e => setBudget(e.target.value)} className="w-24 h-9 rounded-lg px-2" style={{ border: "1px solid #C7D8D5" }} /><Btn className="!min-h-[36px]" disabled={!budget || !!busy} onClick={() => patchBiz("budget", { tokenBudgetIls: Number(budget) }, "החבילה עודכנה").then(() => setBudget(""))}>שמור</Btn></span>
              </label>
              <div className="flex flex-wrap gap-2 mt-1">
                {!b.paidAt && <Btn kind="primary" disabled={!!busy} onClick={() => confirm("לסמן שהעסק עבר לתשלום?") && patchBiz("paid", { markPaid: true }, "סומן כמשלם")}>סמן משלם</Btn>}
                {!b.paidAt && <Btn disabled={!!busy} onClick={() => patchBiz("trial", { extendTrialDays: 7 }, "הניסיון הוארך בשבוע")}>+7 ימי ניסיון</Btn>}
                <Btn kind={b.suspendedAt ? "outline" : "danger"} disabled={!!busy} onClick={() => confirm(b.suspendedAt ? "להחזיר את העסק לפעילות?" : "להשהות את העסק? הוא לא יוכל להיכנס והסוכן ייעצר.") && patchBiz("susp", { suspend: !b.suspendedAt }, b.suspendedAt ? "העסק הוחזר" : "העסק הושהה")}>{b.suspendedAt ? "החזר לפעילות" : "השהה"}</Btn>
              </div>
            </div>
          </Card>

          <Card title="וואטסאפ לבעל העסק">
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="own-msg">הודעה</label>
              <input id="own-msg" value={msg} onChange={e => setMsg(e.target.value)} placeholder="נשלח מהמספר של צ׳אטור" className="flex-1 h-11 rounded-xl px-3 text-sm" style={{ border: "1px solid #C7D8D5" }} />
              <Btn kind="dark" disabled={!msg.trim() || !!busy || !c.ownerPhone} onClick={async () => { const r = await act("msg", { action: "customer.message", id, body: msg }, "נשלח"); if (r.ok) setMsg(""); }}>שלח</Btn>
            </div>
          </Card>

          <Card title="הערות וציר זמן">
            <div className="flex gap-2 mb-3">
              <label className="sr-only" htmlFor="cust-note">הערה</label>
              <input id="cust-note" value={note} onChange={e => setNote(e.target.value)} placeholder="מה חשוב לזכור" className="flex-1 h-11 rounded-xl px-3 text-sm" style={{ border: "1px solid #C7D8D5" }} />
              <Btn kind="dark" disabled={!note.trim() || !!busy} onClick={async () => { const r = await act("note", { action: "customer.note", id, body: note }); if (r.ok) setNote(""); }}>הוסף</Btn>
            </div>
            {data.notes.map(n => <p key={n.id} className="m-0 mb-2 text-[13px]"><b>{n.author}</b> · <span style={{ color: C.muted }}>{d(n.createdAt)}</span><br />{n.body}</p>)}
            {data.lead && <p className="m-0 text-xs" style={{ color: C.muted }}>הגיע כליד ב-{d(data.lead.createdAt)} · <Link href={`/admin/crm/leads/${data.lead.id}`} style={{ color: C.petrol }}>לכרטיס הליד</Link></p>}
          </Card>
        </aside>
      </div>
    </div>
  );
}
