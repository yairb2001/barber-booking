"use client";

import { useCallback, useEffect, useState } from "react";

/** Chator CRM design tokens + small shared pieces (direction A). */
export const C = { petrol: "#0B3A3C", petrol2: "#14504F", turquoise: "#4FE3B1", coral: "#FF6B57", ink: "#0B1F21", mist: "#E8F4F1", ground: "#F4F7F6", line: "#DCE6E4", muted: "#536B6C", soft: "#EEF3F2" };
export const NUM = { fontFamily: "Outfit, Heebo, sans-serif" } as const;

export const TONE = {
  bad: { bg: "#FDECEA", color: "#B42318", dot: "#D92D20" },
  warn: { bg: "#FFF1D6", color: "#7A4A00", dot: "#F5A623" },
  ok: { bg: "#E3F7EF", color: "#0F6B4F", dot: "#2BC293" },
  info: { bg: C.mist, color: C.petrol, dot: C.petrol },
} as const;
export type Tone = keyof typeof TONE;

/** A white card. collapsible: the title row opens and closes it (closed by
 *  default unless defaultOpen); aside stays visible as the summary. */
export function Card({ title, aside, children, className = "", dark = false, collapsible = false, defaultOpen = false }: { title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string; dark?: boolean; collapsible?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!collapsible || defaultOpen);
  const asideEl = aside && <div className="text-[13px]" style={{ color: dark ? "#A9C9C4" : C.muted }}>{aside}</div>;
  return (
    <section className={`rounded-[18px] ${collapsible ? "px-5 py-1" : "p-5"} ${className}`} style={dark ? { background: C.petrol, color: "#fff" } : { background: "#fff", border: `1px solid ${C.line}` }}>
      {collapsible ? (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full min-h-[52px] flex items-center justify-between gap-3 text-start" style={{ color: "inherit" }}>
          {title && <h2 className="m-0 text-[16px] font-bold">{title}</h2>}
          <span className="flex items-center gap-2 shrink-0">
            {asideEl}
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke={C.muted} strokeWidth="2.2" strokeLinecap="round" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }}><path d="M6 9l6 6 6-6" /></svg>
          </span>
        </button>
      ) : (title || aside) && (
        <div className="flex items-baseline justify-between gap-3 mb-3">
          {title && <h2 className="m-0 text-[17px] font-bold">{title}</h2>}
          {asideEl}
        </div>
      )}
      {open && <div className={collapsible ? "pb-4 pt-1" : ""}>{children}</div>}
    </section>
  );
}

export function Tag({ tone = "info", children }: { tone?: Tone; children: React.ReactNode }) {
  const t = TONE[tone];
  return <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: t.bg, color: t.color }}>{children}</span>;
}

export function Btn({ kind = "outline", children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "dark" | "outline" | "ghost" | "danger" }) {
  const style: React.CSSProperties =
    kind === "primary" ? { background: C.coral, color: C.ink, border: 0 } :
    kind === "dark" ? { background: C.petrol, color: "#fff", border: 0 } :
    kind === "danger" ? { background: "#fff", color: "#B42318", border: "1px solid #F3B8B2" } :
    kind === "ghost" ? { background: "transparent", color: C.petrol, border: 0 } :
    { background: "#fff", color: C.petrol, border: `1px solid ${C.petrol}` };
  return <button type="button" {...rest} className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold disabled:opacity-50 ${className}`} style={{ ...style, ...(rest.style || {}) }}>{children}</button>;
}

export function PageHead({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div>
        <h1 className="m-0 text-[26px] font-extrabold">{title}</h1>
        {sub && <p className="m-0 mt-0.5 text-sm" style={{ color: C.muted }}>{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 items-center">{actions}</div>}
    </header>
  );
}

/** GET /api/admin/crm?view=… with loading / error / reload. */
export function useCrm<T>(query: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/crm?${query}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) setError(j.error || "שגיאה"); else { setData(j); setError(null); }
    } catch { setError("שגיאת רשת"); }
    setLoading(false);
  }, [query]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

export async function crmAction(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  try {
    const r = await fetch("/api/admin/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, ...j } : { ok: false, error: j.error || "הפעולה נכשלה" };
  } catch { return { ok: false, error: "שגיאת רשת" }; }
}

export const STAGE_TONE: Record<string, { accent: string; label: string }> = {
  new: { accent: "#8FB8B0", label: "ליד חדש" },
  chatting: { accent: C.turquoise, label: "בשיחה עם הסוכן" },
  call_booked: { accent: "#2BC293", label: "שיחה נקבעה" },
  trial: { accent: "#FFB4A8", label: "בניסיון חינם" },
  paying: { accent: C.petrol, label: "משלם" },
  not_relevant: { accent: "#C7D8D5", label: "לא רלוונטי" },
};

export const SOURCE_LABEL: Record<string, string> = { landing: "אתר", whatsapp_demo: "דמו", whatsapp_keywords: "וואטסאפ", manual: "ידני" };

export function ago(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `לפני ${Math.max(1, m)} דק׳`;
  const h = Math.round(m / 60);
  if (h < 24) return `לפני ${h} ש׳`;
  const d = Math.round(h / 24);
  return `לפני ${d} ימים`;
}

export const ils = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;
