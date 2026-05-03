"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
type SourceRow = {
  source: string;
  total: number;
  regulars: number;
  regularsPct: number;
};

type StaffItem = { id: string; name: string };

type InsightsData = {
  rows: SourceRow[];
  totalCustomers: number;
  totalRegulars: number;
  regularsPct: number;
  staffList: StaffItem[];
  periodLabel: string;
};

type Period  = "all" | "month" | "custom";
type SortKey = "total" | "regulars" | "regularsPct" | "source";
type SortDir = "asc" | "desc";

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function MarketingInsightsPage() {
  const [data,    setData]    = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  // Filters
  const [period,   setPeriod]   = useState<Period>("all");
  const [fromDate, setFromDate] = useState(firstOfMonthISO());
  const [toDate,   setToDate]   = useState(todayISO());
  const [staffId,  setStaffId]  = useState<string>("");

  // Table sort
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchData = useCallback(() => {
    setLoading(true);
    setError(false);

    const params = new URLSearchParams({ period });
    if (period === "custom") {
      params.set("from", fromDate);
      params.set("to",   toDate);
    }
    if (staffId) params.set("staffId", staffId);

    fetch(`/api/admin/analytics/insights?${params}`)
      .then(r => r.json())
      .then((d: InsightsData) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [period, fromDate, toDate, staffId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Sorted rows ──────────────────────────────────────────────────────────
  const sortedRows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "source")      cmp = a.source.localeCompare(b.source, "he");
      else if (sortKey === "total")  cmp = a.total      - b.total;
      else if (sortKey === "regulars") cmp = a.regulars  - b.regulars;
      else if (sortKey === "regularsPct") cmp = a.regularsPct - b.regularsPct;
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sortIcon = (key: SortKey) =>
    sortKey !== key ? "↕" : sortDir === "desc" ? "↓" : "↑";

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="p-6 overflow-auto h-full space-y-6 max-w-4xl" dir="rtl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">📣 שיווק מעמיק</h1>
          <p className="text-neutral-500 text-sm">
            מאיפה מגיעים הלקוחות? כמה הופכים לקבועים?
          </p>
        </div>
        <Link
          href="/admin/dashboard"
          className="text-sm text-slate-700 hover:text-slate-900 transition px-4 py-1.5 rounded-full border border-neutral-200 bg-white hover:border-slate-400"
        >
          ← חזרה לדשבורד
        </Link>
      </div>

      {/* ── Filters ── */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-4">
        {/* Period tabs */}
        <div>
          <p className="text-xs text-neutral-500 mb-2 font-medium">תקופה</p>
          <div className="flex flex-wrap gap-2">
            {(["all", "month", "custom"] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                  period === p
                    ? "bg-slate-900 border-slate-900 text-white"
                    : "bg-white border-neutral-200 text-neutral-600 hover:border-slate-400"
                }`}
              >
                {p === "all" ? "כל הזמנים" : p === "month" ? "החודש הנוכחי" : "תקופה מותאמת"}
              </button>
            ))}
          </div>
        </div>

        {/* Custom date pickers */}
        {period === "custom" && (
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-500">מ-</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 bg-white text-neutral-800"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-500">עד</label>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="text-sm border border-neutral-200 rounded-lg px-3 py-1.5 bg-white text-neutral-800"
              />
            </div>
          </div>
        )}

        {/* Barber filter — shown only when staff list available */}
        {data && data.staffList.length > 0 && (
          <div>
            <p className="text-xs text-neutral-500 mb-2 font-medium">סינון לפי ספר</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setStaffId("")}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                  !staffId
                    ? "bg-teal-600 border-teal-600 text-white"
                    : "bg-white border-neutral-200 text-neutral-600 hover:border-slate-300"
                }`}
              >
                כל הספרים
              </button>
              {data.staffList.map(s => (
                <button
                  key={s.id}
                  onClick={() => setStaffId(prev => prev === s.id ? "" : s.id)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                    staffId === s.id
                      ? "bg-teal-600 border-teal-600 text-white"
                      : "bg-white border-neutral-200 text-neutral-600 hover:border-slate-300"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="text-center py-20 text-neutral-400">טוען נתונים...</div>
      ) : error ? (
        <div className="text-center py-20 text-red-400 text-sm">שגיאה בטעינת הנתונים</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-12 text-center text-sm text-neutral-400">
          לא נמצאו לקוחות בתקופה הנבחרת
        </div>
      ) : (
        <>
          {/* ── Summary cards ── */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryCard label="לקוחות בתקופה" value={data.totalCustomers} sub={data.periodLabel} />
            <SummaryCard label="לקוחות קבועים" value={data.totalRegulars} sub={`3+ ביקורים`} accent="text-emerald-600" />
            <SummaryCard label="% קבועים" value={`${data.regularsPct}%`} sub="מתוך כלל הלקוחות" accent={data.regularsPct >= 40 ? "text-emerald-600" : data.regularsPct >= 20 ? "text-amber-600" : "text-neutral-900"} />
          </div>

          {/* ── Table ── */}
          <section>
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-neutral-800">מקורות הגעה</h2>
              <p className="text-xs text-neutral-400">לחץ על כותרת עמודה למיון</p>
            </div>
            <div className="bg-white rounded-2xl border border-neutral-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    <SortTh label="מקור הגעה"    sortKey="source"      current={sortKey} dir={sortDir} onClick={toggleSort} icon={sortIcon("source")}      align="right" />
                    <SortTh label="לקוחות"        sortKey="total"       current={sortKey} dir={sortDir} onClick={toggleSort} icon={sortIcon("total")}       align="center" />
                    <SortTh label="קבועים (+3)"   sortKey="regulars"    current={sortKey} dir={sortDir} onClick={toggleSort} icon={sortIcon("regulars")}    align="center" />
                    <SortTh label="% קבועים"      sortKey="regularsPct" current={sortKey} dir={sortDir} onClick={toggleSort} icon={sortIcon("regularsPct")} align="center" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {sortedRows.map(row => (
                    <tr key={row.source} className="hover:bg-neutral-50 transition">
                      <td className="px-4 py-3 font-medium text-neutral-800">{row.source}</td>
                      <td className="px-4 py-3 text-center text-neutral-700 font-semibold">{row.total}</td>
                      <td className="px-4 py-3 text-center font-semibold text-emerald-600">{row.regulars}</td>
                      <td className="px-4 py-3 text-center">
                        <RegularsBadge pct={row.regularsPct} total={row.total} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals row */}
                <tfoot className="bg-neutral-50 border-t-2 border-neutral-200">
                  <tr>
                    <td className="px-4 py-3 font-bold text-neutral-700">סה״כ</td>
                    <td className="px-4 py-3 text-center font-bold text-neutral-800">{data.totalCustomers}</td>
                    <td className="px-4 py-3 text-center font-bold text-emerald-600">{data.totalRegulars}</td>
                    <td className="px-4 py-3 text-center">
                      <RegularsBadge pct={data.regularsPct} total={data.totalCustomers} bold />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Legend */}
            <p className="text-xs text-neutral-400 mt-2 text-left">
              * &quot;ישיר / לא ידוע&quot; — לקוחות ללא מקור הגעה רשום
              {staffId && data.staffList.find(s => s.id === staffId) &&
                ` · מוצג: ${data.staffList.find(s => s.id === staffId)!.name} בלבד`}
            </p>
          </section>
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5">
      <p className="text-xs text-neutral-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold ${accent ?? "text-neutral-900"}`}>{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-1">{sub}</p>}
    </div>
  );
}

function SortTh({ label, sortKey, current, dir, onClick, icon, align }: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  icon: string;
  align: "right" | "center";
}) {
  const active = current === sortKey;
  return (
    <th
      className={`px-4 py-2.5 text-xs font-medium text-neutral-500 cursor-pointer select-none hover:text-neutral-800 transition text-${align} whitespace-nowrap`}
      onClick={() => onClick(sortKey)}
    >
      <span className={active ? "text-slate-900 font-semibold" : ""}>{label}</span>
      {" "}
      <span className={`text-[10px] ${active ? "text-slate-700" : "text-neutral-300"}`}>{icon}</span>
    </th>
  );
}

function RegularsBadge({ pct, total, bold }: { pct: number; total: number; bold?: boolean }) {
  if (total === 0) return <span className="text-neutral-300">—</span>;
  const color = pct >= 40 ? "text-emerald-600" : pct >= 20 ? "text-amber-600" : "text-neutral-500";
  return (
    <span className={`${color} ${bold ? "font-bold text-base" : "font-semibold"}`}>
      {pct}%
    </span>
  );
}
