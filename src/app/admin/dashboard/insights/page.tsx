"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const DAYS_HE = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const DAYS_HE_FULL = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

type AtRiskRow = {
  customerId: string;
  name: string;
  phone: string;
  lastVisitAt: string;
  daysSince: number;
  totalVisits: number;
  preferredStaffName: string | null;
};

type HeatmapCell = { dayOfWeek: number; hour: number; count: number; pct: number };

type Insights = {
  atRisk: AtRiskRow[];
  atRiskTotal: number;
  heatmap: HeatmapCell[];
  heatmapWindowDays: number;
  heatmapMaxCount: number;
};

type SortKey = "daysSince" | "totalVisits" | "name";

export default function InsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("daysSince");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/analytics/insights")
      .then(r => r.json())
      .then((d: Insights) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const sortedAtRisk = useMemo(() => {
    if (!data) return [];
    const arr = [...data.atRisk];
    if (sortKey === "daysSince") arr.sort((a, b) => a.daysSince - b.daysSince);
    else if (sortKey === "totalVisits") arr.sort((a, b) => b.totalVisits - a.totalVisits);
    else if (sortKey === "name") arr.sort((a, b) => a.name.localeCompare(b.name, "he"));
    return arr;
  }, [data, sortKey]);

  const copyPhone = async (phone: string, custId: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(custId);
      setTimeout(() => setCopied(prev => prev === custId ? null : prev), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="p-6 overflow-auto h-full space-y-6 max-w-5xl" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">🔍 ניתוח מעמיק</h1>
          <p className="text-neutral-500 text-sm">לקוחות בסיכון + שעות שיא</p>
        </div>
        <Link
          href="/admin/dashboard"
          className="text-sm text-slate-700 hover:text-slate-900 transition px-4 py-1.5 rounded-full border border-neutral-200 bg-white hover:border-slate-400"
        >
          ← חזרה לדשבורד
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-20 text-neutral-400">טוען נתונים...</div>
      ) : !data ? (
        <div className="text-center py-20 text-red-400 text-sm">שגיאה בטעינת הנתונים</div>
      ) : (
        <>
          {/* ── At-risk customers ─────────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-semibold text-neutral-800">⚠️ לקוחות בסיכון</h2>
                <p className="text-xs text-neutral-400">לא חזרו 60+ יום — שווה לפנות אליהם ידנית</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-neutral-500">
                  סה״כ {data.atRiskTotal} בסיכון{data.atRiskTotal > data.atRisk.length ? ` (מוצגים ${data.atRisk.length} ראשונים)` : ""}
                </span>
                <select
                  value={sortKey}
                  onChange={e => setSortKey(e.target.value as SortKey)}
                  className="text-xs border border-neutral-200 rounded-lg px-2.5 py-1 bg-white text-neutral-700"
                >
                  <option value="daysSince">לפי ימים מהביקור האחרון</option>
                  <option value="totalVisits">לפי כמות ביקורים</option>
                  <option value="name">לפי שם</option>
                </select>
              </div>
            </div>

            {data.atRisk.length === 0 ? (
              <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center text-sm text-neutral-400">
                אין לקוחות בסיכון 🎉 כל הלקוחות חזרו ב-60 הימים האחרונים
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-neutral-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="text-right px-4 py-2.5 text-xs text-neutral-500 font-medium">שם</th>
                      <th className="text-right px-4 py-2.5 text-xs text-neutral-500 font-medium">טלפון</th>
                      <th className="text-center px-4 py-2.5 text-xs text-neutral-500 font-medium">ימים מאז</th>
                      <th className="text-center px-4 py-2.5 text-xs text-neutral-500 font-medium">סה״כ ביקורים</th>
                      <th className="text-right px-4 py-2.5 text-xs text-neutral-500 font-medium">ספר מועדף</th>
                      <th className="text-center px-4 py-2.5 text-xs text-neutral-500 font-medium">פעולה</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {sortedAtRisk.map(row => {
                      const dangerColor =
                        row.daysSince >= 180 ? "text-red-600 font-bold" :
                        row.daysSince >= 90  ? "text-orange-600 font-semibold" :
                                                "text-amber-600";
                      return (
                        <tr key={row.customerId} className="hover:bg-neutral-50">
                          <td className="px-4 py-2.5 font-medium text-neutral-800">{row.name}</td>
                          <td className="px-4 py-2.5 text-neutral-600 font-mono text-xs">{row.phone}</td>
                          <td className={`px-4 py-2.5 text-center ${dangerColor}`}>{row.daysSince} ימים</td>
                          <td className="px-4 py-2.5 text-center text-neutral-700">{row.totalVisits}</td>
                          <td className="px-4 py-2.5 text-neutral-500 text-xs">{row.preferredStaffName ?? "—"}</td>
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={() => copyPhone(row.phone, row.customerId)}
                              className={`text-xs px-3 py-1 rounded-lg border transition ${
                                copied === row.customerId
                                  ? "bg-emerald-100 border-emerald-300 text-emerald-700"
                                  : "bg-white border-neutral-200 text-neutral-600 hover:border-slate-400 hover:text-slate-800"
                              }`}
                            >
                              {copied === row.customerId ? "✓ הועתק" : "📋 העתק"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Heatmap ───────────────────────────────────────────────────── */}
          <section>
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-neutral-800">🔥 שעות שיא — {data.heatmapWindowDays} ימים אחרונים</h2>
              <p className="text-xs text-neutral-400">
                כמה תורים נקבעו בכל יום בשבוע × שעה. צבע כהה יותר = יותר עומס
              </p>
            </div>
            <OccupancyHeatmap heatmap={data.heatmap} maxCount={data.heatmapMaxCount} />
          </section>
        </>
      )}
    </div>
  );
}

