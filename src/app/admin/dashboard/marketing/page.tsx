"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Staff = { id: string; name: string };

type ReferralRow = {
  source: string;
  total: number;
  returning: number;
  returningPct: number;
  regulars: number;
  regularPct: number;
  loyal: number;
  loyalPct: number;
};

type Period = "all" | "month" | "custom";

const PERIOD_LABELS: Record<Period, string> = {
  all:    "כל הזמנים",
  month:  "החודש",
  custom: "תקופה מותאמת",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
}

export default function MarketingDeepPage() {
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [isOwner, setIsOwner] = useState(true);
  const [myStaffId, setMyStaffId] = useState<string | null>(null);

  const [selStaff, setSelStaff]   = useState<string>("");
  const [period, setPeriod]       = useState<Period>("all");
  const [from, setFrom]           = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo]               = useState(todayISO);

  const [rows, setRows]           = useState<ReferralRow[]>([]);
  const [loading, setLoading]     = useState(false);

  // Load role + staff
  useEffect(() => {
    fetch("/api/admin/me").then(r => r.ok ? r.json() : null).then(me => {
      if (!me) return;
      setIsOwner(me.isOwner ?? true);
      if (!me.isOwner && me.staffId) {
        setMyStaffId(me.staffId);
        setSelStaff(me.staffId);
      }
    }).catch(() => {});
    fetch("/api/admin/staff").then(r => r.json()).then(setAllStaff).catch(() => {});
  }, []);

  // Fetch stats whenever filters change
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (period === "custom") { params.set("from", from); params.set("to", to); }
    if (selStaff) params.set("staffId", selStaff);
    fetch(`/api/admin/analytics/referral-stats?${params}`)
      .then(r => r.json())
      .then(data => { setRows(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [period, from, to, selStaff]);

  const totalCustomers  = rows.reduce((s, r) => s + r.total,     0);
  const totalReturning  = rows.reduce((s, r) => s + r.returning,  0);
  const totalRegulars   = rows.reduce((s, r) => s + r.regulars,   0);
  const totalLoyal      = rows.reduce((s, r) => s + r.loyal,      0);
  const returningPct    = totalCustomers > 0 ? Math.round((totalReturning / totalCustomers) * 100) : 0;
  const overallPct      = totalCustomers > 0 ? Math.round((totalRegulars  / totalCustomers) * 100) : 0;
  const loyalPct        = totalCustomers > 0 ? Math.round((totalLoyal     / totalCustomers) * 100) : 0;

  return (
    <div className="p-4 sm:p-6 overflow-auto h-full max-w-4xl space-y-5">

      {/* Back + header */}
      <div>
        <Link href="/admin/dashboard" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 mb-4 transition-colors">
          ← דשבורד
        </Link>
        <h1 className="text-2xl font-bold text-neutral-900">📊 שיווק מעמיק</h1>
        <p className="text-neutral-500 text-sm mt-1">לקוחות לפי מקור הגעה ואחוז הפיכה ללקוח קבוע (3+ ביקורים)</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">

        {/* Period */}
        <div>
          <p className="text-xs text-neutral-500 font-medium mb-2">תקופה</p>
          <div className="flex flex-wrap gap-2">
            {(["all", "month", "custom"] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${period === p ? "bg-teal-600 text-white border-teal-600" : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <div>
                <label className="text-[10px] text-neutral-400 block mb-1">מ-</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                  max={to}
                  className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </div>
              <div>
                <label className="text-[10px] text-neutral-400 block mb-1">עד</label>
                <input type="date" value={to} onChange={e => setTo(e.target.value)}
                  min={from} max={todayISO()}
                  className="border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </div>
              {from && to && (
                <span className="text-xs text-neutral-400 mt-4">{formatDate(from)} — {formatDate(to)}</span>
              )}
            </div>
          )}
        </div>

        {/* Staff filter — owner only */}
        {isOwner && allStaff.length > 0 && (
          <div>
            <p className="text-xs text-neutral-500 font-medium mb-2">ספר</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSelStaff("")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${!selStaff ? "bg-teal-600 text-white border-teal-600" : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}>
                כל הספרים
              </button>
              {allStaff.map(s => (
                <button key={s.id} onClick={() => setSelStaff(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${selStaff === s.id ? "bg-teal-600 text-white border-teal-600" : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}>
                  ✂️ {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Summary cards */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 text-center">
            <p className="text-2xl font-bold text-neutral-900">{totalCustomers.toLocaleString("he-IL")}</p>
            <p className="text-xs text-neutral-500 mt-1">סה״כ לקוחות</p>
          </div>
          <div className="bg-white rounded-2xl border border-blue-100 p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{totalReturning.toLocaleString("he-IL")}</p>
            <p className="text-xs text-neutral-500 mt-1">חזרו (2+ ביקורים)</p>
            <p className="text-xs text-blue-500 font-semibold">{returningPct}%</p>
          </div>
          <div className="bg-white rounded-2xl border border-teal-100 p-4 text-center">
            <p className="text-2xl font-bold text-teal-600">{totalRegulars.toLocaleString("he-IL")}</p>
            <p className="text-xs text-neutral-500 mt-1">קבועים (3+ ביקורים)</p>
            <p className="text-xs text-teal-500 font-semibold">{overallPct}%</p>
          </div>
          <div className="bg-white rounded-2xl border border-amber-100 p-4 text-center">
            <p className="text-2xl font-bold text-amber-600">{totalLoyal.toLocaleString("he-IL")}</p>
            <p className="text-xs text-neutral-500 mt-1">נאמנים (10+ ביקורים)</p>
            <p className="text-xs text-amber-500 font-semibold">{loyalPct}%</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
          <h2 className="font-semibold text-neutral-800 text-sm">לקוחות לפי מקור הגעה</h2>
          {!loading && rows.length > 0 && (
            <span className="text-xs text-neutral-400">{rows.length} מקורות</span>
          )}
        </div>

        {loading ? (
          <div className="py-16 text-center text-neutral-400 text-sm animate-pulse">טוען נתונים...</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-neutral-400">
            <p className="text-2xl mb-2">📭</p>
            <p className="text-sm">אין נתונים לתקופה זו</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-100">
                <tr>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">מקור הגעה</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wide">סה״כ</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-blue-500 uppercase tracking-wide">2+</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-teal-500 uppercase tracking-wide">3+</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-amber-500 uppercase tracking-wide">10+</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-neutral-400 uppercase tracking-wide">%קבועים</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {rows.map((row, i) => (
                  <tr key={row.source} className={i % 2 === 0 ? "bg-white" : "bg-neutral-50/40"}>
                    <td className="px-4 py-3 font-medium text-neutral-900 max-w-[120px] truncate">{row.source}</td>
                    <td className="px-3 py-3 text-center text-neutral-600 text-sm">{row.total.toLocaleString("he-IL")}</td>
                    <td className="px-3 py-3 text-center text-blue-700 font-semibold text-sm">
                      {row.returning.toLocaleString("he-IL")}
                      <span className="text-[10px] text-blue-400 block">{row.returningPct}%</span>
                    </td>
                    <td className="px-3 py-3 text-center text-teal-700 font-semibold text-sm">
                      {row.regulars.toLocaleString("he-IL")}
                      <span className="text-[10px] text-teal-400 block">{row.regularPct}%</span>
                    </td>
                    <td className="px-3 py-3 text-center text-amber-700 font-semibold text-sm">
                      {row.loyal.toLocaleString("he-IL")}
                      <span className="text-[10px] text-amber-400 block">{row.loyalPct}%</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 min-w-[60px]">
                        <div className="flex-1 bg-neutral-100 rounded-full h-1.5 overflow-hidden">
                          <div className="h-full bg-teal-500 rounded-full" style={{ width: `${row.regularPct}%` }} />
                        </div>
                        <span className={`text-[11px] font-bold shrink-0 ${
                          row.regularPct >= 50 ? "text-emerald-600" :
                          row.regularPct >= 25 ? "text-teal-600" :
                          row.regularPct >= 10 ? "text-amber-600" :
                          "text-neutral-400"
                        }`}>{row.regularPct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Legend */}
      <p className="text-xs text-neutral-400 text-center pb-4">
        לקוח קבוע = מי שקבע 3 תורים או יותר {selStaff ? `אצל ${allStaff.find(s => s.id === selStaff)?.name}` : "במספרה"}
        {period === "month" ? " החודש" : period === "custom" ? ` בין ${formatDate(from)} ל-${formatDate(to)}` : " (כל הזמנים)"}
      </p>
    </div>
  );
}
