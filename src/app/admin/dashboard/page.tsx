"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

type SourceRow = { source: string; new: number; returned: number };

type Analytics = {
  totalRevenue:         number;
  totalAppointments:    number;
  newCustomers:         number;          // legacy alias
  newToBusiness:        number;
  newToStaff:           number;
  // Today metrics
  todayAppointments:    number;
  todayRevenue:         number;
  todayNewToBusiness:   number;
  bookingsCreatedToday: number;
  occupancyToday:       number;
  occupancyMonth:       number;
  dailyRevenue:         { date: string; revenue: number; count: number }[];
  newBySource:          SourceRow[];
  prevMonthCohort: {
    newInPrevMonth:    number;
    returnedThisMonth: number;
    rate:              number;
  };
  activityBreakdown: {
    total:    number;
    oneTime:  number;
    active:   number;
    regulars: number;
  };
  returnRate: {
    windowDays:  number;
    cohortSize:  number;
    returned:    number;
    rate:        number;
  };
  staffSummary: {
    staffId:           string;
    name:              string;
    revenue:           number;
    appointments:      number;
    newToStaff:        number;
    newAlsoToBusiness: number;
    secondVisit:       number;
  }[];
};

type Me    = { isOwner: boolean; staffId: string | null; staff: { id: string; name: string; role: string } | null };
type Staff = { id: string; name: string };

// ── Helpers ───────────────────────────────────────────────────────────────────
function monthRange(year: number, month: number) {
  const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to, label: `${MONTHS_HE[month]} ${year}` };
}

// ── StatCard ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = "text-neutral-900", badge }: {
  label: string; value: string | number; sub?: string; color?: string; badge?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5 flex flex-col justify-between min-h-[110px]">
      <div className="flex items-start justify-between">
        <p className="text-xs text-neutral-500">{label}</p>
        {badge && <span className="text-[10px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded-full">{badge}</span>}
      </div>
      <p className={`text-3xl font-bold mt-2 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── MiniStat (for the "Today" strip — more compact) ──────────────────────────
function MiniStat({ icon, label, value, sub, accent }: {
  icon: string; label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-neutral-200 px-4 py-3 flex items-center gap-3 min-w-0">
      <div className={`text-2xl shrink-0 ${accent ?? ""}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] text-neutral-500 uppercase tracking-wider truncate">{label}</p>
        <p className="text-lg font-bold text-neutral-900 leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-neutral-400 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ── HBarChart ─────────────────────────────────────────────────────────────────
function HBarChart({ data }: { data: SourceRow[] }) {
  if (!data.length) return <p className="text-sm text-neutral-400 text-center py-6">אין נתונים</p>;
  const maxVal = Math.max(...data.map(d => d.new + d.returned), 1);
  return (
    <div className="space-y-3">
      {data.map(row => {
        const total  = row.new + row.returned;
        const newPct = maxVal > 0 ? (row.new      / maxVal) * 100 : 0;
        const retPct = maxVal > 0 ? (row.returned / maxVal) * 100 : 0;
        return (
          <div key={row.source}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-neutral-700 font-medium">{row.source}</span>
              <span className="text-neutral-500 text-xs">{total}</span>
            </div>
            <div className="h-2.5 bg-neutral-100 rounded-full overflow-hidden flex">
              <div className="h-full bg-slate-700 transition-all" style={{ width: `${newPct}%` }} />
              <div className="h-full bg-emerald-400 transition-all" style={{ width: `${retPct}%` }} />
            </div>
          </div>
        );
      })}
      <div className="flex gap-4 mt-3 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-full bg-slate-700" />חדשים</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-full bg-emerald-400" />חוזרים</span>
      </div>
    </div>
  );
}