// ── Heatmap ─────────────────────────────────────────────────────────────────
function OccupancyHeatmap({ heatmap, maxCount }: { heatmap: HeatmapCell[]; maxCount: number }) {
  const hours = Array.from(new Set(heatmap.map(h => h.hour))).sort((a, b) => a - b);

  // Lookup
  const cellByKey = new Map<string, HeatmapCell>();
  heatmap.forEach(h => cellByKey.set(`${h.dayOfWeek}-${h.hour}`, h));

  const colorFor = (pct: number) => {
    if (pct === 0) return "bg-neutral-50";
    if (pct < 25) return "bg-teal-100";
    if (pct < 50) return "bg-teal-300";
    if (pct < 75) return "bg-teal-500";
    return "bg-teal-700";
  };
  const textFor = (pct: number) => pct >= 50 ? "text-white" : "text-neutral-700";

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5 overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-xs min-w-[640px]">
        <thead>
          <tr>
            <th className="w-12 text-neutral-400 font-normal text-[10px]"></th>
            {hours.map(h => (
              <th key={h} className="text-neutral-400 font-normal text-[10px]">{h}:00</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS_HE.map((day, dayIdx) => (
            <tr key={dayIdx}>
              <td className="text-neutral-500 font-medium text-center pr-2" title={DAYS_HE_FULL[dayIdx]}>{day}</td>
              {hours.map(hour => {
                const cell = cellByKey.get(`${dayIdx}-${hour}`);
                const pct = cell?.pct ?? 0;
                const count = cell?.count ?? 0;
                return (
                  <td
                    key={hour}
                    className={`relative h-9 rounded ${colorFor(pct)} group transition`}
                    title={`${DAYS_HE_FULL[dayIdx]} ${hour}:00 — ${count} תורים`}
                  >
                    {count > 0 && (
                      <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-semibold ${textFor(pct)}`}>
                        {count}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-end gap-2 mt-4 text-[10px] text-neutral-500">
        <span>פחות</span>
        <div className="flex gap-0.5">
          <div className="w-4 h-4 rounded bg-neutral-50 border border-neutral-200" />
          <div className="w-4 h-4 rounded bg-teal-100" />
          <div className="w-4 h-4 rounded bg-teal-300" />
          <div className="w-4 h-4 rounded bg-teal-500" />
          <div className="w-4 h-4 rounded bg-teal-700" />
        </div>
        <span>יותר</span>
        <span className="text-neutral-400 mr-2">(מקסימום {maxCount} תורים)</span>
      </div>
    </div>
  );
}
