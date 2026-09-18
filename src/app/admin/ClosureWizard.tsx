"use client";

import { useEffect, useMemo, useState } from "react";
import { useModalBack } from "@/lib/useModalBack";
import { rangeLabel, renderClosureText, whenLabel } from "@/lib/closures/message";

/**
 * Calendar-closure wizard — shown INSTEAD of saving when the barber closes a
 * day / cuts hours that still have appointments. Three steps:
 *   1. "מה נופל"  — the displaced appointments + capacity gate (blocked → one-click fixes)
 *   2. "ההודעה"   — per-customer send toggle + custom text, global template
 *   3. done       — hands off to the live status card
 * Spec: specs/calendar-closure.md §9. All data comes from /api/admin/closures/*.
 */

type Opt = { staffId: string; staffName: string; date: string; startTime: string; sameStaff: boolean };
type Displaced = {
  appointmentId: string; startTime: string; endTime: string;
  customer: { id: string; name: string; phone: string };
  service: { id: string; name: string; durationMinutes: number };
  loyalty: { total: number; withStaff: number; share: number | null; anyStaffAllowed: boolean };
  options: Opt[]; blockedByLoyalty: boolean;
};
type Plan = {
  staffName: string; isToday: boolean; displaced: Displaced[];
  gate: { ok: boolean; needed: number; distinctSlots: number; withoutOption: string[] };
  suggestions: { allowOtherBarberFor: { appointmentId: string; customerName: string }[]; closedDaysInWindow: string[] };
};

const DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
function slotLabel(o: Opt, today: string): string {
  const d = new Date(o.date + "T00:00:00.000Z");
  const t = new Date(today + "T00:00:00.000Z"); const tm = new Date(t); tm.setUTCDate(tm.getUTCDate() + 1);
  const day = o.date === today ? "היום" : o.date === tm.toISOString().slice(0, 10) ? "מחר" : `${DAY[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
  return `${day} ${o.startTime}${o.sameStaff ? "" : ` אצל ${o.staffName}`}`;
}
function dateLabel(iso: string): string { const d = new Date(iso + "T00:00:00.000Z"); return `${DAY[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`; }

const DEFAULT_TEMPLATE =
`היי {{name}}, זה {{barber}}.
אני נאלץ עקב בלת"מ לבטל לך את התור {{when}} — קודם כל, מחילה.
אני יכול לקבוע לך במקום זאת {{option_a}}{{option_b}}.
תגיד לי מה מביניהם מתאים, ואם תרצה שעה או יום אחר — תגיד לי ואדאג לך.
ושוב סליחה על השינויים.`;

export default function ClosureWizard({ staffId, date, fromTime, toTime, today, onCancel, onDone }: {
  staffId: string; date: string; fromTime?: string | null; toTime?: string | null; today: string;
  onCancel: () => void; onDone: (closureId: string) => void;
}) {
  useModalBack(true, onCancel);
  const [step, setStep] = useState<1 | 2>(1);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [editAll, setEditAll] = useState(false);
  const [sending, setSending] = useState(false);

  const range = rangeLabel(fromTime, toTime);

  async function loadPlan() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/closures/preview", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, date, fromTime: fromTime ?? null, toTime: toTime ?? null }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      setPlan(await res.json());
    } catch (e) { setError(e instanceof Error ? e.message : "שגיאה"); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadPlan(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [staffId, date, fromTime, toTime]);
  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(b => { if (b?.closureNoticeTemplate) setTemplate(b.closureNoticeTemplate); }).catch(() => {});
  }, []);

  // Gate re-evaluated against the CURRENT exclusions (excluding someone with no option unblocks).
  const gate = useMemo(() => {
    if (!plan) return { ok: false, needed: 0, have: 0, missing: 0 };
    const active = plan.displaced.filter(d => !excluded.has(d.appointmentId));
    const distinct = new Set(active.flatMap(d => d.options.map(o => `${o.staffId}|${o.date}|${o.startTime}`)));
    const noOpt = active.filter(d => !d.options.length).length;
    return { ok: active.length === 0 || (noOpt === 0 && distinct.size >= active.length), needed: active.length, have: distinct.size, missing: Math.max(noOpt, active.length - distinct.size) };
  }, [plan, excluded]);

  // Same renderer the server uses to send — what the barber previews is what goes out.
  function preview(d: Displaced): string {
    if (custom[d.appointmentId]) return custom[d.appointmentId];
    return renderClosureText(template, { name: d.customer.name, barber: plan?.staffName ?? "", when: whenLabel(date, d.startTime), options: d.options, originalDate: date });
  }

  async function send() {
    if (!plan) return;
    setSending(true); setError(null);
    try {
      const res = await fetch("/api/admin/closures", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, date, fromTime: fromTime ?? null, toTime: toTime ?? null, reason: reason || null,
          excludeAppointmentIds: Array.from(excluded), customTextByAppointmentId: custom,
          templateOverride: template !== DEFAULT_TEMPLATE ? template : null, saveTemplate: template !== DEFAULT_TEMPLATE }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onDone(data.closureId);
    } catch (e) { setError(e instanceof Error ? e.message : "שגיאה"); setSending(false); }
  }

  const toSend = plan ? plan.displaced.filter(d => !excluded.has(d.appointmentId)).length : 0;

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center" onClick={onCancel}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="sticky top-0 bg-white border-b border-neutral-100 px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-neutral-900">סגירת יומן · {dateLabel(date)} · {range}</h2>
            <p className="text-xs text-neutral-500">{plan ? `${plan.staffName} · ${plan.displaced.length} תורים נופלים` : "בודק מה נופל…"}</p>
          </div>
          <button onClick={onCancel} className="text-neutral-400 text-xl px-2">✕</button>
        </div>
        <div className="flex gap-1.5 px-4 pt-3"><i className="flex-1 h-1 rounded bg-teal-500" /><i className={`flex-1 h-1 rounded ${step === 2 ? "bg-teal-500" : "bg-neutral-200"}`} /></div>

        {loading && <div className="p-8 text-center text-neutral-400">מחשב חלופות לכל לקוח…</div>}
        {error && <div className="mx-4 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

        {plan && !loading && step === 1 && (
          <div className="p-4 space-y-3">
            {plan.displaced.length === 0 && <p className="text-sm text-neutral-500 text-center py-6">אין תורים בטווח הזה — אפשר לסגור רגיל.</p>}
            <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
              {plan.displaced.map(d => {
                const off = excluded.has(d.appointmentId);
                return (
                  <div key={d.appointmentId} className={`px-3 py-2.5 ${off ? "opacity-50" : ""}`}>
                    <div className="flex items-start gap-3">
                      <span className="font-mono font-bold text-teal-700 w-12 shrink-0">{d.startTime}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-neutral-800 truncate">{d.customer.name}</div>
                        <div className="text-[11px] text-neutral-400">{d.service.name} · {d.loyalty.share === null ? "לקוח חדש" : `${Math.round(d.loyalty.share * 100)}% אצל ${plan.staffName.split(/\s+/)[0]}`}</div>
                        <div className="text-xs mt-1">
                          {d.options.length ? d.options.map((o, i) => <span key={i} className="inline-block ml-2 text-teal-700 font-medium">{slotLabel(o, today)}</span>)
                            : <span className="text-red-600 font-semibold">אין משבצת{d.blockedByLoyalty ? " (כלל 70%)" : ""}</span>}
                        </div>
                      </div>
                      <button onClick={() => setExcluded(s => { const n = new Set(s); n.has(d.appointmentId) ? n.delete(d.appointmentId) : n.add(d.appointmentId); return n; })}
                        className={`relative w-10 h-5 rounded-full shrink-0 mt-1 ${off ? "bg-neutral-300" : "bg-teal-600"}`} title={off ? "לא לשלוח — אטפל בעצמי" : "שלח"}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${off ? "left-0.5" : "right-0.5"}`} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {plan.displaced.length > 0 && (gate.ok
              ? <div className="rounded-xl bg-emerald-50 text-emerald-700 text-sm font-semibold px-3 py-2.5">אפשר לסגור בבטחה · {toSend} לקוחות, {gate.have} חלופות שמורות{excluded.size ? ` · ${excluded.size} בטיפול ידני שלך` : ""}</div>
              : <div className="space-y-2">
                  <div className="rounded-xl bg-red-50 text-red-700 text-sm font-semibold px-3 py-2.5">חסרות {gate.missing} משבצות כדי לסגור בבטחה</div>
                  <div className="text-xs text-neutral-500">תקן ואז לחץ "בדוק שוב": האר שעות ביום אחר, פתח יום סגור{plan.suggestions.closedDaysInWindow.length ? ` (${plan.suggestions.closedDaysInWindow.map(dateLabel).join(", ")})` : ""}, או כבה לקוח כדי לטפל בו בעצמך.</div>
                  {plan.suggestions.allowOtherBarberFor.length > 0 && <div className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">חסומים בכלל ה‑70% (קבועים אצלך, ואצלך אין מקום): {plan.suggestions.allowOtherBarberFor.map(x => x.customerName).join(", ")} — כבה אותם ותתקשר, או פתח לעצמך שעות.</div>}
                  <button onClick={loadPlan} className="w-full border border-teal-300 text-teal-700 rounded-xl py-2 text-sm font-semibold">בדוק שוב</button>
                </div>)}
            <label className="block text-xs text-neutral-500">סיבה (מופיעה רק לך)<input value={reason} onChange={e => setReason(e.target.value)} placeholder="בלת״מ" className="mt-1 w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" /></label>
            <button disabled={!gate.ok || plan.displaced.length === 0} onClick={() => setStep(2)} className="w-full bg-teal-600 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-40">המשך להודעה</button>
          </div>
        )}

        {plan && !loading && step === 2 && (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between"><h3 className="font-semibold text-neutral-800 text-sm">הנוסח לכולם (בקול שלך)</h3>
              <button onClick={() => setEditAll(v => !v)} className="text-xs text-teal-700 font-bold">{editAll ? "סגור עריכה" : "ערוך לכולם"}</button></div>
            {editAll
              ? <textarea value={template} onChange={e => setTemplate(e.target.value)} rows={6} className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm leading-relaxed" />
              : <pre className="whitespace-pre-wrap text-sm bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 leading-relaxed font-sans">{plan.displaced.find(d => !excluded.has(d.appointmentId)) ? preview(plan.displaced.find(d => !excluded.has(d.appointmentId))!) : template}</pre>}
            <p className="text-[11px] text-neutral-400">משתנים: {"{{name}} {{barber}} {{when}} {{option_a}} {{option_b}}"} · נשמר כתבנית לפעם הבאה</p>

            <h3 className="font-semibold text-neutral-800 text-sm pt-1">למי שולחים</h3>
            <div className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
              {plan.displaced.map(d => {
                const off = excluded.has(d.appointmentId);
                return (
                  <div key={d.appointmentId} className={`px-3 py-2 ${off ? "opacity-50" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm flex-1 truncate">{d.startTime} · {d.customer.name}{custom[d.appointmentId] ? <span className="text-[11px] text-teal-700"> · נוסח אישי</span> : null}{off ? <span className="text-[11px] text-neutral-400"> · לא לשלוח, אטפל בעצמי</span> : null}</span>
                      {!off && <button onClick={() => setEditing(editing === d.appointmentId ? null : d.appointmentId)} className="text-xs text-teal-700 font-bold">ערוך</button>}
                      <button onClick={() => setExcluded(s => { const n = new Set(s); n.has(d.appointmentId) ? n.delete(d.appointmentId) : n.add(d.appointmentId); return n; })}
                        className={`relative w-9 h-5 rounded-full shrink-0 ${off ? "bg-neutral-300" : "bg-teal-600"}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${off ? "left-0.5" : "right-0.5"}`} />
                      </button>
                    </div>
                    {editing === d.appointmentId && !off && (
                      <textarea autoFocus value={custom[d.appointmentId] ?? preview(d)} onChange={e => setCustom(c => ({ ...c, [d.appointmentId]: e.target.value }))} rows={6}
                        className="mt-2 w-full border border-teal-200 rounded-lg px-3 py-2 text-sm leading-relaxed" />
                    )}
                  </div>
                );
              })}
            </div>
            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            <button onClick={send} disabled={sending || !gate.ok} className="w-full bg-teal-600 text-white rounded-xl py-3 text-sm font-bold disabled:opacity-50">
              {sending ? "שולח…" : `שלח ל‑${toSend} וסגור את היומן`}
            </button>
            <button onClick={() => setStep(1)} className="w-full text-neutral-500 text-sm py-2">חזרה</button>
          </div>
        )}
      </div>
    </div>
  );
}
