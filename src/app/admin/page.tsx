"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_HOUR_HEIGHT = 64;
const DAY_START = 8;
const DAY_END = 21;
const TOTAL_HOURS = DAY_END - DAY_START;

// Context for dynamic hourHeight (pinch-to-zoom)
const HHCtx = React.createContext(DEFAULT_HOUR_HEIGHT);

const COLORS = [
  { bg: "bg-violet-500", light: "bg-violet-100 text-violet-900 border-violet-300" },
  { bg: "bg-blue-500",   light: "bg-blue-100 text-blue-900 border-blue-300" },
  { bg: "bg-emerald-500",light: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  { bg: "bg-amber-500",  light: "bg-amber-100 text-amber-900 border-amber-300" },
  { bg: "bg-rose-500",   light: "bg-rose-100 text-rose-900 border-rose-300" },
  { bg: "bg-cyan-500",   light: "bg-cyan-100 text-cyan-900 border-cyan-300" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const todayISO = () => new Date().toISOString().split("T")[0];
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const minToTime = (m: number) => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate()+n); return d.toISOString().split("T")[0]; };
const dayOfWeek = (iso: string) => new Date(iso).getDay();
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { weekday: "short", day: "numeric" });
const apptTop = (t: string, hh: number) => ((toMin(t) - DAY_START * 60) / 60) * hh;
const apptH = (s: string, e: string, hh: number) => Math.max(((toMin(e) - toMin(s)) / 60) * hh, 20);
const nowPxFn = (hh: number) => { const n = new Date(); return ((n.getHours() * 60 + n.getMinutes() - DAY_START * 60) / 60) * hh; };
const yToTimeFn = (y: number, hh: number) => {
  const mins = Math.round((y / hh) * 60 / 5) * 5 + DAY_START * 60;
  return minToTime(Math.max(DAY_START * 60, Math.min(DAY_END * 60 - 5, mins)));
};

// ── Types ─────────────────────────────────────────────────────────────────────
type Schedule = { dayOfWeek: number; isWorking: boolean; slots: string; breaks: string | null };
type Staff = { id: string; name: string; avatarUrl: string | null; isAvailable: boolean; schedules: Schedule[] };
type Service = { id: string; name: string; price: number; durationMinutes: number };
type Appt = {
  id: string; startTime: string; endTime: string; status: string; price: number; date: string;
  note: string | null; staffNote: string | null;
  customer: { id: string; name: string; phone: string; referralSource: string | null };
  staff: { id: string; name: string };
  service: { name: string; durationMinutes: number };
};
type Customer = { id: string; name: string; phone: string };
type ViewType = "day" | "3day" | "week" | "month";
type WaitlistEntry = {
  id: string;
  customer: { name: string; phone: string };
  service: { name: string };
  staff?: { name: string } | null;
  date: string;
  status: string;
  isFlexible: boolean;
  preferredTimeOfDay?: string | null;
};

// ── Working hours helper ───────────────────────────────────────────────────────
function getWorkingRanges(staff: Staff, dow: number): { start: number; end: number }[] {
  const s = staff.schedules.find(x => x.dayOfWeek === dow);
  if (!s || !s.isWorking) return [];
  try { return JSON.parse(s.slots).map((sl: { start: string; end: string }) => ({ start: toMin(sl.start), end: toMin(sl.end) })); }
  catch { return []; }
}
function getBreakRanges(staff: Staff, dow: number): { start: number; end: number }[] {
  const s = staff.schedules.find(x => x.dayOfWeek === dow);
  if (!s || !s.breaks) return [];
  try { return JSON.parse(s.breaks).map((b: { start: string; end: string }) => ({ start: toMin(b.start), end: toMin(b.end) })); }
  catch { return []; }
}

// ── Working Hours Overlay ─────────────────────────────────────────────────────
function WorkingOverlay({ staff, dow }: { staff: Staff; dow: number }) {
  const hh = React.useContext(HHCtx);
  const working = getWorkingRanges(staff, dow);
  const breaks = getBreakRanges(staff, dow);
  const dayStartMin = DAY_START * 60;
  const dayEndMin = DAY_END * 60;
  if (working.length === 0) {
    return <div className="absolute inset-0 bg-neutral-100/80 pointer-events-none" />;
  }
  // Build non-working segments
  const segments: { start: number; end: number; type: "closed" | "break" }[] = [];
  let cursor = dayStartMin;
  const sorted = [...working].sort((a, b) => a.start - b.start);
  for (const w of sorted) {
    if (w.start > cursor) segments.push({ start: cursor, end: w.start, type: "closed" });
    cursor = w.end;
  }
  if (cursor < dayEndMin) segments.push({ start: cursor, end: dayEndMin, type: "closed" });
  for (const b of breaks) segments.push({ start: b.start, end: b.end, type: "break" });

  return (
    <>
      {segments.map((seg, i) => {
        const top = ((seg.start - dayStartMin) / 60) * hh;
        const height = ((seg.end - seg.start) / 60) * hh;
        return (
          <div key={i} className={`absolute left-0 right-0 pointer-events-none ${seg.type === "closed" ? "bg-neutral-100/70" : "bg-orange-50/70"}`}
            style={{ top, height }} />
        );
      })}
    </>
  );
}

// ── Appointment Block ─────────────────────────────────────────────────────────
function ApptBlock({ appt, colorClass, onClick }: { appt: Appt; colorClass: string; onClick: () => void }) {
  const hh = React.useContext(HHCtx);
  const top = apptTop(appt.startTime, hh);
  const height = apptH(appt.startTime, appt.endTime, hh);
  return (
    <div className={`absolute left-0.5 right-0.5 rounded-lg border cursor-pointer hover:opacity-85 transition overflow-hidden px-1.5 py-1 z-10 ${colorClass}`}
      style={{ top, height }}
      onPointerDown={e => e.stopPropagation()}
      onPointerUp={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick(); }}>
      <p className="text-[11px] font-bold leading-tight truncate">{appt.customer.name}</p>
      {height > 36 && <p className="text-[10px] opacity-70 truncate">{appt.service.name}</p>}
      {height > 52 && <p className="text-[10px] opacity-60">{appt.startTime}</p>}
    </div>
  );
}

