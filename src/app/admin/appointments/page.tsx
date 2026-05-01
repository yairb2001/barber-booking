"use client";

import { useEffect, useState } from "react";

type Appointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  price: number;
  note: string | null;
  staffNote: string | null;
  customer: { name: string; phone: string };
  staff: { name: string };
  service: { name: string; durationMinutes: number };
};

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

const STATUS_OPTIONS = [
  { value: "confirmed", label: "מאושר", color: "bg-emerald-100 text-emerald-700" },
  { value: "pending", label: "ממתין", color: "bg-slate-100 text-slate-700" },
  { value: "completed", label: "הושלם", color: "bg-blue-100 text-blue-700" },
  { value: "cancelled_by_staff", label: "בוטל", color: "bg-red-100 text-red-500" },
  { value: "no_show", label: "לא הגיע", color: "bg-neutral-100 text-neutral-500" },
];

export default function AdminAppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayISO());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const data = await fetch(`/api/admin/appointments?date=${date}`).then((r) => r.json());
    setAppointments(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [date]);

  function changeDate(dir: -1 | 1) {
    const d = new Date(date);
    d.setDate(d.getDate() + dir);
    setDate(d.toISOString().split("T")[0]);
  }

  async function updateStatus(id: string, status: string) {
    setUpdatingId(id);
    await fetch(`/api/admin/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setUpdatingId(null);
    load();
  }

  const isToday = date === todayISO();
  const dateLabel = new Date(date).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const getStatus = (val: string) =>
    STATUS_OPTIONS.find((s) => s.value === val) ?? { label: val, color: "bg-neutral-100 text-neutral-500" };

  return (
    <div className="p-8 overflow-auto h-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">תורים</h1>
          <p className="text-neutral-500 text-sm mt-1">{appointments.length} תורים</p>
        </div>
        <div className="flex items-center gap-2">
          {!isToday && (
            <button
              onClick={() => setDate(todayISO())}
              className="text-sm text-slate-800 hover:underline ml-2"
            >
              היום
            </button>
          )}
          <div className="flex items-center gap-2 bg-white rounded-xl border border-neutral-200 px-4 py-2">
            <button onClick={() => changeDate(-1)} className="text-neutral-400 hover:text-neutral-700 px-1">◀</button>
            <span className="font-semibold text-neutral-800 min-w-48 text-center text-sm">{dateLabel}</span>
            <button onClick={() => changeDate(1)} className="text-neutral-400 hover:text-neutral-700 px-1">▶</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-400">טוען...</div>
      ) : appointments.length === 0 ? (
        <div className="text-center py-16 text-neutral-400 bg-white rounded-2xl border border-neutral-200">
          אין תורים ביום זה
        </div>
      ) : (
        <div className="space-y-2">
          {appointments.map((appt) => {
            const s = getStatus(appt.status);
            const isExpanded = expandedId === appt.id;
            return (
              <div
                key={appt.id}
                className="bg-white rounded-2xl border border-neutral-200 overflow-hidden"
              >
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-neutral-50"
                  onClick={() => setExpandedId(isExpanded ? null : appt.id)}
                >
                  <div className="text-sm font-mono text-neutral-400 w-24 shrink-0">
                    {appt.startTime}–{appt.endTime}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-neutral-900">{appt.customer.name}</div>
                    <div className="text-xs text-neutral-500" dir="ltr">{appt.customer.phone}</div>
                  </div>
                  <div className="text-sm text-neutral-600 hidden sm:block">
                    {appt.service.name} · {appt.staff.name}
                  </div>
                  <div className="text-sm font-semibold text-neutral-700">₪{appt.price}</div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${s.color}`}>
                    {s.label}
                  </span>
                  <span className="text-neutral-300">{isExpanded ? "▲" : "▼"}</span>
                </div>

                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-neutral-100 pt-4">
                    <div className="text-sm text-neutral-600 mb-3">
                      <strong>שירות:</strong> {appt.service.name} ({appt.service.durationMinutes} דק׳) ·{" "}
                      <strong>ספר:</strong> {appt.staff.name}
                    </div>
                    {appt.note && (
                      <div className="text-sm text-neutral-500 mb-3">
                        <strong>הערת לקוח:</strong> {appt.note}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs text-neutral-400 self-center">שנה סטטוס:</span>
                      {STATUS_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => updateStatus(appt.id, opt.value)}
                          disabled={appt.status === opt.value || updatingId === appt.id}
                          className={`text-xs px-3 py-1.5 rounded-full border transition ${
                            appt.status === opt.value
                              ? opt.color + " font-semibold border-transparent"
                              : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                          } disabled:opacity-50`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
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
