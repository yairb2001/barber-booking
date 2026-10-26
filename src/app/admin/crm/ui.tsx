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

/**
 * Screens remember what they loaded (26.10.2026, Yair: every tab switch reloaded from scratch,
 * "שיהיה מהיר יותר"): a screen opens on its last data at once and refreshes it behind the scenes.
 * One request per view at a time; reload() after an action always asks the server again.
 */
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<{ ok: boolean; j: { error?: string } }>>();
function fetchView(query: string, fresh = false) {
  const running = inflight.get(query);
  if (running && !fresh) return running;
  const p = fetch(`/api/admin/crm?${query}`, { cache: "no-store" })
    .then(async r => ({ ok: r.ok, j: await r.json() }))
    .then(res => { if (res.ok) cache.set(query, res.j); return res; })
    .finally(() => { if (inflight.get(query) === p) inflight.delete(query); });
  inflight.set(query, p);
  return p;
}
/** Warm the screens one is likely to open next (the shell does it once, after entering). */
export function prefetchCrm(queries: string[]) {
  for (const q of queries) if (!cache.has(q)) fetchView(q).catch(() => {});
}

/** GET /api/admin/crm?view=… with loading / error / reload. */
export function useCrm<T>(query: string) {
  const [data, setData] = useState<T | null>(() => (cache.get(query) as T | undefined) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (fresh: boolean) => {
    const hit = cache.get(query) as T | undefined;
    if (hit) setData(hit);
    setLoading(true);
    try {
      const { ok, j } = await fetchView(query, fresh);
      if (!ok) setError(j.error || "שגיאה"); else { setData(j as T); setError(null); }
    } catch { setError("שגיאת רשת"); }
    setLoading(false);
  }, [query]);
  useEffect(() => { void load(false); }, [load]);
  const reload = useCallback(() => load(true), [load]);
  return { data, error, loading, reload };
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

/** The ⋯ menu (things done sometimes, 24.10.2026): closes after a choice. up: opens above (in a bottom bar). */
export function MoreMenu({ items, up = false }: { items: { label: string; danger?: boolean; onClick: () => void }[]; up?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="relative">
      <button type="button" aria-label="עוד פעולות" aria-expanded={open} onClick={() => setOpen(o => !o)} className="w-12 h-12 rounded-xl inline-flex items-center justify-center bg-white" style={{ border: `1px solid ${C.line}`, color: C.petrol }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div role="menu" className={`absolute ${up ? "bottom-14" : "top-14"} end-0 z-20 w-64 bg-white rounded-2xl p-1.5 flex flex-col`} style={{ border: `1px solid ${C.line}`, boxShadow: "0 14px 34px rgba(11,31,33,0.16)" }}>
            {items.map((it, k) => (
              <button key={k} type="button" role="menuitem" onClick={() => { setOpen(false); it.onClick(); }} className="min-h-[44px] px-3 rounded-xl text-right text-[15px] hover:bg-[#F4F7F6]" style={{ color: it.danger ? "#B42318" : C.ink }}>{it.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
