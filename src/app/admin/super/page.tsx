"use client";

import { useEffect, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
type Biz = {
  id: string; name: string; slug: string; publicPath: string; isRoot: boolean; tier: string; ownerPhone: string | null;
  monthlyPrice: number | null; setupFee: number | null;
  paidAt: string | null; suspendedAt: string | null;
  trialEndsAt: string | null; trialDaysLeft: number | null;
  whatsappStatus: string; waLiveState: string | null; createdAt: string;
  staffCount: number; apptCount: number; customerCount: number;
  lastActivityAt: string | null;
  activated: boolean; paying: boolean; trialActive: boolean; suspended: boolean;
};
type Stats = {
  total: number; activated: number; paying: number; onTrial: number;
  newThisMonth: number; mrr: number; openLeads: number;
  funnel: { signedUp: number; activated: number; paying: number };
};
type Lead = {
  id: string; name: string | null; phone: string; source: string;
  status: string; note: string | null; createdAt: string;
};

const NIS = "₪";
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("he-IL", { day: "numeric", month: "short" }) : "—";
const waLink = (phone: string, text: string) =>
  `https://wa.me/${phone.replace(/\D/g, "").replace(/^0/, "972")}?text=${encodeURIComponent(text)}`;

const LEAD_STATUS: Record<string, { label: string; cls: string }> = {
  new:       { label: "חדש",     cls: "bg-blue-100 text-blue-700" },
  contacted: { label: "יצרתי קשר", cls: "bg-amber-100 text-amber-700" },
  demo:      { label: "דמו",      cls: "bg-purple-100 text-purple-700" },
  won:       { label: "נסגר ✓",   cls: "bg-emerald-100 text-emerald-700" },
  lost:      { label: "לא רלוונטי", cls: "bg-slate-100 text-slate-500" },
};

// ── Page ─────────────────────────────────────────────────────────────────────
export default function SuperAdminPage() {
  const [tab, setTab] = useState<"overview" | "leads" | "businesses">("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [businesses, setBusinesses] = useState<Biz[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [sRes, lRes] = await Promise.all([
      fetch("/api/admin/super", { cache: "no-store" }),
      fetch("/api/admin/super/leads", { cache: "no-store" }),
    ]);
    if (sRes.status === 403) { setForbidden(true); setLoading(false); return; }
    const s = await sRes.json();
    setStats(s.stats); setBusinesses(s.businesses);
    if (lRes.ok) setLeads((await lRes.json()).leads);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (forbidden) {
    return (
      <div className="p-8 text-center text-slate-500">
        <div className="text-4xl mb-3">🔒</div>
        אזור זה זמין למנהל הפלטפורמה בלבד.
      </div>
    );
  }
  if (loading) return <div className="p-8 text-slate-400">טוען…</div>;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ניהול הפלטפורמה</h1>
          <p className="text-sm text-slate-500">כל העסקים במערכת · לידים · הכנסות</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-slate-100 p-1 rounded-xl w-fit">
        {([["overview", "מבט־על"], ["leads", `לידים${stats?.openLeads ? ` (${stats.openLeads})` : ""}`], ["businesses", "עסקים"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k as typeof tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === k ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}>{label}</button>
        ))}
      </div>

      {tab === "overview" && stats && <Overview stats={stats} businesses={businesses} />}
      {tab === "leads" && <Leads leads={leads} reload={load} />}
      {tab === "businesses" && <Businesses businesses={businesses} reload={load} />}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
function Overview({ stats, businesses }: { stats: Stats; businesses: Biz[] }) {
  const trialEnding = businesses.filter((b) => !b.paying && b.trialActive && (b.trialDaysLeft ?? 99) <= 3);
  const stuck = businesses.filter((b) => !b.activated && !b.suspended);
  const waDown = businesses.filter((b) => b.paying && (b.waLiveState === "notAuthorized" || b.waLiveState === "blocked" || b.waLiveState === "yellowCard"));

  const cards = [
    { label: "הכנסה חודשית", value: `${NIS}${stats.mrr.toLocaleString()}`, hint: "MRR", tone: "emerald" },
    { label: "משלמים", value: stats.paying, tone: "teal" },
    { label: "בטריאל", value: stats.onTrial, tone: "amber" },
    { label: "פעילים (הפעילו)", value: stats.activated, tone: "slate" },
    { label: "סה״כ עסקים", value: stats.total, hint: `+${stats.newThisMonth} החודש`, tone: "slate" },
    { label: "לידים פתוחים", value: stats.openLeads, tone: "blue" },
  ];
  const toneCls: Record<string, string> = {
    emerald: "text-emerald-600", teal: "text-teal-600", amber: "text-amber-600",
    slate: "text-slate-700", blue: "text-blue-600",
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className={`text-2xl font-bold ${toneCls[c.tone]}`}>{c.value}</div>
            {c.hint && <div className="text-[11px] text-slate-400 mt-0.5">{c.hint}</div>}
          </div>
        ))}
      </div>

      {/* Activation funnel */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">משפך אקטיבציה</h2>
        <div className="flex items-end gap-2">
          {[
            { label: "נרשמו", v: stats.funnel.signedUp, c: "bg-blue-400" },
            { label: "הפעילו", v: stats.funnel.activated, c: "bg-teal-400" },
            { label: "משלמים", v: stats.funnel.paying, c: "bg-emerald-500" },
          ].map((f, i, arr) => {
            const max = arr[0].v || 1;
            return (
              <div key={f.label} className="flex-1 text-center">
                <div className="text-lg font-bold text-slate-700">{f.v}</div>
                <div className={`${f.c} rounded-lg mx-auto transition-all`} style={{ height: `${8 + (f.v / max) * 64}px` }} />
                <div className="text-[11px] text-slate-500 mt-1">{f.label}</div>
                {i > 0 && (
                  <div className="text-[10px] text-slate-400">
                    {arr[i - 1].v ? Math.round((f.v / arr[i - 1].v) * 100) : 0}%
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Attention */}
      <AttentionList title="🔴 טריאל נגמר בקרוב (עד 3 ימים)" items={trialEnding}
        render={(b) => `${b.name} — נשארו ${b.trialDaysLeft} ימים`} empty="אין טריאלים שנגמרים" />
      <AttentionList title="🟡 נרשמו ולא הפעילו" items={stuck}
        render={(b) => `${b.name} — ${b.ownerPhone || "?"} · נרשם ${fmtDate(b.createdAt)}`} empty="כולם הפעילו 🎉" />
      <AttentionList title="🔴 וואטסאפ מנותק אצל משלם" items={waDown}
        render={(b) => `${b.name} — ${b.waLiveState}`} empty="כל המשלמים מחוברים" />
    </div>
  );
}

function AttentionList({ title, items, render, empty }: { title: string; items: Biz[]; render: (b: Biz) => string; empty: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-slate-700 mb-2">{title}</h2>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((b) => (
            <li key={b.id} className="flex items-center justify-between text-sm text-slate-600">
              <span>{render(b)}</span>
              {b.ownerPhone && (
                <a href={waLink(b.ownerPhone, `היי, מדבר יאיר מ-DOMINANT 👋`)} target="_blank" rel="noreferrer"
                  className="text-teal-600 text-xs font-medium hover:underline">וואטסאפ →</a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Leads ────────────────────────────────────────────────────────────────────
function Leads({ leads, reload }: { leads: Lead[]; reload: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  async function setStatus(id: string, status: string) {
    await fetch(`/api/admin/super/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    reload();
  }
  async function del(id: string) {
    if (!confirm("למחוק את הליד?")) return;
    await fetch(`/api/admin/super/leads/${id}`, { method: "DELETE" });
    reload();
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim()) return;
    await fetch("/api/admin/super/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone }) });
    setName(""); setPhone(""); reload();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="bg-white rounded-2xl border border-slate-200 p-3 flex flex-wrap gap-2 items-center">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם (לא חובה)"
          className="flex-1 min-w-[120px] rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="טלפון *"
          className="flex-1 min-w-[120px] rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <button className="bg-teal-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-teal-700">הוסף ליד</button>
      </form>

      {leads.length === 0 ? (
        <p className="text-center text-slate-400 py-8 text-sm">אין לידים עדיין. כשמישהו ימלא טופס בדף הנחיתה — הוא יופיע כאן.</p>
      ) : (
        <div className="space-y-2">
          {leads.map((l) => (
            <div key={l.id} className="bg-white rounded-2xl border border-slate-200 p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-800 text-sm">{l.name || "ללא שם"}</div>
                  <div className="text-xs text-slate-500" dir="ltr" style={{ textAlign: "right" }}>{l.phone}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {l.source === "landing" ? "מהאתר" : "ידני"} · {fmtDate(l.createdAt)}
                  </div>
                </div>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${LEAD_STATUS[l.status]?.cls || ""}`}>
                  {LEAD_STATUS[l.status]?.label || l.status}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                <a href={waLink(l.phone, `היי ${l.name || ""}, מדבר יאיר מ-DOMINANT 👋 ראיתי שהתעניינת במערכת`)} target="_blank" rel="noreferrer"
                  className="bg-emerald-50 text-emerald-700 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-emerald-100">💬 וואטסאפ</a>
                <select value={l.status} onChange={(e) => setStatus(l.id, e.target.value)}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                  {Object.entries(LEAD_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <button onClick={() => del(l.id)} className="text-red-400 hover:text-red-600 text-xs px-2 py-1.5">מחק</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Businesses ───────────────────────────────────────────────────────────────
function Businesses({ businesses, reload }: { businesses: Biz[]; reload: () => void }) {
  return (
    <div className="space-y-2.5">
      {businesses.map((b) => <BizCard key={b.id} b={b} reload={reload} />)}
    </div>
  );
}

function BizCard({ b, reload }: { b: Biz; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [monthly, setMonthly] = useState(String(b.monthlyPrice ?? ""));
  const [setup, setSetup] = useState(String(b.setupFee ?? ""));
  const [tier, setTier] = useState(b.tier);
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/admin/super/businesses/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false); setEditing(false); reload();
  }
  async function impersonate() {
    const res = await fetch("/api/admin/super/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: b.id }) });
    if (res.ok) window.location.href = "/admin";
  }
  async function del() {
    if (!confirm(`למחוק לצמיתות את "${b.name}"? (רק עסק ריק)`)) return;
    const res = await fetch(`/api/admin/super/businesses/${b.id}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json()).error || "מחיקה נכשלה");
    reload();
  }

  const badge = b.suspended ? { t: "מושהה", c: "bg-red-100 text-red-700" }
    : b.paying ? { t: "משלם", c: "bg-emerald-100 text-emerald-700" }
    : b.trialActive ? { t: `טריאל · ${b.trialDaysLeft}י׳`, c: "bg-amber-100 text-amber-700" }
    : { t: "טריאל נגמר", c: "bg-slate-100 text-slate-500" };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">{b.name}</span>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.c}`}>{badge.t}</span>
            {b.tier === "premium" && <span className="text-[11px] text-amber-600">★ פרימיום</span>}
          </div>
          <div className="text-xs text-slate-500 mt-0.5" dir="ltr" style={{ textAlign: "right" }}>{b.ownerPhone || "—"}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            {b.staffCount} ספרים · {b.customerCount} לקוחות · {b.apptCount} תורים · פעילות אחרונה {fmtDate(b.lastActivityAt)}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {b.monthlyPrice ? `${NIS}${b.monthlyPrice}/חודש` : "ללא מחיר"}{b.setupFee ? ` · הטמעה ${NIS}${b.setupFee}` : ""}
          </div>
        </div>
        {!b.activated && <span className="text-[10px] text-amber-500 whitespace-nowrap">לא הפעיל</span>}
      </div>

      {editing ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 bg-slate-50 rounded-xl p-3">
          <label className="text-xs text-slate-500">
            חודשי {NIS}
            <input value={monthly} onChange={(e) => setMonthly(e.target.value)} type="number" className="block w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            הטמעה {NIS}
            <input value={setup} onChange={(e) => setSetup(e.target.value)} type="number" className="block w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-slate-500">
            מסלול
            <select value={tier} onChange={(e) => setTier(e.target.value)} className="block rounded-lg border border-slate-200 px-2 py-1 text-sm bg-white">
              <option value="basic">basic</option><option value="pro">pro</option><option value="premium">premium</option>
            </select>
          </label>
          <button disabled={busy} onClick={() => patch({ monthlyPrice: monthly ? Number(monthly) : null, setupFee: setup ? Number(setup) : null, tier })}
            className="bg-teal-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg">שמור</button>
          <button onClick={() => setEditing(false)} className="text-slate-400 text-xs px-2 py-1.5">ביטול</button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button onClick={() => { navigator.clipboard?.writeText(window.location.origin + b.publicPath); alert("הקישור הועתק:\n" + window.location.origin + b.publicPath); }} className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200">🔗 קישור לקוחות{b.isRoot ? " (ראשי)" : ""}</button>
          <button onClick={() => setEditing(true)} className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200">💰 מחיר/מסלול</button>
          {b.paying
            ? <button onClick={() => patch({ markPaid: false })} className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200">בטל תשלום</button>
            : <button onClick={() => patch({ markPaid: true })} className="text-xs bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-100">✓ סמן כמשלם</button>}
          <button onClick={() => patch({ extendTrialDays: 14 })} className="text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-100">+14 ימי טריאל</button>
          {b.suspended
            ? <button onClick={() => patch({ suspend: false })} className="text-xs bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-emerald-100">בטל השהיה</button>
            : <button onClick={() => patch({ suspend: true })} className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-100">השהה</button>}
          <button onClick={impersonate} className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-100">🔑 היכנס כמנהל</button>
          {!b.activated && <button onClick={del} className="text-xs text-red-400 px-2 py-1.5 hover:text-red-600">מחק</button>}
        </div>
      )}
    </div>
  );
}
