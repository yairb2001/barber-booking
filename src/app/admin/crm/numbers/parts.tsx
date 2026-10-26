"use client";

import { useState } from "react";
import { C, NUM, TONE } from "../ui";
import type { saasDashboard } from "@/lib/crm/saas";

export type SaasData = Awaited<ReturnType<typeof saasDashboard>>;
const RANGES = [["30", "30 יום"], ["90", "90 יום"], ["all", "מההתחלה"], ["custom", "טווח תאריכים"]] as const;
const isoDay = (offset: number) => new Date(Date.now() + offset * 86400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

/** The period of the numbers: 30 / 90 days, from the start, or a range of dates of his own (Yair, 26.10.2026). */
export function useSaasRange() {
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("30");
  const [from, setFrom] = useState(isoDay(-30));
  const [to, setTo] = useState(isoDay(0));
  const query = range === "custom" ? `view=saas&range=custom&from=${from}&to=${to}` : `view=saas&range=${range}`;
  const field = "h-9 rounded-lg px-2 text-[13px] bg-white";
  const picker = (
    <div className="flex flex-col gap-2">
      <div role="tablist" aria-label="תקופה" className="flex flex-wrap gap-1.5">
        {RANGES.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={range === k} onClick={() => setRange(k)} className="h-9 px-3 rounded-full text-[13px] font-semibold"
            style={range === k ? { background: C.mist, color: C.petrol, border: `1px solid ${C.petrol2}` } : { background: "#fff", color: C.muted, border: `1px solid ${C.line}` }}>{l}</button>
        ))}
      </div>
      {range === "custom" && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: C.muted }}>
          <label className="flex items-center gap-1.5">מתאריך<input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} className={field} style={{ border: `1px solid ${C.line}`, color: C.ink }} /></label>
          <label className="flex items-center gap-1.5">עד<input type="date" value={to} min={from} max={isoDay(0)} onChange={e => e.target.value && setTo(e.target.value)} className={field} style={{ border: `1px solid ${C.line}`, color: C.ink }} /></label>
        </div>
      )}
    </div>
  );
  return { query, picker };
}

/** Small pieces of the dashboard (numbers/Dashboard.tsx, numbers/Accounts.tsx). */
export const STAGE: Record<string, [string, string, string]> = {
  setup: ["בהקמה", TONE.warn.bg, TONE.warn.color], trial: ["בניסיון", C.mist, C.petrol], paying: ["משלם", TONE.ok.bg, TONE.ok.color], suspended: ["מושהה", C.soft, C.muted],
};
export const days = (n: number | null) => (n == null ? "—" : n < 1 ? "באותו יום" : n === 1 ? "יום" : `${n % 1 ? n.toFixed(1) : n} ימים`);
export function Few({ n, few }: { n: number; few: number }) {
  return n < few ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: TONE.warn.bg, color: TONE.warn.color }}>מעט נתונים ({n})</span> : null;
}
export function Stat({ v, l, tone }: { v: React.ReactNode; l: string; tone?: "bad" | "warn" | "ok" }) {
  return (
    <div className="flex flex-col min-w-0">
      <b className="text-[22px] leading-tight" style={{ ...NUM, color: tone ? TONE[tone].color : C.petrol }}>{v}</b>
      <span className="text-[12px] leading-snug" style={{ color: C.muted }}>{l}</span>
    </div>
  );
}
export function Stats({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>{children}</div>;
}
export function Note({ children }: { children: React.ReactNode }) {
  return <p className="m-0 mt-3 text-[12px] leading-relaxed" style={{ color: C.muted }}>{children}</p>;
}
