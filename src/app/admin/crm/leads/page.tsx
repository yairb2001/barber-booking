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

function LeadsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("view=leads");
  const { data, error, loading, reload } = useCrm<Data>(query);
  const [filter, setFilter] = useState<"all" | "landing" | "demo" | "stuck">("all");
  const [showNew, setShowNew] = useState(sp.get("new") === "1");
  const [form, setForm] = useState({ name: "", phone: "", businessName: "", start: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setQuery(q.trim() ? `view=leads&q=${encodeURIComponent(q.trim())}` : "view=leads"), 300); return () => clearTimeout(t); }, [q]);

  const leads = useMemo(() => (data?.leads ?? []).filter(l => {
    if (filter === "landing") return l.source === "landing";
    if (filter === "demo") return l.source.startsWith("whatsapp");
    if (filter === "stuck") return ["new", "chatting"].includes(l.stage) && Date.now() - new Date(l.lastInboundAt ?? l.createdAt).getTime() > 2 * 86400_000;
    return true;
  }), [data, filter]);

  async function create() {
    setBusy(true); setMsg(null);
    const r = await crmAction({ action: "lead.create", name: form.name, phone: form.phone, businessName: form.businessName, startAutomation: form.start });
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? "שגיאה"); return; }
    router.push(`/admin/crm/leads/${r.id}`);
  }

  const cols = (data?.stages ?? []).filter(s => s.key !== "not_relevant");
  return (
    <div className="flex flex-col gap-4">
      <PageHead title="לידים" sub={`${data?.leads.length ?? 0} לידים · לחיצה על כרטיס פותחת אותו`} actions={<>
        <label className="flex items-center gap-2 bg-white rounded-xl px-3 h-11 min-w-[220px]" style={{ border: `1px solid ${C.line}` }}>
          <span className="text-[13px]" style={{ color: C.muted }}>חיפוש</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="שם, מספרה או טלפון" className="flex-1 bg-transparent outline-none text-sm" />
        </label>
        <Btn kind="primary" onClick={() => setShowNew(s => !s)}>+ ליד חדש</Btn>
      </>} />

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

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[13px]" style={{ color: C.muted }}>סינון:</span>
        {([["all", "הכל"], ["landing", "מהאתר"], ["demo", "מהדמו"], ["stuck", "תקועים מעל יומיים"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className="h-9 px-3 rounded-full text-[13px]" style={filter === k ? { background: C.petrol, color: "#fff", border: `1px solid ${C.petrol}` } : { background: "#fff", color: C.ink, border: "1px solid #C7D8D5" }}>{l}</button>
        ))}
        <button type="button" onClick={() => void reload()} className="h-9 px-3 rounded-full text-[13px] ms-auto" style={{ color: C.petrol }}>רענון</button>
      </div>

      {error && <p className="text-red-700">{error}</p>}
      {!data && loading && <p style={{ color: C.muted }}>טוען…</p>}
      {data && (
        <div className="overflow-x-auto pb-2">
          <div className="grid gap-3.5" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(240px, 1fr))`, minWidth: cols.length * 250 }}>
            {cols.map(col => {
              const items = leads.filter(l => l.stage === col.key);
              return (
                <section key={col.key} className="rounded-2xl p-3 flex flex-col gap-2.5" style={{ background: "#EAF0EF", borderTop: `4px solid ${STAGE_TONE[col.key]?.accent ?? C.line}` }}>
                  <div className="flex justify-between items-baseline px-1">
                    <h2 className="m-0 text-[15px] font-bold">{col.label}</h2>
                    <span className="text-sm font-bold" style={{ ...NUM, color: C.muted }}>{items.length}</span>
                  </div>
                  {items.length === 0 && <p className="m-0 px-1 text-xs" style={{ color: C.muted }}>אין כאן לידים</p>}
                  {items.slice(0, 60).map(l => (
                    <Link key={l.id} href={`/admin/crm/leads/${l.id}`} className="bg-white rounded-xl p-3 flex flex-col gap-1.5" style={{ border: `1px solid ${C.line}`, color: C.ink, textDecoration: "none" }}>
                      <div className="flex justify-between gap-2">
                        <span className="font-bold text-sm">{l.name || l.phone}</span>
                        <span className="text-[11px] whitespace-nowrap" style={{ color: C.muted }}>{ago(l.createdAt)}</span>
                      </div>
                      <span className="text-[13px]" style={{ color: "#3E5A5B" }}>{l.businessName || "מספרה לא צוינה"}</span>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={SRC_TONE[l.source] ?? SRC_TONE.manual}>{SOURCE_LABEL[l.source] ?? l.source}</span>
                        {l.optedOut && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#FDECEA", color: "#B42318" }}>הוסר</span>}
                        {l.next && <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: C.ground, color: "#3E5A5B" }}>{l.next}</span>}
                      </div>
                    </Link>
                  ))}
                </section>
              );
            })}
          </div>
          {leads.some(l => l.stage === "not_relevant") && <p className="text-xs mt-2" style={{ color: C.muted }}>{leads.filter(l => l.stage === "not_relevant").length} לידים סומנו לא רלוונטיים ולא מוצגים בלוח.</p>}
        </div>
      )}
    </div>
  );
}

export default function LeadsPage() {
  return <Suspense fallback={<p>טוען…</p>}><LeadsInner /></Suspense>;
}