// ── New Appointment Modal ─────────────────────────────────────────────────────
function NewApptModal({ staff, allStaff, services, date, time, onClose, onSaved }:
  { staff: Staff | null; allStaff: Staff[]; services: Service[]; date: string; time: string; onClose: () => void; onSaved: () => void }
) {
  // fromGrid = opened by clicking a cell (staff + time pre-set)
  const fromGrid = !!staff;
  const [form, setForm] = useState({ staffId: staff?.id || "", serviceId: "", date, time, note: "" });
  const [customerMode, setCustomerMode] = useState<"search" | "new">("search");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (customerQuery.length < 1) { setCustomers([]); return; }
    fetch(`/api/admin/customers?q=${encodeURIComponent(customerQuery)}`).then(r => r.json()).then(setCustomers);
  }, [customerQuery]);

  const selectedService = services.find(s => s.id === form.serviceId);
  const endTime = selectedService
    ? minToTime(toMin(form.time) + selectedService.durationMinutes) : "";

  async function save(override = false) {
    if (!form.staffId || !form.serviceId || !form.date || !form.time) return;
    const phone = selectedCustomer?.phone || newCustomer.phone;
    const name = selectedCustomer?.name || newCustomer.name;
    if (!phone || !name) return;
    setErrMsg(null);
    setConflictMsg(null);
    setSaving(true);
    const res = await fetch("/api/admin/appointments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, startTime: form.time, phone, customerName: name, override }),
    });
    setSaving(false);
    if (res.status === 409) {
      const j = await res.json().catch(() => ({}));
      setConflictMsg(j.error || "השעה כבר תפוסה");
      return;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErrMsg(j.error || "שגיאה בשמירה");
      return;
    }
    onSaved(); onClose();
  }

  const selectedStaff = allStaff.find(s => s.id === form.staffId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-neutral-100">
          <h3 className="font-bold text-neutral-900 text-lg">קביעת תור</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-neutral-100">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">

          {/* Pre-filled summary banner when opened from grid click */}
          {fromGrid && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-400 flex items-center justify-center text-white font-bold text-base shrink-0">
                {staff.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-amber-900 text-sm">{staff.name}</p>
                <p className="text-xs text-amber-700">
                  {new Date(date + "T00:00:00").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
                  {" · "}
                  {form.time}
                  {endTime && ` – ${endTime}`}
                </p>
              </div>
              <div className="text-amber-400 text-lg">✂️</div>
            </div>
          )}

          {/* Date & time — shown collapsed/editable based on context */}
          {!fromGrid && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">תאריך</label>
                <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" dir="ltr" />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">שעה</label>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => {
                    const [h, m] = form.time.split(":").map(Number);
                    const total = Math.max(DAY_START * 60, h * 60 + m - 5);
                    setForm(p => ({ ...p, time: minToTime(total) }));
                  }} className="w-8 h-9 border border-neutral-200 rounded-lg text-neutral-600 hover:bg-neutral-50 flex items-center justify-center text-sm">−</button>
                  <input type="time" value={form.time} onChange={e => setForm(p => ({ ...p, time: e.target.value }))}
                    className="flex-1 border border-neutral-200 rounded-lg px-2 py-2 text-sm" dir="ltr" />
                  <button type="button" onClick={() => {
                    const [h, m] = form.time.split(":").map(Number);
                    const total = Math.min(DAY_END * 60, h * 60 + m + 5);
                    setForm(p => ({ ...p, time: minToTime(total) }));
                  }} className="w-8 h-9 border border-neutral-200 rounded-lg text-neutral-600 hover:bg-neutral-50 flex items-center justify-center text-sm">+</button>
                </div>
              </div>
            </div>
          )}
          {fromGrid && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">תאריך</label>
                <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                  className="w-full border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-sm text-amber-900" dir="ltr" />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">שעה</label>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => {
                    const [h, m] = form.time.split(":").map(Number);
                    const total = Math.max(DAY_START * 60, h * 60 + m - 5);
                    setForm(p => ({ ...p, time: minToTime(total) }));
                  }} className="w-8 h-9 border border-amber-200 bg-amber-50 rounded-lg text-amber-700 hover:bg-amber-100 flex items-center justify-center text-sm">−</button>
                  <input type="time" value={form.time} onChange={e => setForm(p => ({ ...p, time: e.target.value }))}
                    className="flex-1 border border-amber-200 bg-amber-50 rounded-lg px-2 py-2 text-sm text-amber-900" dir="ltr" />
                  <button type="button" onClick={() => {
                    const [h, m] = form.time.split(":").map(Number);
                    const total = Math.min(DAY_END * 60, h * 60 + m + 5);
                    setForm(p => ({ ...p, time: minToTime(total) }));
                  }} className="w-8 h-9 border border-amber-200 bg-amber-50 rounded-lg text-amber-700 hover:bg-amber-100 flex items-center justify-center text-sm">+</button>
                </div>
              </div>
            </div>
          )}

          {/* Staff */}
          {fromGrid ? (
            <div>
              <label className="text-xs text-neutral-500 block mb-1">ספר</label>
              <div className="flex items-center gap-2 border border-amber-200 bg-amber-50 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-amber-900 flex-1">{selectedStaff?.name}</span>
                <button onClick={() => {/* allow changing */}} className="text-xs text-amber-500 underline"
                  title="שנה ספר">
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs text-neutral-500 block mb-1">ספר</label>
              <select value={form.staffId} onChange={e => setForm(p => ({ ...p, staffId: e.target.value }))}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm">
                <option value="">בחר ספר...</option>
                {allStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {/* Service */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">שירות</label>
            <select value={form.serviceId} onChange={e => setForm(p => ({ ...p, serviceId: e.target.value }))}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm">
              <option value="">בחר שירות...</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name} – ₪{s.price} ({s.durationMinutes} דק׳)</option>)}
            </select>
            {endTime && <p className="text-xs text-neutral-400 mt-1">יסתיים בשעה {endTime}</p>}
          </div>

          {/* Customer */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-neutral-500">לקוח</label>
              <div className="flex gap-2 text-xs">
                <button onClick={() => setCustomerMode("search")}
                  className={`px-2 py-0.5 rounded-full ${customerMode === "search" ? "bg-amber-100 text-amber-700" : "text-neutral-400"}`}>
                  חיפוש
                </button>
                <button onClick={() => setCustomerMode("new")}
                  className={`px-2 py-0.5 rounded-full ${customerMode === "new" ? "bg-amber-100 text-amber-700" : "text-neutral-400"}`}>
                  לקוח חדש
                </button>
              </div>
            </div>

            {customerMode === "search" ? (
              <>
                {selectedCustomer ? (
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    <span className="text-sm font-medium text-emerald-800 flex-1">{selectedCustomer.name}</span>
                    <span className="text-xs text-emerald-600" dir="ltr">{selectedCustomer.phone}</span>
                    <button onClick={() => setSelectedCustomer(null)} className="text-emerald-500 text-xs">✕</button>
                  </div>
                ) : (
                  <>
                    <input value={customerQuery} onChange={e => setCustomerQuery(e.target.value)}
                      placeholder="חפש לפי שם או טלפון..."
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                    {customers.length > 0 && (
                      <div className="border border-neutral-200 rounded-lg mt-1 max-h-40 overflow-y-auto">
                        {customers.map(c => (
                          <button key={c.id} onClick={() => { setSelectedCustomer(c); setCustomerQuery(""); setCustomers([]); }}
                            className="w-full text-right px-3 py-2 hover:bg-neutral-50 flex items-center gap-2 border-b border-neutral-50 last:border-0">
                            <div className="flex-1">
                              <p className="text-sm font-medium">{c.name}</p>
                              <p className="text-xs text-neutral-400" dir="ltr">{c.phone}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <input value={newCustomer.name} onChange={e => setNewCustomer(p => ({ ...p, name: e.target.value }))}
                  placeholder="שם הלקוח"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                <input value={newCustomer.phone} onChange={e => setNewCustomer(p => ({ ...p, phone: e.target.value }))}
                  placeholder="טלפון" dir="ltr"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                <p className="text-xs text-neutral-400 mt-1">✓ יתווסף אוטומטית למאגר הלקוחות</p>
              </div>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">הערה (אופציונלי)</label>
            <input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="px-5 pb-5 space-y-3">
          {errMsg && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{errMsg}</div>
          )}
          {conflictMsg && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <p className="text-amber-900">{conflictMsg}</p>
              <div className="flex gap-2">
                <button onClick={() => save(true)} disabled={saving}
                  className="flex-1 bg-amber-500 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-amber-600">
                  כן, קבע בכל זאת
                </button>
                <button onClick={() => setConflictMsg(null)}
                  className="flex-1 bg-white border border-amber-300 text-amber-700 rounded-lg py-1.5 text-xs">
                  ביטול
                </button>
              </div>
            </div>
          )}
          <button onClick={() => save(false)} disabled={saving || !!conflictMsg || !form.staffId || !form.serviceId ||
            !(selectedCustomer || (newCustomer.name && newCustomer.phone))}
            className="w-full bg-amber-500 text-neutral-950 py-3 rounded-xl font-semibold hover:bg-amber-400 disabled:opacity-40 transition">
            {saving ? "שומר..." : "קבע תור"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Break Modal ───────────────────────────────────────────────────────────
function AddBreakModal({ staffId, date, defaultTime, onClose, onSaved }: {
  staffId: string; date: string; defaultTime: string; onClose: () => void; onSaved: () => void;
}) {
  const [start, setStart] = useState(defaultTime);
  const [end, setEnd] = useState(() => {
    const [h, m] = defaultTime.split(":").map(Number);
    const total = h * 60 + m + 30;
    return `${String(Math.floor(total/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    // Load existing override or schedule for that day's slots
    const dow = new Date(date + "T00:00:00").getDay();
    // Get current overrides
    const overrideRes = await fetch(`/api/admin/staff/${staffId}/schedule/override?date=${date}`).then(r => r.json()).catch(() => null);
    // Get base schedule slots
    const staffRes = await fetch(`/api/admin/staff`).then(r => r.json());
    const staff = staffRes.find((s: {id:string}) => s.id === staffId);
    const baseSchedule = staff?.schedules?.find((sc: {dayOfWeek: number}) => sc.dayOfWeek === dow);
    const baseSlots = baseSchedule ? JSON.parse(baseSchedule.slots || "[]") : [{ start: "09:00", end: "20:00" }];
    const existingBreaks = overrideRes?.breaks ? JSON.parse(overrideRes.breaks) : (baseSchedule?.breaks ? JSON.parse(baseSchedule.breaks || "[]") : []);
    const existingSlots = overrideRes?.slots ? JSON.parse(overrideRes.slots) : baseSlots;

    // Add the new break
    const newBreaks = [...existingBreaks, { start, end }];

    await fetch(`/api/admin/staff/${staffId}/schedule/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        isWorking: true,
        slots: existingSlots,
        breaks: newBreaks,
      }),
    });
    setSaving(false);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-80 shadow-2xl p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-neutral-900 mb-4">הוספת הפסקה</h3>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-neutral-500 block mb-1">מ</label>
            <input type="time" value={start} onChange={e => setStart(e.target.value)}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">עד</label>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={saving}
            className="flex-1 bg-amber-500 text-neutral-950 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
            {saving ? "שומר..." : "הוסף הפסקה"}
          </button>
          <button onClick={onClose} className="flex-1 bg-neutral-100 text-neutral-700 py-2 rounded-xl text-sm">ביטול</button>
        </div>
      </div>
    </div>
  );
}

// ── Appointment Detail Modal ───────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; badgeClass: string }> = {
  confirmed:           { label: "מאושר",    badgeClass: "bg-emerald-100 text-emerald-700" },
  pending:             { label: "ממתין",    badgeClass: "bg-amber-100 text-amber-700" },
  completed:           { label: "הושלם",    badgeClass: "bg-blue-100 text-blue-700" },
  cancelled_by_staff:  { label: "בוטל",     badgeClass: "bg-red-100 text-red-500" },
  cancelled_by_customer: { label: "בוטל ע״י לקוח", badgeClass: "bg-red-100 text-red-500" },
  no_show:             { label: "לא הגיע", badgeClass: "bg-neutral-100 text-neutral-500" },
};

function ApptModal({ appt, onClose, onChange, onReload }: {
  appt: Appt; onClose: () => void;
  onChange: (id: string, status: string) => void;
  onReload?: () => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [staffNote, setStaffNote] = useState(appt.staffNote || "");
  const [savingNote, setSavingNote] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [referralSource, setReferralSource] = useState(appt.customer.referralSource || "");
  const [editingReferral, setEditingReferral] = useState(false);
  const [savingReferral, setSavingReferral] = useState(false);
  const [referralOptions, setReferralOptions] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/admin/referral-sources").then(r => r.json()).then(setReferralOptions).catch(() => {});
  }, []);
  const meta = STATUS_META[appt.status] || { label: appt.status, badgeClass: "bg-neutral-100 text-neutral-500" };

  async function saveReferral() {
    setSavingReferral(true);
    await fetch(`/api/admin/customers/${appt.customer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referralSource: referralSource.trim() || null }),
    });
    setSavingReferral(false);
    setEditingReferral(false);
  }

  async function setStatus(status: string) {
    setUpdating(true);
    await fetch(`/api/admin/appointments/${appt.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    onChange(appt.id, status);
    setUpdating(false);
  }

  async function saveNote() {
    setSavingNote(true);
    await fetch(`/api/admin/appointments/${appt.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staffNote }),
    });
    setSavingNote(false);
  }

  const cleanPhone = appt.customer.phone.replace(/\D/g, "");

  if (editMode) {
    return <ApptEditForm
      appt={appt}
      onCancel={() => setEditMode(false)}
      onSaved={() => {
        setEditMode(false);
        onReload?.();
        onClose();
      }}
      onClose={onClose}
    />;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-neutral-100">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-lg text-neutral-900">{appt.service.name}</h3>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${meta.badgeClass}`}>{meta.label}</span>
            </div>
            <p className="text-sm text-neutral-500 mt-0.5">{appt.staff.name} · {appt.startTime}–{appt.endTime}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center shrink-0 hover:bg-neutral-200 transition">✕</button>
        </div>

        {/* Customer */}
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-neutral-200 flex items-center justify-center text-neutral-700 font-bold text-lg shrink-0">
            {appt.customer.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-neutral-900">{appt.customer.name}</p>
            <p className="text-sm text-neutral-500" dir="ltr">{appt.customer.phone}</p>
          </div>
          <div className="flex gap-2">
            <a href={`tel:${appt.customer.phone}`}
              className="w-9 h-9 rounded-full bg-neutral-100 flex items-center justify-center text-base hover:bg-neutral-200 transition"
              title="התקשר">📞</a>
            <a href={`https://wa.me/${cleanPhone}`} target="_blank"
              className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-base hover:bg-emerald-200 transition"
              title="WhatsApp">💬</a>
          </div>
        </div>

        {/* Details row */}
        <div className="px-5 py-3 border-b border-neutral-100 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-xs text-neutral-400 mb-0.5">תאריך</p>
            <p className="font-medium text-neutral-800 text-xs">{fmtDay(appt.date)}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-400 mb-0.5">שעה</p>
            <p className="font-medium text-neutral-800" dir="ltr">{appt.startTime}–{appt.endTime}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-400 mb-0.5">מחיר</p>
            <p className="font-bold text-amber-600">₪{appt.price}</p>
          </div>
        </div>

        {/* Edit button */}
        <div className="px-5 py-3 border-b border-neutral-100">
          <button onClick={() => setEditMode(true)}
            className="w-full py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition flex items-center justify-center gap-2">
            ✏️ ערוך תור (שעה / ספר / תאריך / שירות / מחיר)
          </button>
        </div>

        {/* Referral source */}
        <div className="px-5 py-3 border-b border-neutral-100">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-neutral-400">מקור הגעה</p>
            {!editingReferral && (
              <button onClick={() => setEditingReferral(true)}
                className="text-xs text-amber-600 hover:underline">
                {referralSource ? "ערוך" : "הוסף"}
              </button>
            )}
          </div>
          {editingReferral ? (
            <div className="flex gap-2">
              <select value={referralSource} onChange={e => setReferralSource(e.target.value)}
                className="flex-1 border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white">
                <option value="">לא צוין</option>
                {referralOptions.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <button onClick={saveReferral} disabled={savingReferral}
                className="text-xs bg-neutral-900 text-white px-3 rounded-lg shrink-0">
                {savingReferral ? "..." : "שמור"}
              </button>
              <button onClick={() => { setEditingReferral(false); setReferralSource(appt.customer.referralSource || ""); }}
                className="text-xs text-neutral-400 px-1">✕</button>
            </div>
          ) : (
            <p className={`text-sm ${referralSource ? "text-neutral-800" : "text-neutral-400 italic"}`}>
              {referralSource || "לא צוין"}
            </p>
          )}
        </div>

        {/* Customer note */}
        {appt.note && (
          <div className="px-5 py-3 border-b border-neutral-100">
            <p className="text-xs text-neutral-400 mb-1">הערת לקוח</p>
            <p className="text-sm text-neutral-700 bg-neutral-50 rounded-lg px-3 py-2">{appt.note}</p>
          </div>
        )}

        {/* Staff note */}
        <div className="px-5 py-3 border-b border-neutral-100">
          <p className="text-xs text-neutral-400 mb-1.5">הערת ספר</p>
          <textarea value={staffNote} onChange={e => setStaffNote(e.target.value)} rows={2}
            placeholder="הוסף הערה פנימית..."
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-300" />
          {staffNote !== (appt.staffNote || "") && (
            <button onClick={saveNote} disabled={savingNote}
              className="mt-1 text-xs text-amber-600 hover:underline disabled:opacity-50">
              {savingNote ? "שומר..." : "שמור הערה"}
            </button>
          )}
        </div>

        {/* Status actions */}
        <div className="px-5 py-3 border-b border-neutral-100">
          <p className="text-xs text-neutral-400 mb-2">שינוי סטטוס</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: "confirmed",          l: "✓ מאשר",    c: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
              { v: "completed",          l: "✔ הושלם",   c: "bg-blue-50 text-blue-700 border border-blue-200" },
              { v: "no_show",            l: "לא הגיע",  c: "bg-neutral-50 text-neutral-600 border border-neutral-200" },
              { v: "cancelled_by_staff", l: "בטל תור",  c: "bg-red-50 text-red-600 border border-red-200" },
            ].map(({ v, l, c }) => (
              <button key={v} disabled={appt.status === v || updating} onClick={() => setStatus(v)}
                className={`py-2 rounded-xl text-sm font-medium transition disabled:opacity-40 disabled:cursor-default ${c}`}>{l}</button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 py-4">
          <a href={`https://wa.me/${cleanPhone}`} target="_blank"
            className="block w-full py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-medium text-center hover:bg-emerald-600 transition">
            💬 שלח הודעה ב-WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Full appointment edit form ─────────────────────────────────────────────────
function ApptEditForm({ appt, onCancel, onSaved, onClose }: {
  appt: Appt; onCancel: () => void; onSaved: () => void; onClose: () => void;
}) {
  const initialDate = appt.date.split("T")[0];
  const initialDuration = toMin(appt.endTime) - toMin(appt.startTime);

  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState(appt.startTime);
  const [staffId, setStaffId] = useState(appt.staff.id);
  const [serviceId, setServiceId] = useState<string>("");
  const [duration, setDuration] = useState(initialDuration);
  const [price, setPrice] = useState<number>(appt.price);
  const [note, setNote] = useState(appt.note || "");

  const [allStaff, setAllStaff] = useState<{ id: string; name: string }[]>([]);
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/staff").then(r => r.json()).then(d => setAllStaff(d.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }))));
    fetch("/api/admin/services").then(r => r.json()).then((d: Service[]) => {
      setAllServices(d);
      const match = d.find(s => s.name === appt.service.name);
      if (match) setServiceId(match.id);
    });
  }, [appt.service.name]);

  // When service changes → auto-set duration and price from the new service
  const onServiceChange = (id: string) => {
    setServiceId(id);
    const svc = allServices.find(s => s.id === id);
    if (svc) {
      setDuration(svc.durationMinutes);
      setPrice(svc.price);
    }
  };

  async function save(override = false) {
    setErr(null);
    setConflict(null);
    setSaving(true);

    const body: Record<string, unknown> = {
      date,
      startTime,
      staffId,
      durationMinutes: Number(duration) || 30,
      price: Number(price),
      note: note || null,
    };
    if (serviceId) body.serviceId = serviceId;
    if (override) body.override = true;

    const r = await fetch(`/api/admin/appointments/${appt.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);

    if (r.status === 409) {
      const j = await r.json();
      setConflict(j.error || "יש התנגשות");
      return;
    }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error || "שגיאה בשמירה");
      return;
    }
    onSaved();
  }

  const endMin = toMin(startTime) + Number(duration || 0);
  const endTime = minToTime(Math.min(endMin, 23 * 60 + 59));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-neutral-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-bold text-lg text-neutral-900">עריכת תור</h3>
            <p className="text-xs text-neutral-500 mt-0.5">{appt.customer.name}</p>
          </div>
          <button onClick={onCancel} className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center hover:bg-neutral-200">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Date */}
          <div>
            <label className="text-xs text-neutral-500 mb-1 block">תאריך</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} dir="ltr"
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>

          {/* Time + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">שעת התחלה</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} dir="ltr"
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">משך (דקות)</label>
              <input type="number" min={5} step={5} value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          </div>
          <div className="text-xs text-neutral-400" dir="ltr">
            {startTime} — {endTime}
          </div>

          {/* Staff */}
          <div>
            <label className="text-xs text-neutral-500 mb-1 block">ספר</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              {allStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Service */}
          <div>
            <label className="text-xs text-neutral-500 mb-1 block">סוג תור</label>
            <select value={serviceId} onChange={e => onServiceChange(e.target.value)}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              {allServices.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} (₪{s.price}, {s.durationMinutes} דק)
                </option>
              ))}
            </select>
          </div>

          {/* Price */}
          <div>
            <label className="text-xs text-neutral-500 mb-1 block">מחיר (₪)</label>
            <input type="number" min={0} value={price} onChange={e => setPrice(Number(e.target.value))}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>

          {/* Customer note */}
          <div>
            <label className="text-xs text-neutral-500 mb-1 block">הערת לקוח</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>

          {err && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{err}</div>}

          {conflict && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <p className="text-amber-900">{conflict}</p>
              <div className="flex gap-2">
                <button onClick={() => save(true)} disabled={saving}
                  className="flex-1 bg-amber-500 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-amber-600">
                  כן, שמור בכל זאת
                </button>
                <button onClick={() => setConflict(null)}
                  className="flex-1 bg-white border border-amber-300 text-amber-700 rounded-lg py-1.5 text-xs">
                  ביטול
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-neutral-100 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onCancel} disabled={saving}
            className="flex-1 border border-neutral-200 rounded-xl py-2.5 text-sm hover:bg-neutral-50">ביטול</button>
          <button onClick={() => save(false)} disabled={saving || !!conflict}
            className="flex-1 bg-neutral-900 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50">
            {saving ? "שומר..." : "שמור שינויים"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Day Panel (replaces DayMenu) ──────────────────────────────────────────────
function DayPanel({ date, staffId, onClose, onRefresh }: { date: string; staffId: string; onClose: () => void; onRefresh: () => void }) {
  const [tab, setTab] = useState<"hours" | "breaks" | "waitlist">("hours");
  const [hours, setHours] = useState({ isWorking: true, start: "09:00", end: "20:00" });
  const [breaks, setBreaks] = useState<{ start: string; end: string }[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [newWaiting, setNewWaiting] = useState({ name: "", phone: "", serviceId: "" });
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    // Load existing override/schedule
    fetch("/api/admin/staff").then(r => r.json()).then(allStaff => {
      const s = allStaff.find((x: {id:string}) => x.id === staffId);
      const dow = new Date(date + "T00:00:00").getDay();
      const sched = s?.schedules?.find((sc: {dayOfWeek: number}) => sc.dayOfWeek === dow);
      if (sched) {
        const slots = JSON.parse(sched.slots || "[]");
        setHours({ isWorking: sched.isWorking, start: slots[0]?.start || "09:00", end: slots[0]?.end || "20:00" });
        setBreaks(sched.breaks ? JSON.parse(sched.breaks) : []);
      }
    });
    fetch(`/api/admin/waitlist?date=${date}&staffId=${staffId}`).then(r => r.json()).then(setWaitlist).catch(() => {});
    fetch("/api/admin/services").then(r => r.json()).then(setServices).catch(() => {});
  }, [date, staffId]);

  async function saveHours() {
    setSaving(true);
    await fetch(`/api/admin/staff/${staffId}/schedule/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, isWorking: hours.isWorking, slots: [{ start: hours.start, end: hours.end }], breaks }),
    });
    setSaving(false); onRefresh(); onClose();
  }

  async function closeDay() {
    setSaving(true);
    await fetch(`/api/admin/staff/${staffId}/schedule/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, isWorking: false }),
    });
    setSaving(false); onRefresh(); onClose();
  }

  async function removeBreak(idx: number) {
    const newBreaks = breaks.filter((_, i) => i !== idx);
    setBreaks(newBreaks);
    await fetch(`/api/admin/staff/${staffId}/schedule/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, isWorking: hours.isWorking, slots: [{ start: hours.start, end: hours.end }], breaks: newBreaks }),
    });
    onRefresh();
  }

  async function addBreak() {
    const newBreak = { start: "13:00", end: "13:30" };
    const newBreaks = [...breaks, newBreak];
    setBreaks(newBreaks);
  }

  async function addToWaitlist() {
    if (!newWaiting.phone || !newWaiting.serviceId) return;
    await fetch("/api/admin/waitlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newWaiting, staffId, date }),
    });
    setNewWaiting({ name: "", phone: "", serviceId: "" });
    fetch(`/api/admin/waitlist?date=${date}&staffId=${staffId}`).then(r => r.json()).then(setWaitlist);
  }

  async function removeFromWaitlist(id: string) {
    await fetch("/api/admin/waitlist", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "expired" }),
    });
    setWaitlist(prev => prev.filter(w => w.id !== id));
  }

  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-neutral-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-neutral-900">{dateLabel}</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-neutral-100 px-3 pt-1">
          {([["hours","שעות"],["breaks","הפסקות"],["waitlist","המתנה"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === key ? "border-amber-500 text-amber-700" : "border-transparent text-neutral-500"}`}>
              {label}
              {key === "waitlist" && waitlist.length > 0 && (
                <span className="mr-1 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5">{waitlist.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "hours" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button onClick={() => setHours(p => ({ ...p, isWorking: !p.isWorking }))}
                  className={`w-11 h-6 rounded-full transition relative ${hours.isWorking ? "bg-emerald-500" : "bg-neutral-300"}`}>
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${hours.isWorking ? "right-1" : "left-1"}`} />
                </button>
                <span className="text-sm font-medium">{hours.isWorking ? "יום עבודה" : "יום סגור"}</span>
              </div>
              {hours.isWorking && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">מ</label>
                    <input type="time" value={hours.start} onChange={e => setHours(p => ({ ...p, start: e.target.value }))}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">עד</label>
                    <input type="time" value={hours.end} onChange={e => setHours(p => ({ ...p, end: e.target.value }))}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={saveHours} disabled={saving}
                  className="flex-1 bg-amber-500 text-neutral-950 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {saving ? "שומר..." : "שמור"}
                </button>
                <button onClick={closeDay} disabled={saving}
                  className="flex-1 bg-red-50 text-red-600 border border-red-200 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50">
                  🔒 סגור יום
                </button>
              </div>
            </div>
          )}

          {tab === "breaks" && (
            <div className="space-y-3">
              {breaks.length === 0 && <p className="text-sm text-neutral-400 text-center py-4">אין הפסקות מוגדרות</p>}
              {breaks.map((br, i) => (
                <div key={i} className="flex items-center gap-2 bg-orange-50 rounded-xl px-3 py-2 border border-orange-100">
                  <span className="text-sm font-mono font-medium text-orange-800 flex-1">{br.start} – {br.end}</span>
                  <div className="flex gap-2">
                    <input type="time" value={br.start}
                      onChange={e => setBreaks(prev => prev.map((b, j) => j === i ? { ...b, start: e.target.value } : b))}
                      className="border border-orange-200 rounded px-1 py-0.5 text-xs" />
                    <input type="time" value={br.end}
                      onChange={e => setBreaks(prev => prev.map((b, j) => j === i ? { ...b, end: e.target.value } : b))}
                      className="border border-orange-200 rounded px-1 py-0.5 text-xs" />
                    <button onClick={() => removeBreak(i)} className="text-red-400 text-xs hover:text-red-600">✕</button>
                  </div>
                </div>
              ))}
              <button onClick={addBreak}
                className="w-full border-2 border-dashed border-neutral-200 text-neutral-400 py-2 rounded-xl text-sm hover:border-amber-300 hover:text-amber-600 transition">
                + הוסף הפסקה
              </button>
              {breaks.length > 0 && (
                <button onClick={saveHours} disabled={saving}
                  className="w-full bg-amber-500 text-neutral-950 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {saving ? "שומר..." : "שמור הפסקות"}
                </button>
              )}
            </div>
          )}

          {tab === "waitlist" && (
            <div className="space-y-3">
              {waitlist.length === 0 && <p className="text-sm text-neutral-400 text-center py-4">אין ממתינים</p>}
              {waitlist.map(w => {
                const timeLabel =
                  w.preferredTimeOfDay === "morning"   ? "🌅 בוקר"   :
                  w.preferredTimeOfDay === "afternoon"  ? "☀️ צהריים" : null;
                return (
                  <div key={w.id} className="bg-neutral-50 rounded-xl px-3 py-2.5 border border-neutral-200 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">{w.customer.name}</p>
                      <p className="text-xs text-neutral-500">{w.service.name}</p>
                      <div className="flex gap-1.5 mt-1 flex-wrap">
                        {timeLabel && (
                          <span className="text-[11px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md font-medium">{timeLabel}</span>
                        )}
                        {w.isFlexible && (
                          <span className="text-[11px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-md">גמיש בתאריך</span>
                        )}
                      </div>
                    </div>
                    <a href={`tel:${w.customer.phone}`} className="text-neutral-400 hover:text-neutral-700 text-sm mt-0.5">📞</a>
                    <button onClick={() => removeFromWaitlist(w.id)} className="text-red-300 hover:text-red-500 text-xs mt-0.5">✕</button>
                  </div>
                );
              })}
              <div className="border-t border-neutral-100 pt-3 space-y-2">
                <p className="text-xs font-medium text-neutral-500">הוסף להמתנה</p>
                <input value={newWaiting.name} onChange={e => setNewWaiting(p => ({ ...p, name: e.target.value }))}
                  placeholder="שם" className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                <input value={newWaiting.phone} onChange={e => setNewWaiting(p => ({ ...p, phone: e.target.value }))}
                  placeholder="טלפון" dir="ltr" className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                <select value={newWaiting.serviceId} onChange={e => setNewWaiting(p => ({ ...p, serviceId: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">בחר שירות...</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={addToWaitlist} disabled={!newWaiting.phone || !newWaiting.serviceId}
                  className="w-full bg-amber-500 text-neutral-950 py-2 rounded-xl text-sm font-semibold disabled:opacity-40">
                  + הוסף לרשימה
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Time Column ───────────────────────────────────────────────────────────────
function TimeColumn() {
  const hh = React.useContext(HHCtx);
  const totalHeight = TOTAL_HOURS * hh;
  return (
    <div className="w-14 shrink-0 relative select-none" style={{ height: totalHeight }}>
      {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
        <div key={i} className="absolute right-2 text-[11px] text-neutral-400 font-mono" style={{ top: i * hh - 7 }}>
          {String(DAY_START + i).padStart(2, "0")}:00
        </div>
      ))}
    </div>
  );
}

// ── Grid Lines (15-minute intervals) ──────────────────────────────────────────
function GridLines() {
  const hh = React.useContext(HHCtx);
  // 4 segments per hour (15 min each)
  const segments = TOTAL_HOURS * 4;
  return (
    <div className="absolute inset-0 pointer-events-none">
      {Array.from({ length: segments + 1 }, (_, i) => {
        const isHour    = i % 4 === 0;
        const isHalfHour = i % 2 === 0;
        return (
          <div key={i}
            className={`absolute left-0 right-0 border-t ${
              isHour      ? "border-neutral-200" :
              isHalfHour  ? "border-neutral-150 border-dashed opacity-60" :
                            "border-neutral-100 border-dashed opacity-30"
            }`}
            style={{ top: i * (hh / 4) }} />
        );
      })}
    </div>
  );
}

// ── Drag state for creating appointments ─────────────────────────────────────
type DragState = { staffId: string; date: string; startY: number; endY: number } | null;

// ── Draft Appointment Block (Google-Calendar style click-to-place) ─────────────
function DraftApptBlock({
  startY, staffName,
  onMove, onConfirm, onAddBreak, onDismiss,
}: {
  startY: number; staffName: string; date: string;
  onMove: (y: number) => void;
  onConfirm: () => void;
  onAddBreak: () => void;
  onDismiss: () => void;
}) {
  const hh = React.useContext(HHCtx);
  const totalH = TOTAL_HOURS * hh;
  const blockH = Math.max(hh * 0.5, 60);
  const clampedTop = Math.max(0, Math.min(totalH - blockH, startY));
  const time = yToTimeFn(clampedTop, hh);
  const dragRef = useRef<{ clientY: number; startY: number } | null>(null);

  return (
    <div
      className="absolute left-1 right-1 z-30 select-none cursor-grab active:cursor-grabbing"
      style={{ top: clampedTop, height: blockH, touchAction: "none" }}
      onPointerDown={e => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { clientY: e.clientY, startY: clampedTop };
      }}
      onPointerMove={e => {
        if (!dragRef.current) return;
        const newY = Math.max(0, Math.min(totalH - blockH, dragRef.current.startY + e.clientY - dragRef.current.clientY));
        onMove(newY);
      }}
      onPointerUp={e => { e.stopPropagation(); dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}>

      {/* Shadow card */}
      <div className="w-full h-full rounded-xl bg-white shadow-xl border border-neutral-200 flex flex-col overflow-hidden"
        style={{ borderRight: "3px solid #f59e0b" }}>

        {/* Top row — time + close */}
        <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
          <span className="text-[12px] font-semibold text-neutral-800">{time}</span>
          <button
            className="text-neutral-400 hover:text-neutral-600 text-sm leading-none"
            onClick={e => { e.stopPropagation(); onDismiss(); }}>✕</button>
        </div>

        {/* Staff name */}
        {blockH > 72 && (
          <p className="text-[10px] text-neutral-400 px-2.5 truncate">✂️ {staffName}</p>
        )}

        {/* Actions */}
        <div className="flex gap-1.5 px-2 pb-2 mt-auto">
          <button
            className="flex-1 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-neutral-950 rounded-lg text-[11px] font-semibold py-1.5 transition"
            onClick={e => { e.stopPropagation(); onConfirm(); }}>
            קבע תור
          </button>
          <button
            className="text-neutral-400 hover:text-neutral-600 text-sm px-2 rounded-lg hover:bg-neutral-50 transition"
            title="הוסף הפסקה"
            onClick={e => { e.stopPropagation(); onAddBreak(); }}>
            ☕
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Calendar ─────────────────────────────────────────────────────────────
export default function AdminCalendar() {
  const [view, setView] = useState<ViewType>("day");
  const [date, setDate] = useState(todayISO());
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [visibleStaff, setVisibleStaff] = useState<string[]>([]);
  const [weekBarber, setWeekBarber] = useState<string>("");
  const [appointments, setAppointments] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilter, setShowFilter] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<Appt | null>(null);
  const [newAppt, setNewAppt] = useState<{ staffId: string; date: string; time: string } | null>(null);
  const [addBreak, setAddBreak] = useState<{ staffId: string; date: string; time: string } | null>(null);
  const [draftAppt, setDraftAppt] = useState<{ staffId: string; date: string; startY: number } | null>(null);
  const [dayMenu, setDayMenu] = useState<{ date: string; staffId: string } | null>(null);
  const [waitlistCounts, setWaitlistCounts] = useState<Record<string, number>>({});
  // ── Zoom & drag ──────────────────────────────────────────────────────────────
  const [hourHeight, setHourHeight] = useState(DEFAULT_HOUR_HEIGHT);
  const [drag, setDrag] = useState<DragState>(null);
  const hourHeightRef = useRef(DEFAULT_HOUR_HEIGHT);
  hourHeightRef.current = hourHeight;
  const totalHeight = TOTAL_HOURS * hourHeight;
  const [nowY, setNowY] = useState(() => nowPxFn(DEFAULT_HOUR_HEIGHT));
  const gridRef = useRef<HTMLDivElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval>>();

  // Update nowY whenever hourHeight changes
  useEffect(() => {
    setNowY(nowPxFn(hourHeight));
    const t = setInterval(() => setNowY(nowPxFn(hourHeightRef.current)), 60_000);
    return () => clearInterval(t);
  }, [hourHeight]);

  // Pinch-to-zoom touch handler on the grid container
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    let startDist = 0;
    let startHH = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        );
        startHH = hourHeightRef.current;
      } else {
        startDist = 0;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && startDist > 0) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        );
        const scale = dist / startDist;
        const newHH = Math.max(28, Math.min(220, Math.round(startHH * scale)));
        setHourHeight(newHH);
      }
    };
    const onTouchEnd = () => { startDist = 0; };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load staff + services once
  useEffect(() => {
    Promise.all([
      fetch("/api/admin/staff").then(r => r.json()),
      fetch("/api/admin/services").then(r => r.json()),
    ]).then(([st, sv]) => {
      setAllStaff(st);
      setVisibleStaff(st.map((s: Staff) => s.id));
      if (st.length) setWeekBarber(st[0].id);
      setServices(sv);
    });
  }, []);

  const getDates = useCallback(() => {
    if (view === "day") return [date];
    if (view === "3day") return [date, addDays(date, 1), addDays(date, 2)];
    if (view === "week") {
      const dow = new Date(date).getDay();
      const sun = addDays(date, -dow);
      return Array.from({ length: 7 }, (_, i) => addDays(sun, i));
    }
    return [date];
  }, [view, date]);

  const loadAppointments = useCallback(async () => {
    if (!allStaff.length) return;
    setLoading(true);
    const dates = getDates();
    const results = await Promise.all(dates.map(d => fetch(`/api/admin/appointments?date=${d}`).then(r => r.json())));
    setAppointments(results.flat());
    setLoading(false);
  }, [getDates, allStaff]);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  // Auto-refresh every 3 minutes
  useEffect(() => {
    refreshTimer.current = setInterval(loadAppointments, 3 * 60_000);
    return () => clearInterval(refreshTimer.current);
  }, [loadAppointments]);

  useEffect(() => {
    if (gridRef.current && !loading) gridRef.current.scrollTop = Math.max(nowPxFn(hourHeightRef.current) - 120, 0);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch waitlist counts for visible dates
  useEffect(() => {
    const dates = getDates();
    Promise.all(
      dates.map(d =>
        fetch(`/api/admin/waitlist?date=${d}`).then(r => r.json()).then(data => [d, data.length])
      )
    ).then(results => {
      const counts: Record<string, number> = {};
      for (const [d, count] of results) counts[d as string] = count as number;
      setWaitlistCounts(counts);
    }).catch(() => {});
  }, [getDates]);

  function navigate(dir: -1 | 1) {
    const step = view === "day" ? 1 : view === "3day" ? 3 : 7;
    setDate(addDays(date, dir * step));
  }

  const displayedStaff = allStaff.filter(s => visibleStaff.includes(s.id));
  const weekStaff = allStaff.find(s => s.id === weekBarber) || allStaff[0];
  const dates = getDates();

  function getAppts(staffId: string, d: string) {
    // Compare only the date portion (first 10 chars of ISO string = YYYY-MM-DD)
    // Works correctly when dates are stored as UTC midnight
    return appointments.filter(a =>
      a.staff.id === staffId &&
      a.date.slice(0, 10) === d &&
      !["cancelled_by_customer", "cancelled_by_staff"].includes(a.status)
    );
  }

  // ── Drag to create (desktop/mouse only) ─────────────────────────────────────
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, staffId: string, d: string) {
    if (e.pointerType !== "mouse") return; // touch handled by onClick below
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ staffId, date: d, startY: y, endY: y });
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>, staffId: string, d: string) {
    if (e.pointerType !== "mouse") return;
    if (!drag || drag.staffId !== staffId || drag.date !== d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const y = Math.max(0, Math.min(totalHeight, e.clientY - rect.top));
    setDrag(prev => prev ? { ...prev, endY: y } : null);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>, staffId: string, d: string) {
    if (e.pointerType !== "mouse") return;
    if (!drag || drag.staffId !== staffId || drag.date !== d) return;
    const dist = Math.abs(drag.endY - drag.startY);
    if (dist < 10) {
      // Short click → place draft block
      setDraftAppt({ staffId, date: d, startY: drag.startY });
    } else {
      // Long drag → open modal immediately with start time
      const startY = Math.min(drag.startY, drag.endY);
      setNewAppt({ staffId, date: d, time: yToTimeFn(startY, hourHeight) });
      setDraftAppt(null);
    }
    setDrag(null);
  }

  // For touch: tap places the draft block (onClick fires for taps, not scrolls)
  function handleGridClick(e: React.MouseEvent<HTMLDivElement>, staffId: string, d: string) {
    if (drag !== null) return; // already handled by pointer events
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    setDraftAppt({ staffId, date: d, startY: y });
  }

  function handleStatusChange(id: string, status: string) {
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    if (selectedAppt?.id === id) setSelectedAppt(prev => prev ? { ...prev, status } : null);
  }

  // ── Month view ──────────────────────────────────────────────────────────────
  function renderMonth() {
    const d = new Date(date);
    const year = d.getFullYear(); const month = d.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (string | null)[] = [
      ...Array(firstDay).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1).toISOString().split("T")[0]),
    ];
    return (
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {["א","ב","ג","ד","ה","ו","ש"].map(w => <div key={w} className="text-center text-xs text-neutral-400 font-medium py-1">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, i) => {
            if (!cell) return <div key={i} />;
            const dayAppts = appointments.filter(a => a.date.startsWith(cell));
            const isToday = cell === todayISO();
            return (
              <div key={cell} className={`rounded-xl p-2 cursor-pointer min-h-[80px] transition ${isToday ? "bg-amber-50 border-2 border-amber-400" : "bg-white border border-neutral-200 hover:bg-neutral-50"}`}
                onClick={() => { setDate(cell); setView("day"); setDayMenu({ date: cell, staffId: allStaff[0]?.id || "" }); }}>
                <span className={`text-sm font-semibold ${isToday ? "text-amber-600" : "text-neutral-800"}`}>{new Date(cell).getDate()}</span>
                <div className="mt-1 space-y-0.5">
                  {dayAppts.slice(0, 3).map((a, ai) => (
                    <div key={a.id} className={`text-[10px] rounded px-1 truncate ${COLORS[ai % COLORS.length].light}`}>
                      {a.startTime} {a.customer.name}
                    </div>
                  ))}
                  {dayAppts.length > 3 && <div className="text-[10px] text-neutral-400">+{dayAppts.length - 3} נוספים</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Time grid ───────────────────────────────────────────────────────────────
  function renderTimeGrid() {
    const isDay = view === "day";

    // On mobile, each barber column in day-view needs a minimum width so columns don't get crushed
    const gridMinWidth = isDay ? `${14 * 4 + displayedStaff.length * 80}px` : undefined; // 56px time col + 80px per barber

    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Column headers — scrollable horizontally to match the grid */}
        <div className="overflow-x-auto shrink-0 border-b border-neutral-200 bg-white">
          <div className="flex" style={{ minWidth: gridMinWidth }}>
            <div className="w-14 shrink-0" />
            {isDay
              ? displayedStaff.map((s, si) => (
                <div key={s.id} style={isDay ? { minWidth: 80 } : {}} className="flex-1 min-w-0 flex flex-col items-center py-2 border-r border-neutral-100 last:border-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${COLORS[si % COLORS.length].bg}`}>
                    {s.name[0]}
                  </div>
                  <span className="text-xs text-neutral-700 mt-1 font-medium truncate px-1">{s.name}</span>
                </div>
              ))
              : dates.map(d => {
                const isToday = d === todayISO();
                const staffForDay = weekStaff;
                return (
                  <div key={d} className="flex-1 min-w-0 flex flex-col items-center py-2 border-r border-neutral-100 last:border-0 cursor-pointer hover:bg-neutral-50 relative"
                    onClick={() => setDayMenu({ date: d, staffId: staffForDay?.id || "" })}>
                    <span className={`text-xs font-semibold ${isToday ? "text-amber-600" : "text-neutral-500"}`}>{fmtShort(d)}</span>
                    {isToday && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-0.5" />}
                    {waitlistCounts[d] > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                        {waitlistCounts[d]}
                      </span>
                    )}
                  </div>
                );
              })
            }
          </div>
        </div>

        {/* Scrollable grid — vertical + horizontal on mobile */}
        <div ref={gridRef} className="flex-1 overflow-y-auto overflow-x-auto">
          <HHCtx.Provider value={hourHeight}>
            <div className="flex" style={{ height: totalHeight, minWidth: gridMinWidth }}>
              <TimeColumn />
              <div className="flex flex-1 relative">
                <GridLines />
                {/* Now line */}
                {dates.includes(todayISO()) && nowY >= 0 && nowY <= totalHeight && (
                  <div className="absolute left-0 right-0 z-20 pointer-events-none flex items-center" style={{ top: nowY }}>
                    <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                    <div className="flex-1 border-t-2 border-red-400" />
                  </div>
                )}

                {isDay
                  ? displayedStaff.map((s, si) => {
                    const colDrag = drag?.staffId === s.id && drag?.date === date ? drag : null;
                    const dragDist = colDrag ? Math.abs(colDrag.endY - colDrag.startY) : 0;
                    const colDraft = draftAppt?.staffId === s.id && draftAppt?.date === date ? draftAppt : null;
                    return (
                      <div key={s.id} className="flex-1 relative border-r border-neutral-100 last:border-0 cursor-crosshair" style={{ minWidth: 80 }}
                        onClick={e => { if (!colDraft) handleGridClick(e, s.id, date); else setDraftAppt(null); }}
                        onPointerDown={e => handlePointerDown(e, s.id, date)}
                        onPointerMove={e => handlePointerMove(e, s.id, date)}
                        onPointerUp={e => handlePointerUp(e, s.id, date)}
                        onPointerCancel={() => setDrag(null)}>
                        <WorkingOverlay staff={s} dow={dayOfWeek(date)} />
                        {/* Drag-to-create ghost rectangle */}
                        {colDrag && dragDist >= 6 && (
                          <div className="absolute left-0.5 right-0.5 bg-amber-300/40 border-2 border-dashed border-amber-500 rounded-lg pointer-events-none z-20 flex flex-col justify-start px-1.5 py-1"
                            style={{ top: Math.min(colDrag.startY, colDrag.endY), height: Math.max(dragDist, 8) }}>
                            {dragDist > 20 && (
                              <span className="text-[10px] font-bold text-amber-900 leading-tight">
                                {yToTimeFn(Math.min(colDrag.startY, colDrag.endY), hourHeight)}
                              </span>
                            )}
                          </div>
                        )}
                        {/* Draft appointment block (Google Calendar style) */}
                        {colDraft && (
                          <DraftApptBlock
                            startY={colDraft.startY}
                            staffName={s.name}
                            date={date}
                            onMove={y => setDraftAppt(prev => prev ? { ...prev, startY: y } : null)}
                            onConfirm={() => { setNewAppt({ staffId: s.id, date, time: yToTimeFn(colDraft.startY, hourHeight) }); setDraftAppt(null); }}
                            onAddBreak={() => { setAddBreak({ staffId: s.id, date, time: yToTimeFn(colDraft.startY, hourHeight) }); setDraftAppt(null); }}
                            onDismiss={() => setDraftAppt(null)}
                          />
                        )}
                        {getAppts(s.id, date).map(a => (
                          <ApptBlock key={a.id} appt={a} colorClass={COLORS[si % COLORS.length].light}
                            onClick={() => setSelectedAppt(a)} />
                        ))}
                      </div>
                    );
                  })
                  : dates.map(d => {
                    const s = weekStaff;
                    if (!s) return <div key={d} className="flex-1" />;
                    const si = allStaff.findIndex(x => x.id === s.id);
                    const colDrag = drag?.staffId === s.id && drag?.date === d ? drag : null;
                    const dragDist = colDrag ? Math.abs(colDrag.endY - colDrag.startY) : 0;
                    const colDraft = draftAppt?.staffId === s.id && draftAppt?.date === d ? draftAppt : null;
                    return (
                      <div key={d} className="flex-1 relative border-r border-neutral-100 last:border-0 cursor-crosshair"
                        onClick={e => { if (!colDraft) handleGridClick(e, s.id, d); else setDraftAppt(null); }}
                        onPointerDown={e => handlePointerDown(e, s.id, d)}
                        onPointerMove={e => handlePointerMove(e, s.id, d)}
                        onPointerUp={e => handlePointerUp(e, s.id, d)}
                        onPointerCancel={() => setDrag(null)}>
                        <WorkingOverlay staff={s} dow={dayOfWeek(d)} />
                        {colDrag && dragDist >= 6 && (
                          <div className="absolute left-0.5 right-0.5 bg-amber-300/40 border-2 border-dashed border-amber-500 rounded-lg pointer-events-none z-20 flex flex-col justify-start px-1.5 py-1"
                            style={{ top: Math.min(colDrag.startY, colDrag.endY), height: Math.max(dragDist, 8) }}>
                            {dragDist > 20 && (
                              <span className="text-[10px] font-bold text-amber-900 leading-tight">
                                {yToTimeFn(Math.min(colDrag.startY, colDrag.endY), hourHeight)}
                              </span>
                            )}
                          </div>
                        )}
                        {colDraft && (
                          <DraftApptBlock
                            startY={colDraft.startY}
                            staffName={s.name}
                            date={d}
                            onMove={y => setDraftAppt(prev => prev ? { ...prev, startY: y } : null)}
                            onConfirm={() => { setNewAppt({ staffId: s.id, date: d, time: yToTimeFn(colDraft.startY, hourHeight) }); setDraftAppt(null); }}
                            onAddBreak={() => { setAddBreak({ staffId: s.id, date: d, time: yToTimeFn(colDraft.startY, hourHeight) }); setDraftAppt(null); }}
                            onDismiss={() => setDraftAppt(null)}
                          />
                        )}
                        {getAppts(s.id, d).map(a => (
                          <ApptBlock key={a.id} appt={a} colorClass={COLORS[si % COLORS.length].light}
                            onClick={() => setSelectedAppt(a)} />
                        ))}
                      </div>
                    );
                  })
                }
              </div>
            </div>
          </HHCtx.Provider>
        </div>
      </div>
    );
  }

  const monthLabel = new Date(date).toLocaleDateString("he-IL", { month: "long", year: "numeric" });
  const dateLabel = view === "month" ? monthLabel
    : view === "day" ? fmtDay(date)
    : `${fmtShort(dates[0])} – ${fmtShort(dates[dates.length - 1])}`;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-white border-b border-neutral-200 shrink-0 flex-wrap gap-y-1.5">
        {/* Navigation */}
        <button onClick={() => navigate(-1)} className="w-8 h-8 rounded-lg hover:bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">◀</button>
        <button onClick={() => setDate(todayISO())} className="text-xs font-medium text-amber-600 hover:underline px-1 shrink-0">היום</button>
        <button onClick={() => navigate(1)} className="w-8 h-8 rounded-lg hover:bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">▶</button>

        {/* Date label */}
        {view === "day" ? (
          <button
            className="font-semibold text-neutral-800 text-sm flex-1 min-w-0 truncate text-right hover:text-amber-600 transition"
            onClick={() => setDayMenu({ date, staffId: displayedStaff[0]?.id || allStaff[0]?.id || "" })}>
            {dateLabel}
          </button>
        ) : (
          <span className="font-semibold text-neutral-800 text-sm flex-1 min-w-0 truncate">{dateLabel}</span>
        )}

        {/* Refresh — hidden on mobile to save space */}
        <button onClick={loadAppointments} className="hidden sm:flex w-8 h-8 rounded-lg hover:bg-neutral-100 text-neutral-500 items-center justify-center shrink-0" title="רענן">
          🔄
        </button>

        {/* Week barber picker (only in week/3day view) */}
        {(view === "week" || view === "3day") && (
          <select value={weekBarber} onChange={e => setWeekBarber(e.target.value)}
            className="border border-neutral-200 rounded-lg px-2 py-1 text-xs text-neutral-700 max-w-[110px]">
            {allStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        {/* View switcher — compact on mobile */}
        <div className="flex bg-neutral-100 rounded-lg p-0.5 shrink-0">
          {(["day","3day","week","month"] as ViewType[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2 py-1 text-[11px] rounded-md font-medium transition ${view === v ? "bg-white shadow text-neutral-900" : "text-neutral-500"} ${v === "3day" ? "hidden sm:block" : ""}`}>
              {v === "day" ? "יום" : v === "3day" ? "3י" : v === "week" ? "שבוע" : "חודש"}
            </button>
          ))}
        </div>

        {/* Day view barber filter */}
        {view === "day" && (
          <div className="relative shrink-0">
            <button onClick={() => setShowFilter(!showFilter)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${showFilter ? "bg-amber-500 text-neutral-950 border-amber-400" : "bg-white border-neutral-200 text-neutral-600"}`}>
              ✂️ {visibleStaff.length === allStaff.length ? "הכל" : `${visibleStaff.length}`}
            </button>
            {showFilter && (
              <div className="absolute left-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-neutral-200 p-2 w-48 z-30">
                <div className="flex items-center justify-between mb-1 px-1">
                  <span className="text-xs font-semibold text-neutral-700">ספרים</span>
                  <button onClick={() => setVisibleStaff(allStaff.map(s => s.id))} className="text-[11px] text-amber-600">הכל</button>
                </div>
                {allStaff.map((s, si) => (
                  <label key={s.id} className="flex items-center gap-2 px-1 py-1.5 cursor-pointer rounded-lg hover:bg-neutral-50">
                    <input type="checkbox" checked={visibleStaff.includes(s.id)}
                      onChange={e => setVisibleStaff(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))}
                      className="accent-amber-500" />
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${COLORS[si % COLORS.length].bg}`}>{s.name[0]}</div>
                    <span className="text-xs text-neutral-800">{s.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* New appointment button */}
        <button onClick={() => setNewAppt({ staffId: allStaff[0]?.id || "", date, time: "10:00" })}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-neutral-950 rounded-lg text-xs font-semibold hover:bg-amber-400 transition shrink-0">
          + תור
        </button>
      </div>

      {/* ── Calendar body ── */}
      {loading && appointments.length === 0
        ? <div className="flex-1 flex items-center justify-center text-neutral-400">טוען...</div>
        : view === "month" ? renderMonth() : renderTimeGrid()
      }

      {/* ── Modals ── */}
      {selectedAppt && <ApptModal appt={selectedAppt} onClose={() => setSelectedAppt(null)} onChange={handleStatusChange} onReload={loadAppointments} />}
      {newAppt && (
        <NewApptModal
          staff={allStaff.find(s => s.id === newAppt.staffId) || null}
          allStaff={allStaff} services={services}
          date={newAppt.date} time={newAppt.time}
          onClose={() => setNewAppt(null)} onSaved={loadAppointments}
        />
      )}
      {addBreak && (
        <AddBreakModal
          staffId={addBreak.staffId}
          date={addBreak.date}
          defaultTime={addBreak.time}
          onClose={() => setAddBreak(null)}
          onSaved={loadAppointments}
        />
      )}
      {dayMenu && <DayPanel date={dayMenu.date} staffId={dayMenu.staffId} onClose={() => setDayMenu(null)} onRefresh={loadAppointments} />}
    </div>
  );
}
