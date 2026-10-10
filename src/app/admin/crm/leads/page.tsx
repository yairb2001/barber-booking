"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { C, NUM, Btn, PageHead, useCrm, crmAction, ago, STAGE_TONE, SOURCE_LABEL } from "../ui";

type Lead = { id: string; name: string | null; phone: string; businessName: string | null; source: string; stage: string; createdAt: string; lastInboundAt: string | null; optedOut: boolean; rep: string | null; next: string };
type Data = { stages: { key: string; label: string }[]; reps: { id: string; name: string }[]; leads: Lead[] };

const SRC_TONE: Record<string, { bg: string; color: string }> = {
  landing: { bg: "#E3F7EF", color: "#0F6B4F" },
  whatsapp_demo: { bg: "#FFF1D6", color: "#7A4A00" },
  whatsapp_keywords: { bg: "#FFF1D6", color: "#7A4A00" },
  manual: { bg: C.soft, color: "#3E5A5B" },
};

/** Status tabs (10.10.2026, Yair: "הלשוניות למעלה יהיו הסטטוסים … הראשון חדשים,
 *  אחד לפני אחרון פעילים, אחרון הכל"), one filter button for source / rep /
 *  stuck, and a plain list instead of a board of cards. */
const TABS: { key: string; label: string; stages: string[] | null }[] = [
  { key: "new", label: "חדשים", stages: ["new"] },
  { key: "chatting", label: "בשיחה", stages: ["chatting"] },
  { key: "call_booked", label: "שיחה נקבעה", stages: ["call_booked"] },
  { key: "trial", label: "בניסיון", stages: ["trial"] },
  { key: "paying", label: "משלמים", stages: ["paying"] },
  { key: "not_relevant", label: "לא רלוונטי", stages: ["not_relevant"] },
  { key: "active", label: "פעילים", stages: ["new", "chatting", "call_booked", "trial"] },
  { key: "all", label: "הכל", stages: null },
];
const SOURCES = [["landing", "אתר"], ["whatsapp_demo", "דמו"], ["whatsapp_keywords", "וואטסאפ"], ["manual", "ידני"]] as const;

function LeadsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = TABS.find(t => t.key === sp.get("tab"))?.key ?? "new";
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("view=leads");
  const { data, error, loading, reload } = useCrm<Data>(query);
  const [showFilter, setShowFilter] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [rep, setRep] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const [showNew, setShowNew] = useState(sp.get("new") === "1");
  const [form, setForm] = useState({ name: "", phone: "", businessName: "", start: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim() ? `view=leads&q=${encodeURIComponent(q.trim())}` : "view=leads"), 300); return () => clearTimeout(t); }, [q]);

  // Filters first (they apply to every tab and to the tab counts), then the tab.
  const filtered = useMemo(() => (data?.leads ?? []).filter(l =>
    (!src || l.source === src) &&
    (!rep || l.rep === rep) &&
    (!stuck || (["new", "chatting"].includes(l.stage) && Date.now() - new Date(l.lastInboundAt ?? l.createdAt).getTime() > 2 * 86400_000))
  ), [data, src, rep, stuck]);
  const inTab = (t: (typeof TABS)[number]) => (t.stages ? filtered.filter(l => t.stages!.includes(l.stage)) : filtered);
  const current = TABS.find(t => t.key === tab)!;
  const list = inTab(current);
  const activeFilters = Number(!!src) + Number(!!rep) + Number(stuck);
  const setTab = (k: string) => router.replace(k === "new" ? "/admin/crm/leads" : `/admin/crm/leads?tab=${k}`, { scroll: false });
  const stageName = (k: string) => data?.stages.find(x => x.key === k)?.label ?? k;

  async function create() {
    setBusy(true); setMsg(null);
    const r = await crmAction({ action: "lead.create", name: form.name, phone: form.phone, businessName: form.businessName, startAutomation: form.start });
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? "שגיאה"); return; }
    router.push(`/admin/crm/leads/${r.id}`);
  }

  const chip = (on: boolean) => (on ? { background: C.petrol, color: "#fff", border: `1px solid ${C.petrol}` } : { background: "#fff", color: C.ink, border: "1px solid #C7D8D5" });
  return (
    <div className="flex flex-col gap-3.5">
      <PageHead title="לידים" sub={`${data?.leads.length ?? 0} לידים`} actions={<Btn kind="primary" onClick={() => setShowNew(s => !s)}>+ ליד חדש</Btn>} />

      {showNew && (
        <section className="rounded-2xl bg-white p-4 flex flex-wrap gap-3 items-end" style={{ border: `1px solid ${C.line}` }}>
          {([["name", "שם"], ["phone", "טלפון"], ["businessName", "שם המספרה"]] as const).map(([k, l]) => (
            <label key={k} className="flex flex-col gap-1 text-xs flex-[1_1_160px]" style={{ color: C.muted }}>{l}
              <input value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} dir={k === "phone" ? "ltr" : undefined} className="h-11 rounded-xl px-3 text-sm text-slate-900" style={{ border: `1px solid #C7D8D5` }} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm min-h-[44px]"><input type="checkbox" checked={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.checked }))} className="w-5 h-5" style={{ accentColor: C.petrol }} />להפעיל את אוטומציית &quot;ליד חדש&quot;</label>
          <Btn kind="dark" onClick={create} disabled={busy || !form.phone.trim()}>{busy ? "שומר…" : "שמור ופתח"}</Btn>
          {msg && <span className="text-sm text-red-700 w-full">{msg}</span>}
        </section>
      )}

      {/* Status tabs */}
      <div role="tablist" aria-label="סטטוס" className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
        {TABS.map(t => {
          const n = inTab(t).length;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className="shrink-0 h-10 px-3.5 rounded-full text-sm font-semibold inline-flex items-center gap-1.5" style={chip(tab === t.key)}>
              {t.label}<span className="text-xs" style={{ ...NUM, opacity: 0.75 }}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Search + one filter button */}
      <div className="flex gap-2 items-center">
        <label className="flex-1 flex items-center gap-2 bg-white rounded-xl px-3 h-11 min-w-0" style={{ border: `1px solid ${C.line}` }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש: שם, מספרה או טלפון" className="flex-1 min-w-0 bg-transparent outline-none text-sm" aria-label="חיפוש" />
        </label>
        <button type="button" onClick={() => setShowFilter(f => !f)} aria-expanded={showFilter} className="shrink-0 h-11 px-3.5 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5" style={activeFilters ? { background: C.petrol, color: "#fff" } : { background: "#fff", color: C.petrol, border: `1px solid ${C.line}` }}>
          סינון{activeFilters ? <span className="w-5 h-5 rounded-full text-xs inline-flex items-center justify-center" style={{ ...NUM, background: C.turquoise, color: C.ink }}>{activeFilters}</span> : null}
        </button>
      </div>

      {showFilter && (
        <section className="bg-white rounded-2xl p-3.5 flex flex-col gap-3" style={{ border: `1px solid ${C.line}` }}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] w-16" style={{ color: C.muted }}>מקור</span>
            <button type="button" onClick={() => setSrc(null)} className="h-9 px-3 rounded-full text-[13px]" style={chip(!src)}>הכל</button>
            {SOURCES.map(([k, l]) => <button key={k} type="button" onClick={() => setSrc(src === k ? null : k)} className="h-9 px-3 rounded-full text-[13px]" style={chip(src === k)}>{l}</button>)}
          </div>
          {(data?.reps.length ?? 0) > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] w-16" style={{ color: C.muted }}>נציג</span>
              <button type="button" onClick={() => setRep(null)} className="h-9 px-3 rounded-full text-[13px]" style={chip(!rep)}>כולם</button>
              {data!.reps.map(r => <button key={r.id} type="button" onClick={() => setRep(rep === r.name ? null : r.name)} className="h-9 px-3 rounded-full text-[13px]" style={chip(rep === r.name)}>{r.name}</button>)}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm min-h-[40px]">
            <input type="checkbox" checked={stuck} onChange={e => setStuck(e.target.checked)} className="w-5 h-5" style={{ accentColor: C.petrol }} />
            רק תקועים (בלי תגובה יותר מיומיים)
          </label>
          <div className="flex gap-3 text-sm">
            {activeFilters > 0 && <button type="button" onClick={() => { setSrc(null); setRep(null); setStuck(false); }} className="min-h-[36px]" style={{ color: C.petrol }}>נקה סינון</button>}
            <button type="button" onClick={() => void reload()} className="min-h-[36px] ms-auto" style={{ color: C.muted }}>רענון</button>
          </div>
        </section>
      )}

      {error && <p className="text-red-700">{error}</p>}
      {!data && loading && <p style={{ color: C.muted }}>טוען…</p>}
      {data && (
        <section className="bg-white rounded-2xl" style={{ border: `1px solid ${C.line}` }}>
          {list.length === 0 && <p className="m-0 p-4 text-sm" style={{ color: C.muted }}>{activeFilters || q ? "אין לידים שמתאימים לסינון." : `אין לידים ב"${current.label}".`}</p>}
          {list.slice(0, 300).map((l, i) => (
            <Link key={l.id} href={`/admin/crm/leads/${l.id}`} className="flex items-center gap-3 px-3.5 py-3" style={{ borderTop: i ? `1px solid ${C.soft}` : undefined, color: C.ink, textDecoration: "none" }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="font-bold text-[15px] truncate">{l.name || l.phone}</span>
                  {l.businessName && <span className="text-[13px] truncate" style={{ color: "#3E5A5B" }}>{l.businessName}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <span className="text-[12px]" dir="ltr" style={{ ...NUM, color: C.muted }}>{l.phone.replace(/^\+?972/, "0")}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={SRC_TONE[l.source] ?? SRC_TONE.manual}>{SOURCE_LABEL[l.source] ?? l.source}</span>
                  {current.stages?.length !== 1 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: C.soft, color: C.petrol }}><span className="w-2 h-2 rounded-full" style={{ background: STAGE_TONE[l.stage]?.accent ?? C.petrol }} />{stageName(l.stage)}</span>}
                  {l.optedOut && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FDECEA", color: "#B42318" }}>הוסר</span>}
                  {l.next && <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: C.ground, color: "#3E5A5B" }}>{l.next}</span>}
                </div>
              </div>
              <span className="shrink-0 text-xs" style={{ color: C.muted }}>{ago(l.createdAt)}</span>
              <span className="shrink-0" style={{ color: C.muted }} aria-hidden="true">‹</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

export default function LeadsPage() {
  return <Suspense fallback={<p>טוען…</p>}><LeadsInner /></Suspense>;
}
