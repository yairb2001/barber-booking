"use client";

import { useState } from "react";
import { C, NUM, Btn, Card } from "../../ui";

/**
 * The customer card's plan and invoices (10.10.2026). A plan is sold by
 * appointments a month; messages and the AI budget are the safety meters.
 * Invoices arrive from Invoice4U by themselves once it is connected; until
 * then they can be added by hand. Each opens in full and can be sent to the
 * owner on WhatsApp from Chator's number.
 */

type Meter = { used: number; cap: number; pct: number };
type Plan = { key: string; name: string; apptsCap: number; messages: number; aiBudgetIls: number; priceIls: number };
type Invoice = { id: string; number: string | null; issuedAt: string; amountIls: number; status: string; pdfUrl: string | null; provider: string; sentAt: string | null };
export type BillingData = {
  planKey: string | null; plans: Plan[];
  usage: { month: string; appts: Meter; messages: Meter; ai: Meter; marketing: Meter } | null;
  packs: { id: string; kind: string; qty: number; priceIls: number; month: string; createdAt: string }[];
  invoices: Invoice[]; billingEmail: string;
  packPrices: { messages: [number, number]; ai: [number, number]; marketing: [number, number] };
  providerConnected: boolean;
};

const day = (iso: string) => new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", year: "2-digit", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
const STATUS: Record<string, [string, string, string]> = { paid: ["שולם", "#E3F7EF", "#0F6B4F"], unpaid: ["לא שולם", "#FFF1D6", "#7A4A00"], failed: ["נכשל", "#FDECEA", "#B42318"] };
const PACK_LABEL: Record<string, string> = { messages: "הודעות", ai: "סוכן", marketing: "שיווק" };

function Bar({ label, m, unit = "" }: { label: string; m: Meter; unit?: string }) {
  const color = m.pct >= 100 ? "#D92D20" : m.pct >= 80 ? "#F5A623" : C.turquoise;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[13px]"><span style={{ color: C.muted }}>{label}</span><span style={NUM}><b>{m.used.toLocaleString("he-IL")}</b>{m.cap > 0 ? ` / ${m.cap.toLocaleString("he-IL")}${unit}` : unit}</span></div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: C.soft }}><div className="h-full rounded-full" style={{ width: `${Math.min(100, m.pct)}%`, background: color }} /></div>
    </div>
  );
}

export function PlanCard({ id, data, busy, act }: { id: string; data: BillingData; busy: string | null; act: (key: string, body: Record<string, unknown>, done?: string) => Promise<{ ok: boolean }> }) {
  const plan = data.plans.find(p => p.key === data.planKey) ?? null;
  const u = data.usage;
  const pp = data.packPrices;
  return (
    <Card collapsible title="מסלול ושימוש החודש" aside={plan ? `${plan.name} · ${plan.priceIls} ₪` : "בלי מסלול"}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span style={{ color: C.muted }}>מסלול</span>
          <select value={data.planKey ?? ""} disabled={!!busy} onChange={e => e.target.value && confirm("להעביר למסלול הזה? המחיר וחבילת הסוכן יתעדכנו.") && act("plan", { action: "customer.plan", id, planKey: e.target.value }, "המסלול עודכן")} className="flex-1 h-10 rounded-lg px-2" style={{ border: "1px solid #C7D8D5" }}>
            <option value="">בחר מסלול</option>
            {data.plans.map(p => <option key={p.key} value={p.key}>{p.name}: עד {p.apptsCap} תורים · {p.priceIls} ₪</option>)}
          </select>
        </label>
        {u && (
          <>
            <Bar label="תורים" m={u.appts} />
            <Bar label="הודעות" m={u.messages} />
            <Bar label="חבילת הסוכן" m={u.ai} unit=" ₪" />
            {u.marketing.cap > 0 || u.marketing.used > 0 ? <Bar label="הודעות שיווק" m={u.marketing} /> : null}
          </>
        )}
        <div className="flex flex-wrap gap-1.5">
          {(["messages", "ai", "marketing"] as const).map(k => (
            <Btn key={k} kind="outline" className="!min-h-[38px] !px-3 !text-[13px]" disabled={!!busy} onClick={() => confirm(`להוסיף חבילת ${PACK_LABEL[k]} (${k === "ai" ? `${pp.ai[0]} ₪ עלות` : `${pp[k][0]} הודעות`}) ב-${pp[k][1]} ₪ לחודש הזה?`) && act("pack", { action: "customer.pack", id, kind: k }, "החבילה נוספה")}>
              + {PACK_LABEL[k]} · {pp[k][1]} ₪
            </Btn>
          ))}
        </div>
        {data.packs.length > 0 && (
          <div className="text-xs" style={{ color: C.muted }}>
            {data.packs.slice(0, 6).map(p => <div key={p.id}>{p.month} · {PACK_LABEL[p.kind]} {p.kind === "ai" ? `${p.qty} ₪` : p.qty} · {p.priceIls} ₪</div>)}
          </div>
        )}
      </div>
    </Card>
  );
}

