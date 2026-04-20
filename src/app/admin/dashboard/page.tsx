"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Appt = {
  id: string; startTime: string; endTime: string; status: string; price: number;
  customer: { name: string; phone: string };
  staff: { name: string };
  service: { name: string };
};

const todayISO = () => new Date().toISOString().split("T")[0];
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; };

const STATUS = {
  confirmed: { label: "מאושר", color: "bg-emerald-100 text-emerald-700" },
  pending:   { label: "ממתין",  color: "bg-amber-100 text-amber-700" },
  completed: { label: "הושלם", color: "bg-blue-100 text-blue-700" },
  cancelled_by_customer: { label: "בוטל", color: "bg-red-100 text-red-500" },
  cancelled_by_staff:    { label: "בוטל", color: "bg-red-100 text-red-500" },
  no_show: { label: "לא הגיע", color: "bg-neutral-100 text-neutral-500" },
} as Record<string, { label: string; color: string }>;

export default function Dashboard() {
  const [date, setDate] = useState(todayISO());
  const [appointments, setAppointments] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/appointments?date=${date}`).then(r => r.json()).then(d => { setAppointments(d); setLoading(false); });
  }, [date]);

  const confirmed = appointments.filter(a => ["confirmed", "pending"].includes(a.status));
  const completed = appointments.filter(a => a.status === "completed");
  const cancelled = appointments.filter(a => a.status.startsWith("cancelled") || a.status === "no_show");
  const revenue = completed.reduce((s, a) => s + a.price, 0);

  const isToday = date === todayISO();
  const label = isToday ? "היום" : new Date(date).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="p-8 overflow-auto h-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">דאשבורד</h1>
          <p className="text-neutral-500 text-sm mt-1">סקירה יומית</p>
        </div>
        <div className="flex items-center gap-2 bg-white rounded-xl border border-neutral-200 px-4 py-2">
          <button onClick={() => setDate(addDays(date, -1))} className="text-neutral-400 hover:text-neutral-700 px-1">◀</button>
          <span className="font-semibold text-neutral-800 min-w-36 text-center text-sm">{label}</span>
          <button onClick={() => setDate(addDays(date, 1))} className="text-neutral-400 hover:text-neutral-700 px-1">▶</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {[
          { label: "תורים פעילים", val: confirmed.length, color: "text-neutral-900" },
          { label: "הושלמו", val: completed.length, color: "text-emerald-600" },
          { label: "בוטלו", val: cancelled.length, color: "text-red-500" },
          { label: "הכנסה ₪", val: revenue.toLocaleString("he-IL"), color: "text-amber-600" },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-neutral-200 p-5">
            <p className="text-xs text-neutral-500 mb-1">{label}</p>
            <p className={`text-3xl font-bold ${color}`}>{val}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between">
          <h2 className="font-semibold text-neutral-800">תורים – {label}</h2>
          <Link href="/admin" className="text-sm text-amber-600 hover:underline">פתח יומן ←</Link>
        </div>
        {loading ? (
          <div className="text-center py-12 text-neutral-400">טוען...</div>
        ) : appointments.length === 0 ? (
          <div className="text-center py-12 text-neutral-400">אין תורים ביום זה</div>
        ) : (
          <div className="divide-y divide-neutral-50">
            {appointments.map(a => {
              const s = STATUS[a.status] || { label: a.status, color: "bg-neutral-100 text-neutral-500" };
              return (
                <div key={a.id} className="px-6 py-4 flex items-center gap-4">
                  <span className="text-sm font-mono text-neutral-400 w-20 shrink-0">{a.startTime}–{a.endTime}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-neutral-900">{a.customer.name}</p>
                    <p className="text-xs text-neutral-500">{a.service.name} · {a.staff.name}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${s.color}`}>{s.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
