"use client";
import { useEffect, useState } from "react";

/**
 * "חופשה": mark a whole date range as not working for one barber, in one go
 * (one StaffScheduleOverride per day). Shows how many live appointments fall
 * inside the range so the barber can deal with them on the calendar — we do
 * NOT cancel or move anything automatically here.
 */
export default function VacationRange({ staffId }: { staffId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [affected, setAffected] = useState<{ id: string; date: string; startTime: string; customerName: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const days = (() => {
    const out: string[] = [];
    if (!from || !to || from > to) return out;
    const d = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    while (d <= end && out.length < 60) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    return out;
  })();

  // Live appointments inside the range — one request per day, cheap (≤60).
  useEffect(() => {
    if (!days.length) { setAffected([]); return; }
    let alive = true;
    Promise.all(days.map(d => fetch(`/api/admin/appointments?date=${d}&staffId=${staffId}`).then(r => (r.ok ? r.json() : [])).catch(() => [])))
      .then(lists => {
        if (!alive) return;
        const rows = (lists.flat() as Array<{ id: string; date: string; startTime: string; status: string; staffId: string; customer: { name: string } }>)
          .filter(a => a.staffId === staffId && (a.status === "pending" || a.status === "confirmed"))
          .map(a => ({ id: a.id, date: String(a.date).slice(0, 10), startTime: a.startTime, customerName: a.customer?.name || "" }));
        setAffected(rows);
      });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, staffId]);

  async function apply() {
    if (!days.length) return;
    setBusy(true); setErr(null); setDone(null);
    try {
      for (const d of days) {
        const r = await fetch(`/api/admin/staff/${staffId}/schedule/override`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: d, isWorking: false, reason: "חופשה", notifyWaitlist: false }),
        });
        if (!r.ok) throw new Error("override failed");
      }
      setDone(`${days.length} ימים סומנו כחופשה`);
    } catch { setErr("לא הצלחתי לסמן את כל הימים — נסה שוב"); }
    setBusy(false);
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5">
      <h2 className="font-semibold text-neutral-800 mb-1">🏖️ חופשה / ימים סגורים</h2>
      <p className="text-xs text-neutral-400 mb-3">טווח תאריכים שבו לא עובדים — במקום לסמן יום-יום ביומן. תורים שכבר קיימים בטווח לא מתבטלים לבד; הם מוצגים כאן כדי שתטפל בהם ביומן.</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-neutral-500 block mb-1">מתאריך</label>
          <input type="date" value={from} min={today} onChange={e => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} dir="ltr"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block mb-1">עד תאריך</label>
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} dir="ltr"
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      {days.length > 0 && (
        <p className="text-xs text-neutral-600 mb-2">
          {days.length} ימים ·{" "}
          {affected === null ? "בודק תורים…" : affected.length === 0 ? "אין תורים בטווח ✓" : (
            <span className="text-amber-700 font-medium">{affected.length} תורים קיימים בטווח</span>
          )}
        </p>
      )}
      {affected && affected.length > 0 && (
        <ul className="mb-3 max-h-36 overflow-y-auto space-y-1">
          {affected.map(a => (
            <li key={a.id} className="text-xs flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
              <span className="text-neutral-800">{a.customerName}</span>
              <a href={`/admin?date=${a.date}`} className="text-amber-800 underline underline-offset-2" dir="ltr">{a.date.slice(8, 10)}/{a.date.slice(5, 7)} {a.startTime}</a>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <button onClick={apply} disabled={busy || !days.length}
          className="px-4 py-2 rounded-xl text-sm font-semibold bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50">
          {busy ? "מסמן…" : "סמן כחופשה"}
        </button>
        {done && <span className="text-xs text-emerald-600">✓ {done}</span>}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}
