"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────
const HOUR_HEIGHT = 64;
const DAY_START = 8;
const DAY_END = 21;
const TOTAL_HOURS = DAY_END - DAY_START;
const TOTAL_HEIGHT = TOTAL_HOURS * HOUR_HEIGHT;

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
const apptTop = (t: string) => ((toMin(t) - DAY_START * 60) / 60) * HOUR_HEIGHT;
const apptH = (s: string, e: string) => Math.max(((toMin(e) - toMin(s)) / 60) * HOUR_HEIGHT, 20);
const nowPx = () => { const n = new Date(); return ((n.getHours() * 60 + n.getMinutes() - DAY_START * 60) / 60) * HOUR_HEIGHT; };
const yToTime = (y: number) => {
  const mins = Math.round((y / HOUR_HEIGHT) * 60 / 30) * 30 + DAY_START * 60;
  return minToTime(Math.max(DAY_START * 60, Math.min(DAY_END * 60 - 30, mins)));
};

// ── Types ─────────────────────────────────────────────────────────────────────
type Schedule = { dayOfWeek: number; isWorking: boolean; slots: string; breaks: string | null };
type Staff = { id: string; name: string; avatarUrl: string | null; isAvailable: boolean; schedules: Schedule[] };
type Service = { id: string; name: string; price: number; durationMinutes: number };
type Appt = {
  id: string; startTime: string; endTime: string; status: string; price: number; date: string;
  note: string | null; staffNote: string | null;
  customer: { name: string; phone: string };
  staff: { id: string; name: string };
  service: { name: string; durationMinutes: number };
};
type Customer = { id: string; name: string; phone: string };
type ViewType = "day" | "3day" | "week" | "month";

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
        const top = ((seg.start - dayStartMin) / 60) * HOUR_HEIGHT;
        const height = ((seg.end - seg.start) / 60) * HOUR_HEIGHT;
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
  const top = apptTop(appt.startTime);
  const height = apptH(appt.startTime, appt.endTime);
  return (
    <div className={`absolute left-0.5 right-0.5 rounded-lg border cursor-pointer hover:opacity-85 transition overflow-hidden px-1.5 py-1 z-10 ${colorClass}`}
      style={{ top, height }} onClick={e => { e.stopPropagation(); onClick(); }}>
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
  const [form, setForm] = useState({ staffId: staff?.id || "", serviceId: "", date, time, note: "" });
  const [customerMode, setCustomerMode] = useState<"search" | "new">("search");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customerQuery.length < 1) { setCustomers([]); return; }
    fetch(`/api/admin/customers?q=${encodeURIComponent(customerQuery)}`).then(r => r.json()).then(setCustomers);
  }, [customerQuery]);

  const selectedService = services.find(s => s.id === form.serviceId);
  const endTime = selectedService
    ? minToTime(toMin(form.time) + selectedService.durationMinutes) : "";

  async function save() {
    if (!form.staffId || !form.serviceId || !form.date || !form.time) return;
    const phone = selectedCustomer?.phone || newCustomer.phone;
    const name = selectedCustomer?.name || newCustomer.name;
    if (!phone || !name) return;
    setSaving(true);
    const res = await fetch("/api/admin/appointments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, phone, customerName: name }),
    });
    if (res.ok) { onSaved(); onClose(); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-neutral-100">
          <h3 className="font-bold text-neutral-900 text-lg">קביעת תור</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-neutral-100">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Date & time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">תאריך</label>
              <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" dir="ltr" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">שעה</label>
              <input type="time" value={form.time} onChange={e => setForm(p => ({ ...p, time: e.target.value }))}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" dir="ltr" />
            </div>
          </div>

          {/* Staff */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">ספר</label>
            <select value={form.staffId} onChange={e => setForm(p => ({ ...p, staffId: e.target.value }))}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm">
              <option value="">בחר ספר...</option>
              {allStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

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

        <div className="px-5 pb-5">
          <button onClick={save} disabled={saving || !form.staffId || !form.serviceId ||
            !(selectedCustomer || (newCustomer.name && newCustomer.phone))}
            className="w-full bg-amber-500 text-neutral-950 py-3 rounded-xl font-semibold hover:bg-amber-400 disabled:opacity-40 transition">
            {saving ? "שומר..." : "קבע תור"}
          </button>
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

function ApptModal({ appt, onClose, onChange }: { appt: Appt; onClose: () => void; onChange: (id: string, status: string) => void }) {
  const [updating, setUpdating] = useState(false);
  const [staffNote, setStaffNote] = useState(appt.staffNote || "");
  const [savingNote, setSavingNote] = useState(false);
  const meta = STATUS_META[appt.status] || { label: appt.status, badgeClass: "bg-neutral-100 text-neutral-500" };

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
            <p className="font-medium text-neutral-800">{appt.startTime}–{appt.endTime}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-400 mb-0.5">מחיר</p>
            <p className="font-bold text-amber-600">₪{appt.price}</p>
          </div>
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

        {/* Payment & messaging actions */}
        <div className="px-5 py-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button className="py-2.5 rounded-xl bg-violet-50 text-violet-700 text-sm font-medium border border-violet-200 hover:bg-violet-100 transition">
              🔗 קישור תשלום
            </button>
            <button className="py-2.5 rounded-xl bg-neutral-50 text-neutral-700 text-sm font-medium border border-neutral-200 hover:bg-neutral-100 transition">
              🧾 הפק קבלה
            </button>
          </div>
          <a href={`https://wa.me/${cleanPhone}?text=${encodeURIComponent(`שלום ${appt.customer.name}, תורך ב${fmtDay(appt.date)} בשעה ${appt.startTime} אצל ${appt.staff.name}`)}`}
            target="_blank"
            className="block w-full py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-medium text-center hover:bg-emerald-600 transition">
            💬 שלח תזכורת ב-WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Day Override Modal ────────────────────────────────────────────────────────
function DayMenu({ date, staffId, onClose, onRefresh }: { date: string; staffId: string; onClose: () => void; onRefresh: () => void }) {
  const [mode, setMode] = useState<"menu" | "hours">("menu");
  const [hours, setHours] = useState({ isWorking: true, start: "09:00", end: "20:00" });
  const [saving, setSaving] = useState(false);

  async function closeDay() {
    setSaving(true);
    await fetch(`/api/admin/staff/${staffId}/schedule/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, isWorking: false }),
    });
    setSaving(false); onClose(); onRefresh();
  }

  async function saveHours() {
    setSaving(true);
    await fetch(`/api/admin/staff/${staffId}/schedule/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, isWorking: true, slots: [{ start: hours.start, end: hours.end }] }),
    });
    setSaving(false); onClose(); onRefresh();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xs shadow-2xl" onClick={e => e.stopPropagation()}>
        {mode === "menu" ? (
          <>
            <div className="px-5 pt-5 pb-3 border-b border-neutral-100">
              <h3 className="font-bold">{fmtShort(date)}</h3>
            </div>
            <div className="divide-y divide-neutral-100">
              <button onClick={() => setMode("hours")} className="w-full text-right px-5 py-4 hover:bg-neutral-50 text-sm font-medium">✏️ עריכת שעות היום</button>
              <button onClick={closeDay} disabled={saving} className="w-full text-right px-5 py-4 hover:bg-red-50 text-sm font-medium text-red-600 disabled:opacity-50">🔒 סגור יום זה</button>
              <button onClick={onClose} className="w-full text-right px-5 py-4 hover:bg-neutral-50 text-sm text-neutral-400">ביטול</button>
            </div>
          </>
        ) : (
          <>
            <div className="px-5 pt-5 pb-3 border-b border-neutral-100">
              <h3 className="font-bold">עריכת שעות – {fmtShort(date)}</h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">מ</label>
                  <input type="time" value={hours.start} onChange={e => setHours(p => ({ ...p, start: e.target.value }))}
                    className="w-full border border-neutral-200 rounded-lg px-2 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">עד</label>
                  <input type="time" value={hours.end} onChange={e => setHours(p => ({ ...p, end: e.target.value }))}
                    className="w-full border border-neutral-200 rounded-lg px-2 py-2 text-sm" />
                </div>
              </div>
              <button onClick={saveHours} disabled={saving}
                className="w-full bg-amber-500 text-neutral-950 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? "שומר..." : "שמור"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Time Column ───────────────────────────────────────────────────────────────
function TimeColumn() {
  return (
    <div className="w-14 shrink-0 relative select-none" style={{ height: TOTAL_HEIGHT }}>
      {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
        <div key={i} className="absolute right-2 text-[11px] text-neutral-400 font-mono" style={{ top: i * HOUR_HEIGHT - 7 }}>
          {String(DAY_START + i).padStart(2, "0")}:00
        </div>
      ))}
    </div>
  );
}

// ── Grid Lines ────────────────────────────────────────────────────────────────
function GridLines() {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {Array.from({ length: TOTAL_HOURS * 2 + 1 }, (_, i) => (
        <div key={i} className={`absolute left-0 right-0 border-t ${i % 2 === 0 ? "border-neutral-200" : "border-neutral-100 border-dashed"}`}
          style={{ top: i * (HOUR_HEIGHT / 2) }} />
      ))}
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
  const [dayMenu, setDayMenu] = useState<{ date: string; staffId: string } | null>(null);
  const [nowY, setNowY] = useState(nowPx());
  const [hoverY, setHoverY] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const t = setInterval(() => setNowY(nowPx()), 60_000);
    return () => clearInterval(t);
  }, []);

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
    if (gridRef.current && !loading) gridRef.current.scrollTop = Math.max(nowY - 120, 0);
  }, [loading]);

  function navigate(dir: -1 | 1) {
    const step = view === "day" ? 1 : view === "3day" ? 3 : 7;
    setDate(addDays(date, dir * step));
  }

  const displayedStaff = allStaff.filter(s => visibleStaff.includes(s.id));
  const weekStaff = allStaff.find(s => s.id === weekBarber) || allStaff[0];
  const dates = getDates();

  function getAppts(staffId: string, d: string) {
    return appointments.filter(a =>
      a.staff.id === staffId && a.date.startsWith(d) &&
      !["cancelled_by_customer", "cancelled_by_staff"].includes(a.status)
    );
  }

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>, staffId: string, d: string) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const time = yToTime(y);
    setNewAppt({ staffId, date: d, time });
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
                onClick={() => { setDate(cell); setView("day"); }}>
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
    const columns = isDay ? displayedStaff : dates;

    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Column headers */}
        <div className="flex border-b border-neutral-200 bg-white shrink-0">
          <div className="w-14 shrink-0" />
          {isDay
            ? displayedStaff.map((s, si) => (
              <div key={s.id} className="flex-1 min-w-0 flex flex-col items-center py-2 border-r border-neutral-100 last:border-0">
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
                <div key={d} className="flex-1 min-w-0 flex flex-col items-center py-2 border-r border-neutral-100 last:border-0 cursor-pointer hover:bg-neutral-50"
                  onClick={() => setDayMenu({ date: d, staffId: staffForDay?.id || "" })}>
                  <span className={`text-xs font-semibold ${isToday ? "text-amber-600" : "text-neutral-500"}`}>{fmtShort(d)}</span>
                  {isToday && <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-0.5" />}
                </div>
              );
            })
          }
        </div>

        {/* Scrollable grid */}
        <div ref={gridRef} className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex" style={{ height: TOTAL_HEIGHT }}>
            <TimeColumn />
            <div className="flex flex-1 relative">
              <GridLines />
              {/* Now line */}
              {dates.includes(todayISO()) && nowY >= 0 && nowY <= TOTAL_HEIGHT && (
                <div className="absolute left-0 right-0 z-20 pointer-events-none flex items-center" style={{ top: nowY }}>
                  <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  <div className="flex-1 border-t-2 border-red-400" />
                </div>
              )}

              {isDay
                ? displayedStaff.map((s, si) => (
                  <div key={s.id} className="flex-1 relative border-r border-neutral-100 last:border-0 cursor-crosshair"
                    onClick={e => handleGridClick(e, s.id, date)}
                    onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHoverY(e.clientY - r.top); }}
                    onMouseLeave={() => setHoverY(null)}>
                    <WorkingOverlay staff={s} dow={dayOfWeek(date)} />
                    {hoverY !== null && (
                      <div className="absolute left-0 right-0 pointer-events-none z-10 flex items-center" style={{ top: hoverY }}>
                        <div className="absolute right-1 -top-4 bg-neutral-800 text-white text-[10px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap">
                          {yToTime(hoverY)}
                        </div>
                        <div className="w-full border-t border-dashed border-amber-400 opacity-70" />
                      </div>
                    )}
                    {getAppts(s.id, date).map(a => (
                      <ApptBlock key={a.id} appt={a} colorClass={COLORS[si % COLORS.length].light}
                        onClick={() => setSelectedAppt(a)} />
                    ))}
                  </div>
                ))
                : dates.map(d => {
                  const s = weekStaff;
                  if (!s) return <div key={d} className="flex-1" />;
                  const si = allStaff.findIndex(x => x.id === s.id);
                  return (
                    <div key={d} className="flex-1 relative border-r border-neutral-100 last:border-0 cursor-crosshair"
                      onClick={e => handleGridClick(e, s.id, d)}
                      onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHoverY(e.clientY - r.top); }}
                      onMouseLeave={() => setHoverY(null)}>
                      <WorkingOverlay staff={s} dow={dayOfWeek(d)} />
                      {hoverY !== null && (
                        <div className="absolute left-0 right-0 pointer-events-none z-10 flex items-center" style={{ top: hoverY }}>
                          <div className="absolute right-1 -top-4 bg-neutral-800 text-white text-[10px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap">
                            {yToTime(hoverY)}
                          </div>
                          <div className="w-full border-t border-dashed border-amber-400 opacity-70" />
                        </div>
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
      <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-neutral-200 shrink-0 flex-wrap gap-y-2">
        <button onClick={() => navigate(-1)} className="w-8 h-8 rounded-lg hover:bg-neutral-100 text-neutral-500 flex items-center justify-center">◀</button>
        <button onClick={() => setDate(todayISO())} className="text-xs font-medium text-amber-600 hover:underline px-1">היום</button>
        <button onClick={() => navigate(1)} className="w-8 h-8 rounded-lg hover:bg-neutral-100 text-neutral-500 flex items-center justify-center">▶</button>
        <span className="font-semibold text-neutral-800 text-sm flex-1 min-w-0 truncate">{dateLabel}</span>

        {/* Refresh */}
        <button onClick={loadAppointments} className="w-8 h-8 rounded-lg hover:bg-neutral-100 text-neutral-500 flex items-center justify-center" title="רענן">
          🔄
        </button>

        {/* Week barber picker (only in week/3day view) */}
        {(view === "week" || view === "3day") && (
          <select value={weekBarber} onChange={e => setWeekBarber(e.target.value)}
            className="border border-neutral-200 rounded-lg px-2 py-1 text-xs text-neutral-700">
            {allStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        {/* View switcher */}
        <div className="flex bg-neutral-100 rounded-lg p-0.5">
          {(["day","3day","week","month"] as ViewType[]).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition ${view === v ? "bg-white shadow text-neutral-900" : "text-neutral-500"}`}>
              {v === "day" ? "יום" : v === "3day" ? "3 ימים" : v === "week" ? "שבוע" : "חודש"}
            </button>
          ))}
        </div>

        {/* Day view barber filter */}
        {view === "day" && (
          <div className="relative">
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
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-neutral-950 rounded-lg text-xs font-semibold hover:bg-amber-400 transition">
          + תור
        </button>
      </div>

      {/* ── Calendar body ── */}
      {loading && appointments.length === 0
        ? <div className="flex-1 flex items-center justify-center text-neutral-400">טוען...</div>
        : view === "month" ? renderMonth() : renderTimeGrid()
      }

      {/* ── Modals ── */}
      {selectedAppt && <ApptModal appt={selectedAppt} onClose={() => setSelectedAppt(null)} onChange={handleStatusChange} />}
      {newAppt && (
        <NewApptModal
          staff={allStaff.find(s => s.id === newAppt.staffId) || null}
          allStaff={allStaff} services={services}
          date={newAppt.date} time={newAppt.time}
          onClose={() => setNewAppt(null)} onSaved={loadAppointments}
        />
      )}
      {dayMenu && <DayMenu date={dayMenu.date} staffId={dayMenu.staffId} onClose={() => setDayMenu(null)} onRefresh={loadAppointments} />}
    </div>
  );
}
