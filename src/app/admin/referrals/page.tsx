"use client";

import { useEffect, useState } from "react";

type Friend = { name: string; date: string };
type Row = {
  id: string;
  name: string;
  phone: string;
  count: number;
  giftsEarned: number;
  towardNext: number;
  reached: boolean;
  friends: Friend[];
};
type Data = {
  enabled: boolean;
  goal: number;
  giftLabel: string;
  totalReferrers: number;
  totalReferred: number;
  owedCount: number;
  rows: Row[];
};

function waLink(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^0/, "972");
  return `https://wa.me/${digits}`;
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
  } catch { return ""; }
}

export default function AdminReferralsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/referrals")
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-6 text-center text-slate-400 text-sm">טוען…</div>;
  }
  if (!data) {
    return <div className="p-6 text-center text-slate-400 text-sm">לא ניתן לטעון נתונים</div>;
  }

  const owed = data.rows.filter(r => r.giftsEarned > 0);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <span>🤝</span> חבר מביא חבר
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          כל <span className="font-semibold text-teal-700">{data.goal}</span> חברים שלקוח מביא — מגיע לו{" "}
          <span className="font-semibold text-teal-700">{data.giftLabel}</span>
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-2.5 mb-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 text-center">
          <div className="text-2xl font-extrabold text-slate-900">{data.totalReferrers}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">ממליצים</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-3.5 text-center">
          <div className="text-2xl font-extrabold text-slate-900">{data.totalReferred}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">חברים שהובאו</div>
        </div>
        <div className={`rounded-2xl border p-3.5 text-center ${data.owedCount > 0 ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200"}`}>
          <div className={`text-2xl font-extrabold ${data.owedCount > 0 ? "text-amber-600" : "text-slate-900"}`}>{data.owedCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">מתנות לחלוקה</div>
        </div>
      </div>

      {/* Who we owe */}
      {owed.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-amber-700 mb-2.5 flex items-center gap-1.5">
            🎁 מגיעה להם מתנה
          </h2>
          <div className="space-y-2">
            {owed.map(r => (
              <div key={r.id} className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{r.name}</div>
                  <div className="text-[12px] text-slate-500" dir="ltr">{r.phone}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] font-bold text-amber-700 bg-amber-100 rounded-full px-2.5 py-1 whitespace-nowrap">
                    {r.giftsEarned} × {data.giftLabel}
                  </span>
                  {r.phone && (
                    <a href={waLink(r.phone)} target="_blank" rel="noopener noreferrer"
                      className="text-[11px] font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-full px-3 py-1.5 whitespace-nowrap">
                      וואטסאפ
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All referrers */}
      <h2 className="text-sm font-bold text-slate-700 mb-2.5">כל הממליצים</h2>
      {data.rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          עדיין אין המלצות — ברגע שלקוח יביא חבר, הוא יופיע כאן
        </div>
      ) : (
        <div className="space-y-2">
          {data.rows.map(r => {
            const pct = Math.round((r.towardNext / Math.max(1, data.goal)) * 100);
            const isOpen = expanded === r.id;
            return (
              <div key={r.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <button onClick={() => setExpanded(isOpen ? null : r.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-right active:bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 truncate">{r.name}</span>
                      {r.reached && <span className="text-[10px]">🎁</span>}
                    </div>
                    {/* Progress toward the NEXT gift */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden max-w-[160px]">
                        <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-slate-400" dir="ltr">{r.towardNext}/{data.goal}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-center">
                    <div className="text-lg font-extrabold text-teal-700 leading-none">{r.count}</div>
                    <div className="text-[10px] text-slate-400">חברים</div>
                  </div>
                  <svg className={`w-4 h-4 text-slate-300 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3 pt-1 border-t border-slate-100">
                    <div className="text-[12px] text-slate-500 mb-1.5" dir="ltr">{r.phone}</div>
                    <ul className="space-y-1">
                      {r.friends.map((f, i) => (
                        <li key={i} className="flex items-center justify-between text-[13px]">
                          <span className="text-slate-700">{i + 1}. {f.name}</span>
                          <span className="text-slate-400 text-[11px]">{fmtDate(f.date)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
