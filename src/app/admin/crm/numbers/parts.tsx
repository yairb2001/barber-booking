"use client";

import { C, NUM, TONE } from "../ui";

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
