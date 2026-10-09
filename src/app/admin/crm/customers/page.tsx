"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { C, NUM, TONE, Btn, PageHead, useCrm, ils } from "../ui";

type Cust = { id: string; name: string; slug: string; businessType: string; ownerPhone: string | null; stage: string; health: "ok" | "warn" | "bad"; issues: { tone: "bad" | "warn"; text: string }[]; wa: "up" | "down" | "none"; apptsWeek: number; pkgPct: number; costIls: number; price: number; trialDaysLeft: number | null; rep: string | null };
const STAGE: Record<string, string> = { setup: "בהקמה", trial: "בניסיון", paying: "משלם", suspended: "מושהה" };
const HEALTH = { ok: "תקין", warn: "לשים לב", bad: "דורש טיפול" } as const;

function CustomersInner() {
  const sp = useSearchParams();
  const focus = sp.get("focus");
  const { data, error } = useCrm<{ customers: Cust[] }>("view=customers");
  const [filter, setFilter] = useState<"all" | "attention" | "trial" | "paying" | "suspended">(focus ? "all" : "attention");
  const [busy, setBusy] = useState<string | null>(null);

  const list = useMemo(() => (data?.customers ?? []).filter(c =>
    filter === "attention" ? c.health !== "ok" && c.stage !== "suspended"
    : filter === "trial" ? c.stage === "trial" || c.stage === "setup"
    : filter === "paying" ? c.stage === "paying"
    : filter === "suspended" ? c.stage === "suspended" : true), [data, filter]);

  async function impersonate(id: string) {
    setBusy(id);
    const r = await fetch("/api/admin/super/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: id }) });
    if (r.ok) window.location.href = "/admin"; else { setBusy(null); alert("לא הצלחתי להיכנס לעסק"); }
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;
  const all = data.customers;
  const count = (f: typeof filter) => all.filter(c => f === "attention" ? c.health !== "ok" && c.stage !== "suspended" : f === "trial" ? c.stage === "trial" || c.stage === "setup" : f === "paying" ? c.stage === "paying" : f === "suspended" ? c.stage === "suspended" : true).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="לקוחות" sub={`${all.length} עסקים · ${count("paying")} משלמים · ${count("trial")} בהקמה או בניסיון · הרמזור מתעדכן לבד`} actions={
        <Link href="/admin/crm/leads?new=1" className="min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center" style={{ background: C.coral, color: C.ink, textDecoration: "none" }}>+ הקם לקוח (מליד)</Link>
      } />
      <div className="flex flex-wrap gap-2">
        {([["attention", "צריך טיפול"], ["all", "הכל"], ["trial", "בהקמה/ניסיון"], ["paying", "משלמים"], ["suspended", "מושהים"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className="h-[38px] px-3.5 rounded-full text-sm font-semibold" style={filter === k ? { background: C.petrol, color: "#fff", border: `1px solid ${C.petrol}` } : { background: "#fff", color: C.ink, border: "1px solid #C7D8D5" }}>{l} ({count(k)})</button>
        ))}
      </div>
      <section className="bg-white rounded-[18px] overflow-x-auto" style={{ border: `1px solid ${C.line}` }}>
        <table className="w-full text-sm" style={{ minWidth: 1060, borderCollapse: "collapse" }}>
          <thead>
            <tr className="text-right text-xs" style={{ color: C.muted }}>
              {["עסק", "מצב", "בריאות", "וואטסאפ", "תורים השבוע", "חבילת הסוכן", "משלם / עולה לנו", "נציג", ""].map((h, i) => <th key={i} scope="col" className="px-3 py-3.5 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center" style={{ color: C.muted }}>אין כאן עסקים.</td></tr>}
            {list.map(c => (
              <tr key={c.id} style={{ borderTop: `1px solid ${C.soft}`, background: c.id === focus ? C.mist : undefined }}>
                <td className="px-3 py-3"><div className="font-bold">{c.name}</div><div className="text-xs" style={{ color: C.muted }}>{c.ownerPhone ?? "בלי טלפון"} · /{c.slug}</div></td>
                <td className="px-3 py-3"><span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: C.soft, color: C.petrol }}>{STAGE[c.stage]}{c.trialDaysLeft != null && c.stage === "trial" ? ` · ${c.trialDaysLeft} ימים` : ""}</span></td>
                <td className="px-3 py-3">
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: TONE[c.health].color }}><span className="w-2.5 h-2.5 rounded-full" style={{ background: TONE[c.health].dot }} />{HEALTH[c.health]}</span>
                  {c.issues.length > 0 && <div className="text-xs" style={{ color: C.muted }}>{c.issues.map(i => i.text).join(" · ")}</div>}
                </td>
                <td className="px-3 py-3 text-[13px] font-semibold" style={{ color: c.wa === "up" ? "#0F6B4F" : c.wa === "down" ? "#B42318" : C.muted }}>{c.wa === "up" ? "מחובר" : c.wa === "down" ? "מנותק" : "לא חובר"}</td>
                <td className="px-3 py-3 font-semibold" style={NUM}>{c.apptsWeek}</td>
                <td className="px-3 py-3"><div className="flex items-center gap-2"><div className="w-[90px] h-2 rounded-full overflow-hidden" style={{ background: C.soft }}><div className="h-full" style={{ width: `${c.pkgPct}%`, background: c.pkgPct >= 80 ? "#F5A623" : C.turquoise }} /></div><span className="text-xs" style={{ color: C.muted }}>{c.pkgPct}%</span></div></td>
                <td className="px-3 py-3 text-[13px]" style={{ ...NUM, color: c.price > 0 && c.costIls > c.price ? "#B42318" : C.ink }}>{c.price > 0 ? ils(c.price) : c.stage === "trial" || c.stage === "setup" ? "ניסיון" : "—"} / {ils(c.costIls)}</td>
                <td className="px-3 py-3 text-[13px]">{c.rep ?? "—"}</td>
                <td className="px-3 py-3 whitespace-nowrap"><Btn kind="ghost" className="!min-h-[36px] !px-2 underline" disabled={busy === c.id} onClick={() => impersonate(c.id)}>{busy === c.id ? "נכנס…" : "היכנס כמנהל"}</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="m-0 text-xs" style={{ color: C.muted }}>&quot;עולה לנו&quot; = עלות הטוקנים של הסוכן החודש. מחירים, השהיה וחבילות עורכים בינתיים ב<Link href="/admin/super" style={{ color: C.petrol }}>מסך הפלטפורמה</Link>.</p>
    </div>
  );
}

export default function CustomersPage() {
  return <Suspense fallback={<p>טוען…</p>}><CustomersInner /></Suspense>;
}