export function InvoicesCard({ id, data, busy, act }: { id: string; data: BillingData; busy: string | null; act: (key: string, body: Record<string, unknown>, done?: string) => Promise<{ ok: boolean; [k: string]: unknown }> }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ number: "", issuedAt: new Date().toISOString().slice(0, 10), amount: "", pdfUrl: "", status: "paid" });
  const [email, setEmail] = useState(data.billingEmail);
  const [link, setLink] = useState<string | null>(null);
  return (
    <Card collapsible title="חשבוניות ותשלום" aside={data.invoices.some(i => i.status === "failed") ? "יש חיוב שנכשל" : data.invoices.length ? `${data.invoices.length} חשבוניות` : undefined}>
      {!data.providerConnected && <p className="m-0 mb-2 text-xs" style={{ color: C.muted }}>Invoice4U עוד לא מחובר.</p>}
      <div className="flex flex-col gap-2">
        {data.invoices.length === 0 && <p className="m-0 text-sm" style={{ color: C.muted }}>אין עדיין חשבוניות.</p>}
        {data.invoices.map(i => {
          const [lbl, bg, fg] = STATUS[i.status] ?? STATUS.paid;
          return (
            <div key={i.id} className="flex items-center gap-2 text-sm py-1.5" style={{ borderBottom: `1px solid ${C.soft}` }}>
              {i.pdfUrl
                ? <a href={i.pdfUrl} target="_blank" rel="noreferrer" className="flex-1 min-w-0" style={{ color: C.ink, textDecoration: "none" }}><b style={NUM}>{i.number ? `#${i.number}` : "חשבונית"}</b> <span style={{ color: C.muted }}>· {day(i.issuedAt)} · </span><span style={NUM}>{i.amountIls.toLocaleString("he-IL")} ₪</span></a>
                : <span className="flex-1 min-w-0"><b style={NUM}>{i.number ? `#${i.number}` : "חיוב"}</b> <span style={{ color: C.muted }}>· {day(i.issuedAt)} · </span><span style={NUM}>{i.amountIls.toLocaleString("he-IL")} ₪</span></span>}
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: bg, color: fg }}>{lbl}</span>
              {i.pdfUrl && <Btn kind="ghost" className="!min-h-[34px] !px-2 !text-[13px]" disabled={!!busy} onClick={() => confirm("לשלוח את החשבונית לבעל העסק בוואטסאפ?") && act("inv-send", { action: "invoice.send", invoiceId: i.id }, "החשבונית נשלחה")}>{i.sentAt ? "שלח שוב" : "שלח"}</Btn>}
              {i.provider === "manual" && <button type="button" className="w-8 h-8" style={{ color: C.muted }} aria-label="מחק" onClick={() => confirm("למחוק את החשבונית מהרשימה?") && act("inv-del", { action: "invoice.delete", invoiceId: i.id }, "נמחקה")}>×</button>}
            </div>
          );
        })}

        {adding ? (
          <div className="flex flex-col gap-2 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <input value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} placeholder="מספר חשבונית" className="h-10 rounded-lg px-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
              <input type="date" value={form.issuedAt} onChange={e => setForm(f => ({ ...f, issuedAt: e.target.value }))} className="h-10 rounded-lg px-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
              <input type="number" min={0} value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="סכום כולל מע״מ" className="h-10 rounded-lg px-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="h-10 rounded-lg px-2 text-sm" style={{ border: "1px solid #C7D8D5" }}><option value="paid">שולם</option><option value="unpaid">לא שולם</option></select>
            </div>
            <input value={form.pdfUrl} onChange={e => setForm(f => ({ ...f, pdfUrl: e.target.value }))} dir="ltr" placeholder="https://… קישור לחשבונית" className="h-10 rounded-lg px-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
            <div className="flex gap-2">
              <Btn kind="dark" disabled={!!busy || !form.amount} onClick={async () => { const r = await act("inv-add", { action: "invoice.create", id, ...form, amount: Number(form.amount) }, "החשבונית נוספה"); if (r.ok) { setAdding(false); setForm(f => ({ ...f, number: "", amount: "", pdfUrl: "" })); } }}>שמור</Btn>
              <Btn kind="ghost" onClick={() => setAdding(false)}>ביטול</Btn>
            </div>
          </div>
        ) : (
          <Btn kind="ghost" className="self-start !px-0" onClick={() => setAdding(true)}>+ הוסף חשבונית ידנית</Btn>
        )}

        <div className="flex flex-col gap-2 pt-2" style={{ borderTop: `1px solid ${C.soft}` }}>
          <span className="text-[13px] font-semibold">הוראת קבע לחודש הבא</span>
          {!data.providerConnected && <p className="m-0 text-xs" style={{ color: C.muted }}>יופעל אחרי שתדליק אצל Invoice4U הוראות קבע ושמירת כרטיס, ותחדש את מפתח הגישה.</p>}
          <div className="flex gap-2">
            <input value={email} onChange={e => setEmail(e.target.value)} dir="ltr" placeholder="מייל לחשבוניות" className="flex-1 min-w-0 h-10 rounded-lg px-2 text-sm" style={{ border: "1px solid #C7D8D5" }} />
            <Btn kind="dark" disabled={!!busy || !data.providerConnected} onClick={async () => { const r = await act("paylink", { action: "customer.payLink", id, email }, "נוצר קישור תשלום"); if (r.ok && typeof r.url === "string") setLink(r.url); }}>צור קישור תשלום</Btn>
          </div>
          {link && <a href={link} target="_blank" rel="noreferrer" dir="ltr" className="text-xs break-all" style={{ color: C.petrol }}>{link}</a>}
        </div>
      </div>
    </Card>
  );
}
