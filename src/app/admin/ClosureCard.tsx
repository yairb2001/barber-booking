"use client";

import { rangeLabel } from "@/lib/closures/message";
import { useEffect, useState } from "react";
import { telHref } from "@/lib/messaging/phone";

/** Live status card for an open closure (calendar day view). Spec §3.6 */
type Row = { appointmentId: string; originalTime: string; customerName: string; customerPhone: string; serviceName: string;
  state: "sent" | "rescheduled" | "agent" | "silent" | "silent_escalated" | "manual" | "failed"; detail: string | null; reminders: number };
type Summary = { id: string; staffName: string; date: string; fromTime: string | null; toTime: string | null; status: string;
  counts: { total: number; open: number; rescheduled: number; manual: number; silent: number }; customers: Row[] };

const LABEL: Record<Row["state"], { t: string; c: string }> = {
  sent:             { t: "נשלח",            c: "bg-slate-100 text-slate-600" },
  rescheduled:      { t: "אישר ✓",          c: "bg-emerald-50 text-emerald-700" },
  agent:            { t: "בטיפול הסוכן",    c: "bg-amber-50 text-amber-700" },
  silent:           { t: "לא ענה",          c: "bg-red-50 text-red-600" },
  silent_escalated: { t: "לא ענה — אצלך",   c: "bg-red-50 text-red-700 font-semibold" },
  manual:           { t: "טיפול ידני",      c: "bg-slate-100 text-slate-500" },
  failed:           { t: "נכשל",            c: "bg-red-100 text-red-700" },
};

export default function ClosureCard({ closureId, onChanged }: { closureId: string; onChanged?: () => void }) {
  const [s, setS] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function load() { const r = await fetch(`/api/admin/closures/${closureId}`, { cache: "no-store" }); if (r.ok) setS(await r.json()); }
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15000); return () => clearInterval(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [closureId]);
  async function act(action: "resend" | "handled", appointmentId: string) {
    setBusy(appointmentId);
    await fetch(`/api/admin/closures/${closureId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, appointmentId }) }).catch(() => {});
    await load(); setBusy(null); onChanged?.();
  }
  if (!s) return null;
  const range = rangeLabel(s.fromTime, s.toTime);
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden" dir="rtl">
      <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
        <div><h3 className="font-semibold text-neutral-800 text-sm">סגירה · {range}</h3><p className="text-[11px] text-neutral-400">{s.staffName}</p></div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${s.counts.open ? "bg-teal-50 text-teal-700" : "bg-emerald-50 text-emerald-700"}`}>
          {s.counts.open ? `${s.counts.total - s.counts.open}/${s.counts.total} טופלו` : "הכל טופל ✓"}
        </span>
      </div>
      <div className="divide-y divide-neutral-50">
        {s.customers.map(r => (
          <div key={r.appointmentId} className="px-4 py-2.5 flex items-center gap-2 text-sm">
            <span className="font-mono font-bold text-teal-700 w-12 shrink-0">{r.originalTime}</span>
            <span className="flex-1 min-w-0 truncate">{r.customerName}{r.detail && r.state === "rescheduled" ? <span className="text-[11px] text-emerald-700"> · {r.detail}</span> : null}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${LABEL[r.state].c}`}>{LABEL[r.state].t}</span>
            {(r.state === "silent" || r.state === "silent_escalated" || r.state === "failed" || r.state === "sent") && (
              <button disabled={busy === r.appointmentId} onClick={() => act("resend", r.appointmentId)} className="text-[11px] border border-teal-300 text-teal-700 rounded-lg px-2 py-1 disabled:opacity-50">שלח שוב</button>
            )}
            {r.state !== "rescheduled" && r.state !== "manual" && (
              <a href={telHref(r.customerPhone)} className="text-[11px] border border-neutral-300 text-neutral-700 rounded-lg px-2 py-1">התקשר</a>
            )}
            {r.state !== "rescheduled" && r.state !== "manual" && (
              <button disabled={busy === r.appointmentId} onClick={() => act("handled", r.appointmentId)} className="text-[11px] text-neutral-400 px-1" title="סמן כטופל">✓</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
