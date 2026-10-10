"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { barColor, n, shortDate, type PlanData } from "./plan/shared";

/**
 * Top of the settings hub (10.10.2026, Yair: "איפה הוא רואה את המסלול?"):
 * the plan in one line and this month's three meters. Owners only; anyone
 * else gets a 403 from the API and sees nothing.
 */
export default function PlanSummary() {
  const [d, setD] = useState<PlanData | null>(null);
  useEffect(() => { fetch("/api/admin/plan", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(setD).catch(() => {}); }, []);
  if (!d) return null;
  const plan = d.plans.find(p => p.key === d.planKey) ?? null;
  const u = d.usage;
  const line = plan ? `${plan.name} · ${plan.priceIls} ₪ לחודש` : d.trialEndsAt ? `תקופת ניסיון עד ${shortDate(d.trialEndsAt)}` : "עוד לא נבחר מסלול";
  const meters = u && plan ? [
    { label: "תורים", text: `${n(u.appts.used)} / ${n(u.appts.cap)}`, pct: u.appts.pct },
    { label: "הודעות", text: `${n(u.messages.used)} / ${n(u.messages.cap)}`, pct: u.messages.pct },
    { label: "סוכן", text: `${Math.min(u.aiPct, 999)}%`, pct: u.aiPct },
  ] : [];
  return (
    <Link href="/admin/settings/plan" className="block max-w-4xl mb-4 bg-white border border-neutral-200 rounded-2xl px-5 py-4 hover:border-teal-300 transition">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-neutral-400">המסלול שלי</p>
          <p className="font-semibold text-neutral-800 truncate">{line}</p>
        </div>
        <span className="text-sm text-teal-700 shrink-0">לפרטים ←</span>
      </div>
      {meters.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mt-3">
          {meters.map(m => (
            <div key={m.label} className="min-w-0">
              <div className="flex justify-between text-[11px] text-neutral-500 gap-1"><span>{m.label}</span><span className="tabular-nums truncate">{m.text}</span></div>
              <div className="h-1.5 rounded-full bg-neutral-100 mt-1 overflow-hidden"><div className={`h-full rounded-full ${barColor(m.pct)}`} style={{ width: `${Math.min(100, m.pct)}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}
