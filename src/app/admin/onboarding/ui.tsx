"use client";
/** The wizard's look (Chator brand), shared by its steps. */
import { useState } from "react";

export const C = { petrol: "#0B3A3C", turquoise: "#4FE3B1", coral: "#FF6B57", ink: "#0B1F21", mist: "#E8F4F1" };
export const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4FE3B1]";
export const num = "w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[14px] text-center text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4FE3B1]";
export const chip = (on: boolean) => `px-3 py-1.5 rounded-full text-sm border transition ${on ? "text-white border-transparent" : "bg-white border-slate-200 text-slate-600"}`;

export function Help({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: C.petrol }}>
        <span className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px]" style={open ? { background: C.petrol, color: "#fff" } : { background: C.mist }}>?</span>{label}
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

export function Bubble({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 rounded-2xl px-3 py-2.5 text-[13px] leading-relaxed" style={{ background: C.mist, color: C.petrol }}>
      {title && <div className="font-bold mb-1">{title}</div>}
      {children}
    </div>
  );
}