// ── SourceTable ───────────────────────────────────────────────────────────────
function SourceTable({ data }: { data: SourceRow[] }) {
  if (!data.length) return <p className="text-sm text-neutral-400 text-center py-6">אין נתונים</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-neutral-200">
          <th className="text-right pb-2 text-xs text-neutral-500 font-medium">מקור הגעה</th>
          <th className="text-center pb-2 text-xs text-neutral-500 font-medium">חדשים</th>
          <th className="text-center pb-2 text-xs text-neutral-500 font-medium">חוזרים</th>
          <th className="text-center pb-2 text-xs text-neutral-500 font-medium">אחוז חזרה</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {data.map(row => {
          const rate = row.new > 0 ? Math.round((row.returned / row.new) * 100) : 0;
          return (
            <tr key={row.source}>
              <td className="py-2.5 text-neutral-700 font-medium">{row.source}</td>
              <td className="py-2.5 text-center font-semibold text-neutral-800">{row.new}</td>
              <td className="py-2.5 text-center font-semibold text-emerald-600">{row.returned}</td>
              <td className="py-2.5 text-center">
                {row.new > 0 ? (
                  <span className={`font-bold ${rate >= 40 ? "text-emerald-600" : rate >= 20 ? "text-slate-800" : "text-neutral-400"}`}>
                    {rate}%
                  </span>
                ) : <span className="text-neutral-300">—</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── RevenueChart ──────────────────────────────────────────────────────────────
function RevenueChart({ data, todayISO }: { data: { date: string; revenue: number; count: number }[]; todayISO: string }) {
  const maxRev = Math.max(...data.map(d => d.revenue), 1);
  return (
    <div className="flex items-end gap-0.5 h-20">
      {data.map(d => {
        const pct     = (d.revenue / maxRev) * 100;
        const isToday = d.date === todayISO;
        const dayNum  = parseInt(d.date.split("-")[2], 10);
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div className="absolute -top-11 bg-neutral-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10 text-center">
              <div>{d.date.slice(5)}</div>
              <div>₪{d.revenue.toLocaleString("he-IL")}</div>
              <div>{d.count} תורים</div>
            </div>
            <div
              className={`w-full rounded-t transition-all ${isToday ? "bg-teal-600" : "bg-slate-200 group-hover:bg-slate-700"}`}
              style={{ height: `${Math.max(pct, 2)}%` }}
            />
            {(dayNum % 5 === 0 || dayNum === 1) && (
              <span className={`text-[8px] ${isToday ? "text-slate-800 font-bold" : "text-neutral-400"}`}>{dayNum}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── ReturnRateCard ────────────────────────────────────────────────────────────
function ReturnRateCard({ returnRate, windowDays, onWindowChange }: {
  returnRate: Analytics["returnRate"];
  windowDays: number;
  onWindowChange: (d: number) => void;
}) {
  const pct = returnRate.rate;
  const WINDOWS = [
    { label: "30 יום",   days: 30  },
    { label: "90 יום",   days: 90  },
    { label: "6 חודשים", days: 180 },
    { label: "שנה",      days: 365 },
  ];
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-neutral-800 text-sm">אחוז לקוחות חוזרים</h3>
          <p className="text-xs text-neutral-400 mt-0.5">
            מלקוחות שהגיעו לראשונה ב-{returnRate.windowDays} הימים האחרונים
          </p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {WINDOWS.map(w => (
            <button key={w.days} onClick={() => onWindowChange(w.days)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition ${
                windowDays === w.days
                  ? "bg-teal-600 border-teal-600 text-white font-semibold"
                  : "border-neutral-200 text-neutral-500 hover:border-slate-300"
              }`}>
              {w.label}
            </button>
          ))}
        </div>
      </div>
      {returnRate.cohortSize === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-4">אין נתונים מספיקים עדיין</p>
      ) : (
        <>
          <div className="flex items-end gap-3 mb-3">
            <span className={`text-5xl font-black ${pct >= 40 ? "text-emerald-600" : pct >= 20 ? "text-slate-900" : "text-red-400"}`}>
              {pct}%
            </span>
            <span className="text-sm text-neutral-500 mb-1.5">
              {returnRate.returned} מתוך {returnRate.cohortSize} לקוחות חזרו
            </span>
          </div>
          <div className="h-3 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct >= 40 ? "bg-emerald-500" : pct >= 20 ? "bg-slate-700" : "bg-red-400"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-neutral-400 mt-1.5">
            <span>0%</span>
            <span className={pct >= 40 ? "text-emerald-600 font-semibold" : ""}>{pct >= 40 ? "מעולה! 🎉" : pct >= 20 ? "בסדר" : "מתחת לממוצע"}</span>
            <span>100%</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── CohortCard ────────────────────────────────────────────────────────────────
function CohortCard({ cohort }: { cohort: Analytics["prevMonthCohort"] }) {
  const pct = cohort.rate;
  if (cohort.newInPrevMonth === 0) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200 p-5">
        <h3 className="font-semibold text-neutral-800 text-sm mb-1">קוהורט חודש שעבר</h3>
        <p className="text-xs text-neutral-400 mb-4">לקוחות חדשים מחודש שעבר שחזרו החודש</p>
        <p className="text-sm text-neutral-400 text-center py-4">אין נתוני חודש קודם</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5">
      <h3 className="font-semibold text-neutral-800 text-sm mb-1">קוהורט חודש שעבר</h3>
      <p className="text-xs text-neutral-400 mb-4">לקוחות חדשים מחודש שעבר שחזרו החודש</p>
      <div className="flex items-end gap-3 mb-3">
        <span className={`text-5xl font-black ${pct >= 40 ? "text-emerald-600" : pct >= 20 ? "text-slate-900" : "text-red-400"}`}>
          {pct}%
        </span>
        <span className="text-sm text-neutral-500 mb-1.5">
          {cohort.returnedThisMonth} מתוך {cohort.newInPrevMonth} חזרו
        </span>
      </div>
      <div className="h-3 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct >= 40 ? "bg-emerald-500" : pct >= 20 ? "bg-slate-700" : "bg-red-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-neutral-400 mt-2">
        {cohort.newInPrevMonth} לקוחות חדשים הגיעו בחודש שעבר
      </p>
    </div>
  );
}

// ── ActivityBreakdownCard ─────────────────────────────────────────────────────
function ActivityBreakdownCard({ breakdown }: { breakdown: Analytics["activityBreakdown"] }) {
  const { total, oneTime, active, regulars } = breakdown;
  const rows = [
    { label: "חד-פעמיים",    count: oneTime,  color: "bg-neutral-300",  text: "text-neutral-500",   pct: total > 0 ? Math.round((oneTime  / total) * 100) : 0 },
    { label: "פעילים (2+ ביקורים)", count: active,   color: "bg-slate-700",    text: "text-slate-800",    pct: total > 0 ? Math.round((active   / total) * 100) : 0 },
    { label: "קובעים (3+ ביקורים)", count: regulars, color: "bg-emerald-500",  text: "text-emerald-600",  pct: total > 0 ? Math.round((regulars / total) * 100) : 0 },
  ];
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-neutral-800 text-sm">פעילות לקוחות — כל הזמנים</h3>
          <p className="text-xs text-neutral-400 mt-0.5">סה״כ {total} לקוחות ייחודיים</p>
        </div>
      </div>
      {total === 0 ? (
        <p className="text-sm text-neutral-400 text-center py-4">אין נתונים</p>
      ) : (
        <div className="space-y-4">
          {rows.map(row => (
            <div key={row.label}>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-neutral-700 font-medium">{row.label}</span>
                <span className={`font-bold ${row.text}`}>{row.count} <span className="font-normal text-neutral-400">({row.pct}%)</span></span>
              </div>
              <div className="h-2.5 bg-neutral-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${row.color}`} style={{ width: `${row.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BarberCard ────────────────────────────────────────────────────────────────
function BarberCard({ row, selected, onClick }: {
  row: Analytics["staffSummary"][0]; selected: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`text-right w-full rounded-2xl border p-5 transition ${
        selected ? "border-teal-600 bg-slate-50 shadow-sm" : "border-neutral-200 bg-white hover:border-slate-300"
      }`}>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 ${selected ? "bg-teal-600" : "bg-slate-400"}`}>
          {row.name[0]}
        </div>
        <div className="text-right">
          <h3 className="font-semibold text-neutral-800 text-sm">{row.name}</h3>
          <p className="text-xs text-neutral-400">לחץ לסינון</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-right">
        <div>
          <p className="text-[10px] text-neutral-400 uppercase">הכנסה</p>
          <p className="text-lg font-bold text-slate-800">₪{row.revenue.toLocaleString("he-IL")}</p>
        </div>
        <div>
          <p className="text-[10px] text-neutral-400 uppercase">תורים</p>
          <p className="text-lg font-bold text-neutral-800">{row.appointments}</p>
        </div>
        <div>
          <p className="text-[10px] text-neutral-400 uppercase">חדשים אצלו</p>
          <p className="text-lg font-bold text-teal-600">{row.newToStaff}</p>
          {row.newAlsoToBusiness > 0 && (
            <p className="text-[10px] text-emerald-600 mt-0.5">{row.newAlsoToBusiness} גם חדשים לעסק</p>
          )}
        </div>
        <div>
          <p className="text-[10px] text-neutral-400 uppercase">ביקור שני</p>
          <p className="text-lg font-bold text-emerald-600">{row.secondVisit}</p>
        </div>
      </div>
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const now      = new Date();
  const todayISO = now.toISOString().split("T")[0];

  const [viewYear,   setViewYear]   = useState(now.getFullYear());
  const [viewMonth,  setViewMonth]  = useState(now.getMonth());
  const [selStaff,   setSelStaff]   = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(90);
  const [analytics,  setAnalytics]  = useState<Analytics | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [me,         setMe]         = useState<Me | null>(null);
  const [allStaff,   setAllStaff]   = useState<Staff[]>([]);

  const { from, to, label: monthLabel } = useMemo(
    () => monthRange(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  useEffect(() => {
    fetch("/api/admin/me").then(r => r.json()).then(setMe).catch(() => {});
    fetch("/api/admin/staff").then(r => r.json()).then((d: Staff[]) => setAllStaff(d)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ from, to, returnWindowDays: String(windowDays) });
    if (selStaff) params.set("staffId", selStaff);
    fetch(`/api/admin/analytics?${params}`)
      .then(r => r.json())
      .then(d => { setAnalytics(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [from, to, selStaff, windowDays]);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();
  const isOwner = me?.isOwner ?? false;
  const isStaffScoped = !!selStaff || (!isOwner && !!me?.staffId);

  const heading = selStaff
    ? `דשבורד — ${allStaff.find(s => s.id === selStaff)?.name ?? ""}`
    : (me && !isOwner && me.staff) ? `הדשבורד שלי — ${me.staff.name}` : "דשבורד";

  const a = analytics;
  // Derive second-visit total from per-source returned counts (API no longer returns this as a scalar)
  const secondVisitCustomers = a ? a.newBySource.reduce((s, r) => s + r.returned, 0) : 0;

  return (
    <div className="p-6 overflow-auto h-full space-y-6 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{heading}</h1>
          <p className="text-neutral-500 text-sm">סטטיסטיקות חודשיות</p>
        </div>
        <div className="flex items-center gap-2 bg-white rounded-xl border border-neutral-200 px-4 py-2 text-sm">
          <button onClick={prevMonth} className="text-neutral-400 hover:text-neutral-700 px-1">◀</button>
          <span className="font-semibold text-neutral-800 min-w-[9rem] text-center">{monthLabel}</span>
          <button onClick={nextMonth} disabled={isCurrentMonth}
            className="text-neutral-400 hover:text-neutral-700 px-1 disabled:opacity-30">▶</button>
          {!isCurrentMonth && (
            <button onClick={() => { setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); }}
              className="text-xs text-slate-800 hover:underline mr-1">החודש</button>
          )}
        </div>
      </div>

      {/* ── Today strip ─────────────────────────────────────────────────────── */}
      {a && (
        <div>
          <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">⚡ היום</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <MiniStat
              icon="👥"
              label="לקוחות היום"
              value={a.todayAppointments}
              sub={a.todayNewToBusiness > 0 ? `${a.todayNewToBusiness} חדשים למספרה` : undefined}
            />
            <MiniStat
              icon="💰"
              label="מחזור היום"
              value={`₪${a.todayRevenue.toLocaleString("he-IL")}`}
            />
            <MiniStat
              icon="📈"
              label="תפוסה היום"
              value={`${a.occupancyToday}%`}
            />
            <MiniStat
              icon="📅"
              label="נקבעו ב-24 שעות"
              value={a.bookingsCreatedToday}
              sub="כל התורים שנוצרו היום"
            />
          </div>
        </div>
      )}

      {/* Barber filter chips + insights button */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {isOwner && allStaff.length > 0 ? (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setSelStaff(null)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                !selStaff ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-neutral-200 text-neutral-600 hover:border-slate-300"
              }`}>
              כל הספרים
            </button>
            {allStaff.map(s => (
              <button key={s.id} onClick={() => setSelStaff(p => p === s.id ? null : s.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                  selStaff === s.id ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-neutral-200 text-neutral-600 hover:border-slate-300"
                }`}>
                {s.name}
              </button>
            ))}
          </div>
        ) : <span />}
        <Link
          href="/admin/dashboard/insights"
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 transition"
        >
          🔍 ניתוח מעמיק
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-20 text-neutral-400">טוען נתונים...</div>
      ) : !a ? (
        <div className="text-center py-20 text-red-400 text-sm">שגיאה בטעינת הנתונים</div>
      ) : (
        <>
          {/* Stat cards (monthly) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="הכנסה חודשית"
              value={`₪${a.totalRevenue.toLocaleString("he-IL")}`}
              color="text-slate-800"
              sub={a.totalAppointments > 0 ? `ממוצע ₪${Math.round(a.totalRevenue / a.totalAppointments)} לתור` : undefined}
            />
            <StatCard label="תורים החודש" value={a.totalAppointments} color="text-neutral-900" sub={`תפוסה ${a.occupancyMonth}%`} />
            <StatCard
              label={isStaffScoped ? "חדשים לעסק" : "לקוחות חדשים"}
              value={a.newToBusiness}
              color="text-teal-600"
              sub={isStaffScoped ? `מתוכם חדשים אצלך: ${a.newToStaff}` : undefined}
              badge={isStaffScoped ? undefined : "כל המספרה"}
            />
            <StatCard label="לקוחות חוזרים" value={secondVisitCustomers} color="text-emerald-600" sub="ביקרו שוב החודש" />
          </div>

          {/* Marketing */}
          {a.newBySource.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">📣 שיווק ומקורות הגעה</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-neutral-200 p-5">
                  <h3 className="font-semibold text-neutral-800 text-sm mb-4">לקוחות לפי מקור הגעה</h3>
                  <HBarChart data={a.newBySource} />
                </div>
                <div className="bg-white rounded-2xl border border-neutral-200 p-5 overflow-x-auto">
                  <h3 className="font-semibold text-neutral-800 text-sm mb-4">חדשים vs ביקור שני לפי מקור</h3>
                  <SourceTable data={a.newBySource} />
                </div>
              </div>
            </div>
          )}

          {/* Retention */}
          <div>
            <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">🔄 שימור לקוחות</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <ReturnRateCard returnRate={a.returnRate} windowDays={windowDays} onWindowChange={setWindowDays} />

              <CohortCard cohort={a.prevMonthCohort} />
            </div>
          </div>

          {/* Activity breakdown */}
          <div>
            <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">📊 מאפייני לקוחות — כל הזמנים</h2>
            <ActivityBreakdownCard breakdown={a.activityBreakdown} />
          </div>

          {/* Revenue chart */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-neutral-800 text-sm">הכנסות יומיות — {monthLabel}</h3>
              <span className="text-xs text-neutral-400">סה״כ ₪{a.totalRevenue.toLocaleString("he-IL")}</span>
            </div>
            <RevenueChart data={a.dailyRevenue} todayISO={todayISO} />
          </div>

          {/* Per-barber grid */}
          {isOwner && !selStaff && a.staffSummary.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">✂️ לפי ספר — {monthLabel}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {a.staffSummary.map(row => (
                  <BarberCard key={row.staffId} row={row} selected={selStaff === row.staffId}
                    onClick={() => setSelStaff(p => p === row.staffId ? null : row.staffId)} />
                ))}
              </div>
              <p className="text-xs text-neutral-400 mt-2 text-center">לחץ על ספר לסינון הדשבורד כולו</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
