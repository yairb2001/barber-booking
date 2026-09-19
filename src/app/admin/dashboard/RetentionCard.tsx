"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "לקוחות חדשים — וכמה חזרו": 30 / 60 / 90 days, counted ONLY from appointments
 * that actually happened (src/lib/analytics/retention.ts has the definitions).
 * Owner's ask, 20.9.2026: exact numbers, not Customer.createdAt.
 */
type Cust = { id: string; name: string; phone: string; firstVisit: string; secondVisit: string | null; futureBooking: string | null; visits: number };
type Win = { days: number; from: string; newCustomers: number; returned: number; rate: number; futureBooked: number; customers: Cust[] };
type Data = { asOf: string; newSince: string | null; newSinceSource: "manual" | "auto" | "none"; windows: Win[] };

function dm(iso: string): string { const d = new Date(iso + "T00:00:00Z"); return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`; }
function daysAgoISO(days: number): string {
  const todayIL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(todayIL + "T00:00:00.000Z"); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10);
}

export default function RetentionCard({ staffId, isOwner }: { staffId: string | null; isOwner: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [sinceDraft, setSinceDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const qs = staffId ? `?staffId=${encodeURIComponent(staffId)}` : "";
      const res = await fetch(`/api/admin/analytics/retention${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
    } catch { setError(true); }
  }, [staffId]);
  useEffect(() => { setData(null); load(); }, [load]);

  async function saveSince(value: string | null) {
    setSaving(true);
    try {
      await fetch("/api/admin/business", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settingsPatch: { newCustomersSince: value } }) });
      setEditing(false);
      await load();
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <div className="mb-3">
        <h2 className="text-[11px] font-semibold text-neutral-400 uppercase">🆕 לקוחות חדשים — וכמה חזרו לביקור שני</h2>
        <p className="text-[11px] text-neutral-400 mt-0.5">נספרים רק לקוחות שהתור הראשון שלהם התקיים בפועל. "חזרו" = ביקור שני שכבר התקיים.</p>
      </div>

      {error && <p className="text-sm text-red-500 text-center py-4">לא הצלחנו לטעון — <button className="underline" onClick={load}>נסה שוב</button></p>}
      {!data && !error && <p className="text-sm text-neutral-400 text-center py-6">מחשב…</p>}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {data.windows.map(w => {
              const clipped = w.from > daysAgoISO(w.days);
              const active = open === w.days;
              const tone = w.newCustomers === 0 ? "text-neutral-300" : w.rate >= 40 ? "text-emerald-600" : w.rate >= 20 ? "text-slate-800" : "text-amber-600";
              return (
                <button key={w.days} onClick={() => setOpen(active ? null : w.days)}
                  className={`rounded-xl py-3 px-2 text-center border transition ${active ? "border-teal-400 bg-teal-50/40" : "border-neutral-100 bg-neutral-50 hover:border-neutral-300"}`}>
                  <p className="text-[11px] text-neutral-500">{w.days} ימים{clipped && <span className="block text-[10px] text-amber-600">מ‑{dm(w.from)}</span>}</p>
                  <p className={`text-2xl font-extrabold mt-1 ${tone}`}>{w.newCustomers ? `${w.rate}%` : "—"}</p>
                  <p className="text-[11px] text-neutral-600 mt-1"><b>{w.returned}</b> חזרו מתוך <b>{w.newCustomers}</b></p>
                  {w.futureBooked > 0 && <p className="text-[10px] text-teal-700 mt-0.5">+{w.futureBooked} קבעו תור נוסף</p>}
                  <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden mt-2">
                    <div className={`h-full rounded-full ${w.rate >= 40 ? "bg-emerald-500" : w.rate >= 20 ? "bg-slate-600" : "bg-amber-400"}`} style={{ width: `${w.rate}%` }} />
                  </div>
                </button>
              );
            })}
          </div>

          {open !== null && (() => {
            const w = data.windows.find(x => x.days === open)!;
            return (
              <div className="mt-3 border-t border-neutral-100 pt-3">
                <p className="text-[11px] text-neutral-500 mb-2">{w.newCustomers} לקוחות חדשים מ‑{dm(w.from)} · לפי הביקור הראשון, מהחדש לישן</p>
                {w.customers.length === 0 ? <p className="text-sm text-neutral-400 text-center py-3">אין לקוחות חדשים בטווח הזה</p> : (
                  <ul className="max-h-72 overflow-y-auto divide-y divide-neutral-100">
                    {w.customers.map(c => (
                      <li key={c.id} className="flex items-center gap-2 py-1.5 text-xs">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${c.secondVisit ? "bg-emerald-500" : c.futureBooking ? "bg-teal-300" : "bg-neutral-300"}`} />
                        <span className="flex-1 truncate text-neutral-800">{c.name || c.phone}</span>
                        <span className="text-neutral-400 shrink-0">ראשון {dm(c.firstVisit)}</span>
                        <span className={`shrink-0 w-24 text-left ${c.secondVisit ? "text-emerald-700 font-medium" : c.futureBooking ? "text-teal-700" : "text-neutral-300"}`}>
                          {c.secondVisit ? `חזר ${dm(c.secondVisit)}` : c.futureBooking ? `קבע ל‑${dm(c.futureBooking)}` : "לא חזר עדיין"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}

          <div className="mt-3 pt-2 border-t border-neutral-100 text-[11px] text-neutral-500 flex flex-wrap items-center gap-x-2 gap-y-1">
            {data.newSince ? (
              <span>
                לקוחות חדשים נספרים מ‑<b className="text-neutral-700">{dm(data.newSince)}</b>
                {data.newSinceSource === "auto" ? " (אוטומטי: 6 שבועות אחרי ההשקה — עד אז הקהל הקיים נכנס למערכת ונראה כ״חדש״)" : " (נקבע ידנית)"}
              </span>
            ) : <span>אין תאריך התחלה — כל ביקור ראשון נספר כחדש.</span>}
            {isOwner && !editing && <button className="text-teal-700 underline" onClick={() => { setSinceDraft(data.newSince ?? ""); setEditing(true); }}>שנה</button>}
            {isOwner && editing && (
              <span className="flex items-center gap-1.5">
                <input type="date" value={sinceDraft} onChange={e => setSinceDraft(e.target.value)} className="border border-neutral-200 rounded-lg px-2 py-0.5 text-xs" dir="ltr" />
                <button disabled={saving || !sinceDraft} onClick={() => saveSince(sinceDraft)} className="bg-teal-600 text-white rounded-lg px-2 py-0.5 disabled:opacity-50">שמור</button>
                {data.newSinceSource === "manual" && <button disabled={saving} onClick={() => saveSince(null)} className="text-neutral-500 underline">חזור לאוטומטי</button>}
                <button disabled={saving} onClick={() => setEditing(false)} className="text-neutral-400">ביטול</button>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
