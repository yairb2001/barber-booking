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
  { bg: "bg-sky-500",    light: "bg-sky-100 text-sky-900 border-sky-300" },
  { bg: "bg-emerald-500",light: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  { bg: "bg-indigo-500", light: "bg-indigo-100 text-indigo-900 border-indigo-300" },
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

// ── Saved calendar preferences (view / zoom / week barber) ───────────────────
// Stored in localStorage so the calendar opens in the same state next time.
const PREFS_KEY = "admin.calendar.prefs";
type CalendarPrefs = { view?: "day" | "3day" | "week" | "month"; hourHeight?: number; weekBarber?: string };
const loadPrefs = (): CalendarPrefs => {
  if (typeof window === "undefined") return {};
  try { const raw = localStorage.getItem(PREFS_KEY); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
};
const savePrefs = (patch: Partial<CalendarPrefs>) => {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch })); }
  catch { /* quota / disabled — ignore */ }
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

// Swap-flow types ────────────────────────────────────────────────────────────
type SwapStatus = "pending_response" | "accepted_by_customer" | "rejected_by_customer" | "approved" | "cancelled" | "expired";
type SwapKind = "swap" | "move";
type SwapProposal = {
  id: string;
  kind: SwapKind;
  status: SwapStatus;
  primaryAppointmentId: string;
  candidateAppointmentId: string | null;
  targetStaffId: string | null;
  targetDate: string | null;
  targetStartTime: string | null;
  rawResponse: string | null;
  createdAt: string;
  respondedAt: string | null;
  approvedAt: string | null;
  expiresAt: string;
  primary:   Appt;
  candidate: Appt | null;
};
const SWAP_OPEN_STATUSES: SwapStatus[] = ["pending_response", "accepted_by_customer"];

// Selection in "swap mode" — admin picks a mix of swap and move candidates
type SwapModeCandidate =
  | { kind: "swap"; appointmentId: string }
  | { kind: "move"; staffId: string; date: string; startTime: string };
function moveKey(c: { staffId: string; date: string; startTime: string }): string {
  return `${c.staffId}|${c.date}|${c.startTime}`;
}
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
const LONG_PRESS_MS = 500; // hold this long to enter drag-to-move
const LONG_PRESS_TOLERANCE_PX = 10; // movement before threshold cancels long-press (it's a scroll, not a hold)

type ApptBlockSwapState =
  | { kind: "none" }
  | { kind: "swap-mode-primary" }      // currently in swap mode, this is the chosen primary
  | { kind: "swap-mode-selected" }     // currently in swap mode, this appt is selected as candidate
  | { kind: "swap-mode-eligible" }     // currently in swap mode, can be tapped to add as candidate
  | { kind: "swap-mode-disabled" }     // currently in swap mode, but can't be picked (already in another swap)
  | { kind: "pending-swap" }           // appt has open proposal in pending_response state (no agreement yet)
  | { kind: "swap-agreed" };           // appt has open proposal in accepted_by_customer state (awaiting admin approval)

function ApptBlock({ appt, colorClass, onClick, onLongPress, isMoving, swapState }: {
  appt: Appt;
  colorClass: string;
  onClick: () => void;
  onLongPress: (clientX: number, clientY: number) => void;
  isMoving: boolean; // true if THIS appointment is the one being moved → fade out the original
  swapState: ApptBlockSwapState;
}) {
  const hh = React.useContext(HHCtx);
  const top = apptTop(appt.startTime, hh);
  const height = apptH(appt.startTime, appt.endTime, hh);

  // Long-press state — refs (no re-render)
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpStart = useRef<{ x: number; y: number } | null>(null);
  const lpFired = useRef(false);

  function clearLP() {
    if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; }
  }

  // While the calendar is in "select swap candidates" mode, long-press is
  // disabled — taps just toggle selection.
  const longPressEnabled = swapState.kind !== "swap-mode-primary"
    && swapState.kind !== "swap-mode-selected"
    && swapState.kind !== "swap-mode-eligible"
    && swapState.kind !== "swap-mode-disabled";

  // Visual ring + badge based on swap state
  let ringClass = "";
  let badge: { text: string; cls: string } | null = null;
  let extraStyle: React.CSSProperties = {};
  if (swapState.kind === "swap-mode-primary") {
    ringClass = "ring-2 ring-slate-900 ring-offset-1";
    badge = { text: "המקור", cls: "bg-slate-900 text-white" };
  } else if (swapState.kind === "swap-mode-selected") {
    ringClass = "ring-2 ring-teal-500 ring-offset-1";
    badge = { text: "✓ נבחר", cls: "bg-teal-500 text-white" };
  } else if (swapState.kind === "swap-mode-eligible") {
    extraStyle = { opacity: 0.85 };
    badge = { text: "+ הוסף", cls: "bg-white/90 text-neutral-700 border border-neutral-300" };
  } else if (swapState.kind === "swap-mode-disabled") {
    extraStyle = { opacity: 0.35 };
  } else if (swapState.kind === "pending-swap") {
    ringClass = "ring-2 ring-orange-400 ring-offset-1";
    extraStyle = { borderStyle: "dashed", borderColor: "#fb923c" };
    badge = { text: "⏳", cls: "bg-orange-400 text-white" };
  } else if (swapState.kind === "swap-agreed") {
    ringClass = "ring-2 ring-emerald-500 animate-pulse";
    badge = { text: "✅ אישר", cls: "bg-emerald-500 text-white" };
  }

  return (
    <div className={`absolute left-0.5 right-0.5 rounded-lg border cursor-pointer hover:opacity-85 transition-opacity overflow-hidden px-1.5 py-1 z-10 ${colorClass} ${isMoving ? "opacity-30" : ""} ${ringClass}`}
      style={{ top, height, touchAction: "none", ...extraStyle }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => {
        e.stopPropagation();
        if (!longPressEnabled) return; // no long-press in swap mode
        lpStart.current = { x: e.clientX, y: e.clientY };
        lpFired.current = false;
        clearLP();
        lpTimer.current = setTimeout(() => {
          lpFired.current = true;
          onLongPress(e.clientX, e.clientY);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={e => {
        if (lpFired.current || !lpStart.current) return;
        const dx = Math.abs(e.clientX - lpStart.current.x);
        const dy = Math.abs(e.clientY - lpStart.current.y);
        if (dx > LONG_PRESS_TOLERANCE_PX || dy > LONG_PRESS_TOLERANCE_PX) clearLP();
      }}
      onPointerUp={e => {
        e.stopPropagation();
        clearLP();
        // If long-press didn't fire — it was a tap → handle click
        if (!lpFired.current) onClick();
        lpStart.current = null;
        lpFired.current = false;
      }}
      onPointerCancel={() => { clearLP(); lpStart.current = null; lpFired.current = false; }}>
      {badge && (
        <span className={`absolute top-0.5 left-0.5 z-10 text-[9px] font-bold px-1 py-px rounded ${badge.cls}`}>{badge.text}</span>
      )}
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
  // Referral tracking — required when creating a NEW customer (parity with /book/confirm)
  const [referralSource, setReferralSource] = useState("");
  const [referrerPhone, setReferrerPhone] = useState("");
  const [referralOptions, setReferralOptions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (customerQuery.length < 1) { setCustomers([]); return; }
    fetch(`/api/admin/customers?q=${encodeURIComponent(customerQuery)}`).then(r => r.json()).then(setCustomers);
  }, [customerQuery]);

  // Load referral source options once (same list as the customer-facing booking flow)
  useEffect(() => {
    fetch("/api/admin/referral-sources")
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setReferralOptions(data); })
      .catch(() => {});
  }, []);

  const selectedService = services.find(s => s.id === form.serviceId);
  const endTime = selectedService
    ? minToTime(toMin(form.time) + selectedService.durationMinutes) : "";

  async function save(override = false) {
    if (!form.staffId || !form.serviceId || !form.date || !form.time) return;
    const phone = selectedCustomer?.phone || newCustomer.phone;
    const name = selectedCustomer?.name || newCustomer.name;
    if (!phone || !name) return;
    // For NEW customers, referral source is required (mirrors customer-facing booking flow)
    if (customerMode === "new" && !referralSource) {
      setErrMsg("נא לבחור מקור הגעה ללקוח החדש");
      return;
    }
    setErrMsg(null);
    setConflictMsg(null);
    setSaving(true);
    const res = await fetch("/api/admin/appointments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        startTime: form.time,
        phone,
        customerName: name,
        // Referral fields are only meaningful for new customers
        referralSource: customerMode === "new" ? referralSource : undefined,
        referrerPhone:  customerMode === "new" && referralSource === "חבר הביא חבר" ? referrerPhone.trim() : undefined,
        override,
      }),
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
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-white font-bold text-base shrink-0">
                {staff.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-sm">{staff.name}</p>
                <p className="text-xs text-slate-700">
                  {new Date(date + "T00:00:00").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}
                  {" · "}
                  {form.time}
                  {endTime && ` – ${endTime}`}
                </p>
              </div>
              <div className="text-slate-700 text-lg">✂️</div>
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
                  className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-900" dir="ltr" />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">שעה</label>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => {
                    const [h, m] = form.time.split(":").map(Number);
                    const total = Math.max(DAY_START * 60, h * 60 + m - 5);
                    setForm(p => ({ ...p, time: minToTime(total) }));
                  }} className="w-8 h-9 border border-slate-200 bg-slate-50 rounded-lg text-slate-700 hover:bg-slate-100 flex items-center justify-center text-sm">−</button>
                  <input type="time" value={form.time} onChange={e => setForm(p => ({ ...p, time: e.target.value }))}
                    className="flex-1 border border-slate-200 bg-slate-50 rounded-lg px-2 py-2 text-sm text-slate-900" dir="ltr" />
                  <button type="button" onClick={() => {
                    const [h, m] = form.time.split(":").map(Number);
                    const total = Math.min(DAY_END * 60, h * 60 + m + 5);
                    setForm(p => ({ ...p, time: minToTime(total) }));
                  }} className="w-8 h-9 border border-slate-200 bg-slate-50 rounded-lg text-slate-700 hover:bg-slate-100 flex items-center justify-center text-sm">+</button>
                </div>
              </div>
            </div>
          )}

          {/* Staff */}
          {fromGrid ? (
            <div>
              <label className="text-xs text-neutral-500 block mb-1">ספר</label>
              <div className="flex items-center gap-2 border border-slate-200 bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-slate-900 flex-1">{selectedStaff?.name}</span>
                <button onClick={() => {/* allow changing */}} className="text-xs text-slate-900 underline"
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
                  className={`px-2 py-0.5 rounded-full ${customerMode === "search" ? "bg-slate-100 text-slate-700" : "text-neutral-400"}`}>
                  חיפוש
                </button>
                <button onClick={() => setCustomerMode("new")}
                  className={`px-2 py-0.5 rounded-full ${customerMode === "new" ? "bg-slate-100 text-slate-700" : "text-neutral-400"}`}>
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

                {/* Referral source — required for new customers */}
                <div className="pt-1">
                  <label className="text-[11px] text-neutral-500 block mb-1">
                    מקור הגעה <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={referralSource}
                    onChange={e => setReferralSource(e.target.value)}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">איך הוא הגיע אלינו?</option>
                    {referralOptions.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* If "friend referred friend" — collect referrer's phone */}
                {referralSource === "חבר הביא חבר" && (
                  <input
                    value={referrerPhone}
                    onChange={e => setReferrerPhone(e.target.value)}
                    placeholder="טלפון של מי שהפנה (אופציונלי)"
                    dir="ltr"
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm"
                  />
                )}

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
            <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <p className="text-slate-900">{conflictMsg}</p>
              <div className="flex gap-2">
                <button onClick={() => save(true)} disabled={saving}
                  className="flex-1 bg-slate-900 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-slate-800">
                  כן, קבע בכל זאת
                </button>
                <button onClick={() => setConflictMsg(null)}
                  className="flex-1 bg-white border border-slate-300 text-slate-700 rounded-lg py-1.5 text-xs">
                  ביטול
                </button>
              </div>
            </div>
          )}
          <button onClick={() => save(false)} disabled={saving || !!conflictMsg || !form.staffId || !form.serviceId ||
            !(selectedCustomer || (newCustomer.name && newCustomer.phone)) ||
            (customerMode === "new" && !referralSource)}
            className="w-full bg-teal-600 text-white py-3 rounded-xl font-semibold hover:bg-teal-700 disabled:opacity-40 transition">
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
            className="flex-1 bg-teal-600 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
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
  pending:             { label: "ממתין",    badgeClass: "bg-slate-100 text-slate-700" },
  completed:           { label: "הושלם",    badgeClass: "bg-teal-100 text-teal-700" },
  cancelled_by_staff:  { label: "בוטל",     badgeClass: "bg-red-100 text-red-500" },
  cancelled_by_customer: { label: "בוטל ע״י לקוח", badgeClass: "bg-red-100 text-red-500" },
  no_show:             { label: "לא הגיע", badgeClass: "bg-neutral-100 text-neutral-500" },
};

function ApptModal({ appt, onClose, onChange, onReload, onEnterSwapMode, onMarkSwap, onApproveSwap }: {
  appt: Appt; onClose: () => void;
  onChange: (id: string, status: string) => void;
  onReload?: () => void;
  onEnterSwapMode: (apptId: string) => void;
  onMarkSwap: (proposalId: string, action: "mark_accepted" | "mark_rejected" | "cancel") => Promise<void>;
  onApproveSwap: (proposalId: string) => Promise<void>;
}) {
  const [updating, setUpdating] = useState(false);
  const [staffNote, setStaffNote] = useState(appt.staffNote || "");
  const [savingNote, setSavingNote] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [referralSource, setReferralSource] = useState(appt.customer.referralSource || "");
  const [editingReferral, setEditingReferral] = useState(false);
  const [savingReferral, setSavingReferral] = useState(false);
  const [referralOptions, setReferralOptions] = useState<string[]>([]);

  // Active swap proposals where this appointment is involved
  const [proposalsAsPrimary, setProposalsAsPrimary] = useState<SwapProposal[]>([]);
  const [proposalAsCandidate, setProposalAsCandidate] = useState<SwapProposal | null>(null);

  // Delay notification
  const [showDelayInput, setShowDelayInput] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState("");
  const [delaySending, setDelaySending] = useState(false);
  const [delaySent, setDelaySent] = useState(false);

  useEffect(() => {
    fetch("/api/admin/referral-sources").then(r => r.json()).then(setReferralOptions).catch(() => {});
  }, []);

  // Load swap proposals involving this appointment
  useEffect(() => {
    fetch(`/api/admin/swap-proposals?status=open&primaryAppointmentId=${appt.id}`)
      .then(r => r.ok ? r.json() : [])
      .then((d: SwapProposal[]) => setProposalsAsPrimary(Array.isArray(d) ? d : []))
      .catch(() => {});
    // Also check if this appt is a candidate in someone else's swap
    fetch(`/api/admin/swap-proposals?status=open`)
      .then(r => r.ok ? r.json() : [])
      .then((all: SwapProposal[]) => {
        const cand = Array.isArray(all)
          ? all.find(p => p.candidateAppointmentId === appt.id) ?? null
          : null;
        setProposalAsCandidate(cand);
      })
      .catch(() => {});
  }, [appt.id]);

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

  async function sendDelayNotification() {
    const mins = parseInt(delayMinutes, 10);
    if (!mins || mins <= 0) return;
    setDelaySending(true);
    const r = await fetch(`/api/admin/appointments/${appt.id}/notify-delay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delayMinutes: mins }),
    });
    setDelaySending(false);
    if (r.ok) {
      setDelaySent(true);
      setShowDelayInput(false);
      setDelayMinutes("");
      setTimeout(() => setDelaySent(false), 3000);
    }
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
            <p className="font-bold text-slate-800">₪{appt.price}</p>
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
                className="text-xs text-slate-800 hover:underline">
                {referralSource ? "ערוך" : "הוסף"}
              </button>
            )}
          </div>
          {editingReferral ? (
            <div className="flex gap-2">
              <select value={referralSource} onChange={e => setReferralSource(e.target.value)}
                className="flex-1 border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 bg-white">
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
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-300" />
          {staffNote !== (appt.staffNote || "") && (
            <button onClick={saveNote} disabled={savingNote}
              className="mt-1 text-xs text-slate-800 hover:underline disabled:opacity-50">
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
              { v: "completed",          l: "✔ הושלם",   c: "bg-teal-50 text-teal-700 border border-teal-200" },
              { v: "no_show",            l: "לא הגיע",  c: "bg-neutral-50 text-neutral-600 border border-neutral-200" },
              { v: "cancelled_by_staff", l: "בטל תור",  c: "bg-red-50 text-red-600 border border-red-200" },
            ].map(({ v, l, c }) => (
              <button key={v} disabled={appt.status === v || updating} onClick={() => setStatus(v)}
                className={`py-2 rounded-xl text-sm font-medium transition disabled:opacity-40 disabled:cursor-default ${c}`}>{l}</button>
            ))}
          </div>
        </div>

        {/* ── Swap panel ── */}
        <div className="px-5 py-3 border-b border-neutral-100">
          {/* Case 1: appointment is currently a candidate in someone else's swap proposal */}
          {proposalAsCandidate && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 mb-3">
              <p className="text-xs font-semibold text-slate-900">
                🔄 הוצעה החלפה ללקוח זה
              </p>
              <p className="text-[12px] text-slate-800 leading-relaxed">
                לקוח אחר ({proposalAsCandidate.primary.customer.name}) מבקש להחליף לתור הזה.
                סטטוס: {proposalAsCandidate.status === "pending_response" ? "ממתין לתשובה" : "אישר את ההחלפה"}.
              </p>
              {proposalAsCandidate.status === "pending_response" && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={() => onMarkSwap(proposalAsCandidate.id, "mark_accepted").then(onClose)}
                    className="py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold">
                    ✓ סמן שהסכים
                  </button>
                  <button
                    onClick={() => onMarkSwap(proposalAsCandidate.id, "mark_rejected").then(onClose)}
                    className="py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 text-xs font-bold">
                    ✗ סמן שדחה
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Case 2: this appointment is the PRIMARY in active proposals — show candidate list + actions */}
          {proposalsAsPrimary.length > 0 && (
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 space-y-2 mb-3">
              <p className="text-xs font-semibold text-teal-900">
                🔄 ההצעה שלך לחיפוש החלפה ({proposalsAsPrimary.length} מועמדים)
              </p>
              <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                {proposalsAsPrimary.map(p => {
                  // Discriminate label based on proposal kind
                  const isMove = p.kind === "move";
                  const targetDateStr = isMove
                    ? (p.targetDate ? new Date(p.targetDate).toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" }) : "")
                    : (p.candidate ? new Date(p.candidate.date).toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" }) : "");
                  const targetTime = isMove ? (p.targetStartTime || "") : (p.candidate?.startTime || "");
                  const headerLabel = isMove
                    ? "🕒 העברה לשעה ריקה"
                    : (p.candidate?.customer.name || "—");
                  const subLabel = isMove ? "מעבר לזמן פנוי ביומן" : "החלפה עם לקוח";
                  return (
                    <li key={p.id} className={`rounded-lg px-2.5 py-2 border ${isMove ? "bg-teal-50 border-teal-200" : "bg-white border-teal-100"}`}>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-neutral-800 truncate">
                            {headerLabel}
                          </p>
                          <p className="text-[11px] text-neutral-500">
                            {targetDateStr} · {targetTime}
                            <span className="text-neutral-400"> · {subLabel}</span>
                          </p>
                        </div>
                        {p.status === "pending_response" && (
                          <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">⏳ ממתין</span>
                        )}
                        {p.status === "accepted_by_customer" && (
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">✓ אישר</span>
                        )}
                      </div>
                      {p.status === "pending_response" && (
                        <div className="grid grid-cols-3 gap-1 mt-1.5">
                          <button onClick={() => onMarkSwap(p.id, "mark_accepted").then(() => onReload?.())}
                            className="py-1 rounded text-[10px] bg-emerald-500 hover:bg-emerald-600 text-white font-bold">
                            ✓ הסכים
                          </button>
                          <button onClick={() => onMarkSwap(p.id, "mark_rejected").then(() => onReload?.())}
                            className="py-1 rounded text-[10px] bg-red-100 hover:bg-red-200 text-red-700 font-bold">
                            ✗ דחה
                          </button>
                          <button onClick={() => onMarkSwap(p.id, "cancel").then(() => onReload?.())}
                            className="py-1 rounded text-[10px] bg-neutral-100 hover:bg-neutral-200 text-neutral-600">
                            בטל
                          </button>
                        </div>
                      )}
                      {p.status === "accepted_by_customer" && (
                        <button onClick={() => onApproveSwap(p.id)}
                          className="w-full mt-1.5 py-1.5 rounded bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold">
                          {isMove
                            ? "🤝 אשר העברה (יבוצע ויישלח אישור ללקוח)"
                            : "🤝 אשר החלפה (יבוצע ויישלח אישור לשני הלקוחות)"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Case 3: no active proposals — offer to start one */}
          {proposalsAsPrimary.length === 0 && !proposalAsCandidate && (
            <button
              onClick={() => onEnterSwapMode(appt.id)}
              className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-sm font-bold transition flex items-center justify-center gap-2">
              🔄 החלף / העבר תור (בחר מועמדים או שעה ריקה)
            </button>
          )}
        </div>

        {/* Delay notification */}
        <div className="px-5 py-3 border-b border-neutral-100">
          {delaySent ? (
            <p className="text-sm text-emerald-600 font-medium text-center">✓ עדכון עיכוב נשלח ללקוח</p>
          ) : showDelayInput ? (
            <div className="space-y-2">
              <p className="text-xs text-neutral-500">כמה דקות עיכוב לעדכן את הלקוח?</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={delayMinutes}
                  onChange={e => setDelayMinutes(e.target.value)}
                  placeholder="דקות"
                  className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-teal-300"
                  autoFocus
                />
                <button
                  onClick={sendDelayNotification}
                  disabled={delaySending || !delayMinutes}
                  className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 rounded-lg disabled:opacity-50 transition">
                  {delaySending ? "..." : "שלח"}
                </button>
                <button
                  onClick={() => { setShowDelayInput(false); setDelayMinutes(""); }}
                  className="text-neutral-400 hover:text-neutral-600 px-2 rounded-lg hover:bg-neutral-50 transition">
                  ✕
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowDelayInput(true)}
              className="w-full py-2 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 text-sm font-medium transition flex items-center justify-center gap-2">
              ⏱ עדכון עיכוב
            </button>
          )}
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
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>

          {/* Time + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">שעת התחלה</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} dir="ltr"
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 mb-1 block">משך (דקות)</label>
              <input type="number" min={5} step={5} value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
          </div>
          <div className="text-xs text-neutral-400" dir="ltr">
            {startTime} — {endTime}
          </div>

          {/* Staff */}
          <div>
            <label className="text-xs text-neutral-500 mb-1 block">ספר</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400">
              {allStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Service */}
          <div>
            <label className="text-xs text-neutral-500 mb-1 block">סוג תור</label>
            <select value={serviceId} onChange={e => onServiceChange(e.target.value)}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400">
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
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>

          {/* Customer note */}
          <div>
            <label className="text-xs text-neutral-500 mb-1 block">הערת לקוח</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>

          {err && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{err}</div>}

          {conflict && (
            <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <p className="text-slate-900">{conflict}</p>
              <div className="flex gap-2">
                <button onClick={() => save(true)} disabled={saving}
                  className="flex-1 bg-slate-900 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-slate-800">
                  כן, שמור בכל זאת
                </button>
                <button onClick={() => setConflict(null)}
                  className="flex-1 bg-white border border-slate-300 text-slate-700 rounded-lg py-1.5 text-xs">
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
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === key ? "border-slate-900 text-slate-700" : "border-transparent text-neutral-500"}`}>
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
                  className="flex-1 bg-teal-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
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
                className="w-full border-2 border-dashed border-neutral-200 text-neutral-400 py-2 rounded-xl text-sm hover:border-slate-300 hover:text-slate-800 transition">
                + הוסף הפסקה
              </button>
              {breaks.length > 0 && (
                <button onClick={saveHours} disabled={saving}
                  className="w-full bg-teal-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
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
                          <span className="text-[11px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-md font-medium">{timeLabel}</span>
                        )}
                        {w.isFlexible && (
                          <span className="text-[11px] bg-teal-100 text-teal-600 px-1.5 py-0.5 rounded-md">גמיש בתאריך</span>
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
                  className="w-full bg-teal-600 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-40">
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

// ── Draft Move-Slot Block (swap mode: pick a free time with precision) ────────
// Shown when admin taps an empty slot in swap mode. Draggable, so the user can
// fine-tune the exact minute before confirming. On confirm, adds a "move"
// candidate to the current swap proposal.
function DraftMoveSlotBlock({
  startY, durationMinutes,
  onMove, onConfirm, onDismiss, onDragMoved,
}: {
  startY: number;
  durationMinutes: number;   // must match primary appointment length
  onMove: (y: number) => void;
  onConfirm: (startTime: string) => void;
  onDismiss: () => void;
  onDragMoved?: () => void;
}) {
  const hh = React.useContext(HHCtx);
  const totalH = TOTAL_HOURS * hh;
  const blockH = Math.max((durationMinutes / 60) * hh, 36);
  const clampedTop = Math.max(0, Math.min(totalH - blockH, startY));
  const startTime = yToTimeFn(clampedTop, hh);
  const dragRef = useRef<{ clientY: number; startY: number } | null>(null);

  return (
    <div
      className="absolute left-0.5 right-0.5 z-30 select-none cursor-grab active:cursor-grabbing"
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
      onPointerUp={e => {
        e.stopPropagation();
        if (dragRef.current && Math.abs(e.clientY - dragRef.current.clientY) > 5) {
          onDragMoved?.();
        }
        dragRef.current = null;
      }}
      onPointerCancel={() => { dragRef.current = null; }}
      onClick={e => e.stopPropagation()}>

      <div
        className="w-full h-full rounded-lg flex flex-col justify-between px-2 py-1.5 border-2 border-dashed"
        style={{ borderColor: "#3b82f6", background: "rgba(59,130,246,0.18)", backdropFilter: "blur(4px)" }}>
        {/* Top row: time + dismiss */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-teal-900">{startTime} ↕ גרור לדיוק</span>
          <button className="text-teal-400 hover:text-teal-700 text-xs leading-none"
            onClick={e => { e.stopPropagation(); onDismiss(); }}>✕</button>
        </div>
        {/* Bottom row: confirm */}
        <button
          className="text-[11px] font-semibold text-white bg-teal-500 hover:bg-teal-600 rounded-md px-2 py-1 transition text-center"
          onClick={e => { e.stopPropagation(); onConfirm(startTime); }}>
          + הוסף העברה לכאן
        </button>
      </div>
    </div>
  );
}

// ── Draft Appointment Block (Google-Calendar style click-to-place) ─────────────
function DraftApptBlock({
  startY, staffName,
  onMove, onConfirm, onAddBreak, onDismiss, onDragMoved,
}: {
  startY: number; staffName: string; date: string;
  onMove: (y: number) => void;
  onConfirm: () => void;
  onAddBreak: () => void;
  onDismiss: () => void;
  onDragMoved?: () => void;  // called when block was actually dragged (not just tapped)
}) {
  const hh = React.useContext(HHCtx);
  const totalH = TOTAL_HOURS * hh;
  const blockH = 36; // compact, minimalist — 36px fits buttons comfortably
  const clampedTop = Math.max(0, Math.min(totalH - blockH, startY));
  const time = yToTimeFn(clampedTop, hh);
  const dragRef = useRef<{ clientY: number; startY: number } | null>(null);
  void staffName; // not displayed in compact mode

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
      onPointerUp={e => {
        e.stopPropagation();
        if (dragRef.current && Math.abs(e.clientY - dragRef.current.clientY) > 5) {
          // Real drag ended — the browser will fire a click on whatever grid cell
          // is under the cursor. Tell the parent to ignore it.
          onDragMoved?.();
        }
        dragRef.current = null;
      }}
      onPointerCancel={() => { dragRef.current = null; }}
      onClick={e => e.stopPropagation()}>

      {/* Compact, semi-transparent pill — single row */}
      <div
        className="w-full h-full rounded-md bg-white/80 backdrop-blur-sm border border-slate-300/70 flex items-center gap-1.5 px-2"
        style={{ borderRight: "2.5px solid rgba(245,158,11,0.85)" }}>
        <button
          className="text-neutral-300 hover:text-neutral-500 text-xs leading-none shrink-0"
          onClick={e => { e.stopPropagation(); onDismiss(); }}>✕</button>
        <button
          className="flex-1 text-[11px] font-semibold text-slate-700 hover:text-slate-800 truncate text-right"
          onClick={e => { e.stopPropagation(); onConfirm(); }}>
          + קבע ב־{time}
        </button>
        {/* Coffee break button — slightly prominent */}
        <button
          className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md bg-neutral-100 hover:bg-slate-100 border border-neutral-200 hover:border-slate-300 text-[14px] transition"
          title="הוסף הפסקה"
          onClick={e => { e.stopPropagation(); onAddBreak(); }}>
          ☕
        </button>
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
  const [draftMoveSlot, setDraftMoveSlot] = useState<{ staffId: string; date: string; startY: number } | null>(null);
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

  // ── Drag-to-MOVE existing appointments ──────────────────────────────────────
  // Triggered by long-press (500ms) on an ApptBlock. The original is faded;
  // a ghost outline tracks the pointer and snaps to the column/time grid;
  // on release we PATCH the appointment (with conflict modal on 409).
  type DragMoveState = {
    appt: Appt;
    pointerX: number; pointerY: number;
    dropTarget: { staffId: string; date: string; startTime: string } | null;
  };
  const [dragMove, setDragMove] = useState<DragMoveState | null>(null);
  const dragMoveRef = useRef<DragMoveState | null>(null);
  dragMoveRef.current = dragMove;

  // Column refs — keyed by `${staffId}|${date}` so we can identify which column
  // the pointer is over during a drag-move. Rebuilt on each render based on
  // current view (day = many staff, week = many days).
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // When a DraftApptBlock or DraftMoveSlotBlock is dragged, the browser fires a
  // `click` on the grid after mouseup (because the mouse ends up outside the
  // 32px block). This ref lets us swallow that one ghost click so the block
  // doesn't immediately disappear after dragging.
  const suppressNextGridClick = useRef(false);

  // Conflict modal that appears when drag-drop hits an occupied slot
  const [moveConflict, setMoveConflict] = useState<{
    message: string;
    appt: Appt;
    target: { staffId: string; date: string; startTime: string };
  } | null>(null);

  // ── Swap flow ────────────────────────────────────────────────────────────────
  const [swapProposals, setSwapProposals] = useState<SwapProposal[]>([]);
  // When `swapMode` is active, the calendar enters "select candidates" mode:
  // tapping any other appointment toggles it as a SWAP candidate; tapping an
  // empty time slot toggles it as a MOVE candidate. Long-press / drag are
  // disabled while swapMode is active.
  const [swapMode, setSwapMode] = useState<{
    primaryApptId: string;
    candidates: SwapModeCandidate[];
  } | null>(null);
  const [swapSubmitting, setSwapSubmitting] = useState(false);

  // Drag-to-move follow-up — after a successful drop ask if customer should be notified
  const [notifyMove, setNotifyMove] = useState<Appt | null>(null);
  const [notifySending, setNotifySending] = useState(false);

  // Helpers: find any open proposal where this appt is the primary, OR any
  // open proposal where this appt is a candidate. Used for visual badges.
  function getOpenProposalAsPrimary(apptId: string): SwapProposal | undefined {
    return swapProposals.find(p =>
      p.primaryAppointmentId === apptId && SWAP_OPEN_STATUSES.includes(p.status)
    );
  }
  function getOpenProposalAsCandidate(apptId: string): SwapProposal | undefined {
    return swapProposals.find(p =>
      p.candidateAppointmentId === apptId && SWAP_OPEN_STATUSES.includes(p.status)
    );
  }
  // Compute the visual swap-state for an appointment. Returns the discriminated
  // union expected by <ApptBlock>.
  function swapStateFor(apptId: string): ApptBlockSwapState {
    if (swapMode) {
      if (apptId === swapMode.primaryApptId) return { kind: "swap-mode-primary" };
      const isSelected = swapMode.candidates.some(c => c.kind === "swap" && c.appointmentId === apptId);
      if (isSelected) return { kind: "swap-mode-selected" };
      if (getOpenProposalAsPrimary(apptId) || getOpenProposalAsCandidate(apptId)) return { kind: "swap-mode-disabled" };
      return { kind: "swap-mode-eligible" };
    }
    const asP = getOpenProposalAsPrimary(apptId);
    const asC = getOpenProposalAsCandidate(apptId);
    const involved = asP || asC;
    if (!involved) return { kind: "none" };
    if (involved.status === "accepted_by_customer") return { kind: "swap-agreed" };
    return { kind: "pending-swap" };
  }

  // Lookup: is this empty slot already selected as a "move" candidate?
  function isSelectedMoveSlot(staffId: string, date: string, startTime: string): boolean {
    if (!swapMode) return false;
    const key = moveKey({ staffId, date, startTime });
    return swapMode.candidates.some(c => c.kind === "move" && moveKey(c) === key);
  }

  // Click on an appointment block — swap-mode selection or normal detail open
  function handleApptClick(a: Appt) {
    if (swapMode) {
      toggleSwapCandidate(a.id);
      return;
    }
    setSelectedAppt(a);
  }

  // ── Restore saved view/zoom on mount, persist on change ─────────────────────
  // Default state (above) is what server rendered; the actual saved prefs are
  // applied here on the client to avoid hydration mismatch.
  useEffect(() => {
    const prefs = loadPrefs();
    if (prefs.view && (["day","3day","week","month"] as ViewType[]).includes(prefs.view)) {
      setView(prefs.view);
    }
    if (typeof prefs.hourHeight === "number" && prefs.hourHeight >= 28 && prefs.hourHeight <= 220) {
      setHourHeight(prefs.hourHeight);
    }
    // weekBarber is restored later, after the staff list loads
  }, []);

  useEffect(() => { savePrefs({ view }); }, [view]);
  useEffect(() => { savePrefs({ hourHeight }); }, [hourHeight]);
  useEffect(() => { if (weekBarber) savePrefs({ weekBarber }); }, [weekBarber]);

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
      if (st.length) {
        // Prefer the previously selected barber if they're still in the staff list
        const saved = loadPrefs().weekBarber;
        const validSaved = saved && st.some((s: Staff) => s.id === saved) ? saved : st[0].id;
        setWeekBarber(validSaved);
      }
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
    // Reload swap proposals (open ones across the whole business — small list, OK to load all)
    fetch("/api/admin/swap-proposals?status=open")
      .then(r => r.ok ? r.json() : [])
      .then(d => setSwapProposals(Array.isArray(d) ? d : []))
      .catch(() => {});
    setLoading(false);
  }, [getDates, allStaff]);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  // ── Swap-mode handlers ─────────────────────────────────────────────────────
  function enterSwapMode(primaryApptId: string) {
    setSwapMode({ primaryApptId, candidates: [] });
    setSelectedAppt(null); // close any open detail modal
  }
  function cancelSwapMode() {
    setSwapMode(null);
    setDraftMoveSlot(null);
  }
  function toggleSwapCandidate(apptId: string) {
    setSwapMode(prev => {
      if (!prev) return null;
      if (apptId === prev.primaryApptId) return prev;
      if (getOpenProposalAsPrimary(apptId) || getOpenProposalAsCandidate(apptId)) return prev;
      const idx = prev.candidates.findIndex(c => c.kind === "swap" && c.appointmentId === apptId);
      if (idx >= 0) {
        return { ...prev, candidates: prev.candidates.filter((_, i) => i !== idx) };
      }
      if (prev.candidates.length >= 5) return prev;
      return { ...prev, candidates: [...prev.candidates, { kind: "swap", appointmentId: apptId }] };
    });
  }
  function toggleSwapMoveSlot(staffId: string, date: string, startTime: string) {
    setSwapMode(prev => {
      if (!prev) return null;
      const key = moveKey({ staffId, date, startTime });
      const idx = prev.candidates.findIndex(c => c.kind === "move" && moveKey(c) === key);
      if (idx >= 0) {
        return { ...prev, candidates: prev.candidates.filter((_, i) => i !== idx) };
      }
      if (prev.candidates.length >= 5) return prev;
      return { ...prev, candidates: [...prev.candidates, { kind: "move", staffId, date, startTime }] };
    });
  }
  async function submitSwap() {
    if (!swapMode || swapMode.candidates.length === 0) return;
    setSwapSubmitting(true);
    // Translate to API body shape
    const body = {
      candidates: swapMode.candidates.map(c =>
        c.kind === "swap"
          ? { type: "swap", appointmentId: c.appointmentId }
          : { type: "move", staffId: c.staffId, date: c.date, startTime: c.startTime }
      ),
    };
    const res = await fetch(`/api/admin/appointments/${swapMode.primaryApptId}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSwapSubmitting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "שגיאה בשליחת ההצעה");
      return;
    }
    setSwapMode(null);
    loadAppointments();
  }

  // Mark a candidate's response (manual — admin sees customer's WA reply)
  async function markSwapResponse(proposalId: string, action: "mark_accepted" | "mark_rejected" | "cancel") {
    const res = await fetch(`/api/admin/swap-proposals/${proposalId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "שגיאה");
      return;
    }
    loadAppointments();
  }
  // Approve a swap (executes the actual appointment swap)
  async function approveSwap(proposalId: string) {
    const res = await fetch(`/api/admin/swap-proposals/${proposalId}/approve`, {
      method: "POST",
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "שגיאה באישור ההחלפה");
      return;
    }
    setSelectedAppt(null);
    loadAppointments();
  }

  // Notify a customer about an appointment that was just moved (drag-to-move follow-up)
  async function notifyMoveCustomer(appt: Appt) {
    setNotifySending(true);
    const res = await fetch(`/api/admin/appointments/${appt.id}/notify-moved`, {
      method: "POST",
    });
    setNotifySending(false);
    setNotifyMove(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "שגיאה בשליחת ההודעה");
    }
  }

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

  // ── Drag-to-move helpers ────────────────────────────────────────────────────
  // Compute which column + start-time the pointer is over by checking each
  // registered column's bounding rect. Returns null if the pointer is outside
  // any column (e.g. dragged into the time-axis or out of the grid).
  const computeDropTarget = useCallback((clientX: number, clientY: number) => {
    for (const key in colRefs.current) {
      const el = colRefs.current[key];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        const [staffId, d] = key.split("|");
        const yInCol = clientY - rect.top;
        const startTime = yToTimeFn(yInCol, hourHeightRef.current);
        return { staffId, date: d, startTime };
      }
    }
    return null;
  }, []);

  // Persist a move to the API. Reverts the optimistic update on failure.
  // Returns true on a clean save, false on conflict/error so callers can act
  // (e.g. show "notify customer?" only when the save actually went through).
  const persistMove = useCallback(async (
    appt: Appt,
    target: { staffId: string; date: string; startTime: string },
    override: boolean,
  ): Promise<boolean> => {
    const res = await fetch(`/api/admin/appointments/${appt.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: target.date,
        startTime: target.startTime,
        staffId: target.staffId,
        override,
      }),
    });
    if (res.status === 409) {
      const j = await res.json().catch(() => ({}));
      // Revert optimistic update
      setAppointments(prev => prev.map(a =>
        a.id === appt.id ? appt : a
      ));
      // Show conflict modal — user can accept override or cancel
      setMoveConflict({
        message: j.error || "השעה תפוסה",
        appt,
        target,
      });
      return false;
    }
    if (!res.ok) {
      // Revert + reload
      setAppointments(prev => prev.map(a => a.id === appt.id ? appt : a));
      loadAppointments();
      return false;
    }
    // Success — reload to sync with backend (handles endTime, etc.)
    loadAppointments();
    return true;
  }, [loadAppointments]);

  // Long-press fired on an ApptBlock — enter drag-move mode.
  function startMoveDrag(appt: Appt, clientX: number, clientY: number) {
    setDragMove({ appt, pointerX: clientX, pointerY: clientY, dropTarget: null });
    // Haptic feedback (iOS Safari + Android Chrome)
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(30);
    }
  }

  // Drop handler — finalize the move (or revert if dropped at origin / outside).
  const finalizeMoveDrag = useCallback((target: { staffId: string; date: string; startTime: string } | null) => {
    const drag = dragMoveRef.current;
    setDragMove(null);
    if (!drag || !target) return;
    const origDate = drag.appt.date.slice(0, 10);
    const origStaff = drag.appt.staff.id;
    const origStart = drag.appt.startTime;
    // No change → no-op
    if (target.staffId === origStaff && target.date === origDate && target.startTime === origStart) return;

    // Optimistic update — move the appointment in local state immediately
    const duration = toMin(drag.appt.endTime) - toMin(drag.appt.startTime);
    const newEnd = minToTime(toMin(target.startTime) + duration);
    const newStaff = allStaff.find(s => s.id === target.staffId);
    const movedAppt: Appt = {
      ...drag.appt,
      startTime: target.startTime,
      endTime: newEnd,
      date: target.date + "T00:00:00.000Z",
      staff: { id: target.staffId, name: newStaff?.name || drag.appt.staff.name },
    };
    setAppointments(prev => prev.map(a => a.id === drag.appt.id ? movedAppt : a));

    // Persist (will revert on failure). On success — open the "notify customer?" modal.
    persistMove(drag.appt, target, false).then(succeeded => {
      if (succeeded) setNotifyMove(movedAppt);
    }).catch(console.error);
  }, [allStaff, persistMove]);

  // Global pointermove + pointerup listeners — only attached while dragging
  useEffect(() => {
    if (!dragMove) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      const dropTarget = computeDropTarget(e.clientX, e.clientY);
      setDragMove(prev => prev ? { ...prev, pointerX: e.clientX, pointerY: e.clientY, dropTarget } : null);
    };
    const onUp = (e: PointerEvent) => {
      const dropTarget = computeDropTarget(e.clientX, e.clientY);
      finalizeMoveDrag(dropTarget);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragMove !== null, computeDropTarget, finalizeMoveDrag]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag to create (desktop/mouse only) ─────────────────────────────────────
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>, staffId: string, d: string) {
    if (swapMode) return; // in swap mode, grid clicks are handled by handleGridClick (toggle move slot)
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
    // In swap mode, an empty-slot tap opens a draggable draft move-slot
    // so the user can fine-tune the time before confirming (important on mobile
    // where finger-precision is limited). If a draft is already open for this
    // column, dismiss it; otherwise open a new one.
    if (swapMode) {
      if (draftMoveSlot?.staffId === staffId && draftMoveSlot?.date === d) {
        setDraftMoveSlot(null);
        return;
      }
      setDraftMoveSlot({ staffId, date: d, startY: y });
      return;
    }
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
              <div key={cell} className={`rounded-xl p-2 cursor-pointer min-h-[80px] transition ${isToday ? "bg-teal-50 border-2 border-teal-400" : "bg-white border border-neutral-200 hover:bg-neutral-50"}`}
                onClick={() => { setDate(cell); setView("day"); setDayMenu({ date: cell, staffId: allStaff[0]?.id || "" }); }}>
                <span className={`text-sm font-semibold ${isToday ? "text-teal-700" : "text-neutral-800"}`}>{new Date(cell).getDate()}</span>
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
                    <span className={`text-xs font-semibold ${isToday ? "text-teal-700" : "text-neutral-500"}`}>{fmtShort(d)}</span>
                    {isToday && <div className="w-1.5 h-1.5 rounded-full bg-teal-500 mt-0.5" />}
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
                    const colDraftMove = draftMoveSlot?.staffId === s.id && draftMoveSlot?.date === date ? draftMoveSlot : null;
                    const colKey = `${s.id}|${date}`;
                    const isDropTarget = dragMove?.dropTarget?.staffId === s.id && dragMove?.dropTarget?.date === date;
                    return (
                      <div key={s.id}
                        ref={el => { colRefs.current[colKey] = el; }}
                        className="flex-1 relative border-r border-neutral-100 last:border-0 cursor-crosshair" style={{ minWidth: 80 }}
                        onClick={e => {
                          if (suppressNextGridClick.current) { suppressNextGridClick.current = false; return; }
                          if (colDraft) { setDraftAppt(null); return; }
                          handleGridClick(e, s.id, date);
                        }}
                        onPointerDown={e => handlePointerDown(e, s.id, date)}
                        onPointerMove={e => handlePointerMove(e, s.id, date)}
                        onPointerUp={e => handlePointerUp(e, s.id, date)}
                        onPointerCancel={() => setDrag(null)}>
                        <WorkingOverlay staff={s} dow={dayOfWeek(date)} />
                        {/* Drag-to-create ghost rectangle */}
                        {colDrag && dragDist >= 6 && (
                          <div className="absolute left-0.5 right-0.5 bg-slate-300/40 border-2 border-dashed border-slate-900 rounded-lg pointer-events-none z-20 flex flex-col justify-start px-1.5 py-1"
                            style={{ top: Math.min(colDrag.startY, colDrag.endY), height: Math.max(dragDist, 8) }}>
                            {dragDist > 20 && (
                              <span className="text-[10px] font-bold text-slate-900 leading-tight">
                                {yToTimeFn(Math.min(colDrag.startY, colDrag.endY), hourHeight)}
                              </span>
                            )}
                          </div>
                        )}
                        {/* Drag-to-MOVE drop ghost — shows where the appointment will land */}
                        {isDropTarget && dragMove && (
                          <div className="absolute left-0.5 right-0.5 rounded-lg border-2 border-dashed pointer-events-none z-30 flex flex-col items-center justify-center px-1.5"
                            style={{
                              top: apptTop(dragMove.dropTarget!.startTime, hourHeight),
                              height: apptH(dragMove.appt.startTime, dragMove.appt.endTime, hourHeight),
                              borderColor: "#10b981",
                              background: "rgba(16,185,129,0.18)",
                            }}>
                            <p className="text-[10px] font-bold text-emerald-900 leading-tight">{dragMove.appt.customer.name}</p>
                            <p className="text-[10px] text-emerald-800">{s.name} · {dragMove.dropTarget!.startTime}</p>
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
                            onDragMoved={() => { suppressNextGridClick.current = true; }}
                          />
                        )}
                        {colDraftMove && (
                          <DraftMoveSlotBlock
                            startY={colDraftMove.startY}
                            durationMinutes={swapPrimaryDuration}
                            onMove={y => setDraftMoveSlot(prev => prev ? { ...prev, startY: y } : null)}
                            onConfirm={startTime => { toggleSwapMoveSlot(s.id, date, startTime); setDraftMoveSlot(null); }}
                            onDismiss={() => setDraftMoveSlot(null)}
                            onDragMoved={() => { suppressNextGridClick.current = true; }}
                          />
                        )}
                        {getAppts(s.id, date).map(a => (
                          <ApptBlock key={a.id} appt={a} colorClass={COLORS[si % COLORS.length].light}
                            isMoving={dragMove?.appt.id === a.id}
                            swapState={swapStateFor(a.id)}
                            onClick={() => handleApptClick(a)}
                            onLongPress={(x, y) => startMoveDrag(a, x, y)} />
                        ))}
                        {renderMoveSlotMarkers(s.id, date)}
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
                    const colDraftMove = draftMoveSlot?.staffId === s.id && draftMoveSlot?.date === d ? draftMoveSlot : null;
                    const colKey = `${s.id}|${d}`;
                    const isDropTarget = dragMove?.dropTarget?.staffId === s.id && dragMove?.dropTarget?.date === d;
                    return (
                      <div key={d}
                        ref={el => { colRefs.current[colKey] = el; }}
                        className="flex-1 relative border-r border-neutral-100 last:border-0 cursor-crosshair"
                        onClick={e => {
                          if (suppressNextGridClick.current) { suppressNextGridClick.current = false; return; }
                          if (colDraft) { setDraftAppt(null); return; }
                          handleGridClick(e, s.id, d);
                        }}
                        onPointerDown={e => handlePointerDown(e, s.id, d)}
                        onPointerMove={e => handlePointerMove(e, s.id, d)}
                        onPointerUp={e => handlePointerUp(e, s.id, d)}
                        onPointerCancel={() => setDrag(null)}>
                        <WorkingOverlay staff={s} dow={dayOfWeek(d)} />
                        {colDrag && dragDist >= 6 && (
                          <div className="absolute left-0.5 right-0.5 bg-slate-300/40 border-2 border-dashed border-slate-900 rounded-lg pointer-events-none z-20 flex flex-col justify-start px-1.5 py-1"
                            style={{ top: Math.min(colDrag.startY, colDrag.endY), height: Math.max(dragDist, 8) }}>
                            {dragDist > 20 && (
                              <span className="text-[10px] font-bold text-slate-900 leading-tight">
                                {yToTimeFn(Math.min(colDrag.startY, colDrag.endY), hourHeight)}
                              </span>
                            )}
                          </div>
                        )}
                        {/* Drag-to-MOVE drop ghost */}
                        {isDropTarget && dragMove && (
                          <div className="absolute left-0.5 right-0.5 rounded-lg border-2 border-dashed pointer-events-none z-30 flex flex-col items-center justify-center px-1.5"
                            style={{
                              top: apptTop(dragMove.dropTarget!.startTime, hourHeight),
                              height: apptH(dragMove.appt.startTime, dragMove.appt.endTime, hourHeight),
                              borderColor: "#10b981",
                              background: "rgba(16,185,129,0.18)",
                            }}>
                            <p className="text-[10px] font-bold text-emerald-900 leading-tight">{dragMove.appt.customer.name}</p>
                            <p className="text-[10px] text-emerald-800">{fmtShort(d)} · {dragMove.dropTarget!.startTime}</p>
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
                            onDragMoved={() => { suppressNextGridClick.current = true; }}
                          />
                        )}
                        {colDraftMove && (
                          <DraftMoveSlotBlock
                            startY={colDraftMove.startY}
                            durationMinutes={swapPrimaryDuration}
                            onMove={y => setDraftMoveSlot(prev => prev ? { ...prev, startY: y } : null)}
                            onConfirm={startTime => { toggleSwapMoveSlot(s.id, d, startTime); setDraftMoveSlot(null); }}
                            onDismiss={() => setDraftMoveSlot(null)}
                            onDragMoved={() => { suppressNextGridClick.current = true; }}
                          />
                        )}
                        {getAppts(s.id, d).map(a => (
                          <ApptBlock key={a.id} appt={a} colorClass={COLORS[si % COLORS.length].light}
                            isMoving={dragMove?.appt.id === a.id}
                            swapState={swapStateFor(a.id)}
                            onClick={() => handleApptClick(a)}
                            onLongPress={(x, y) => startMoveDrag(a, x, y)} />
                        ))}
                        {renderMoveSlotMarkers(s.id, d)}
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

  // Look up the primary appt (when in swap mode) for the banner label
  const swapPrimary = swapMode ? appointments.find(a => a.id === swapMode.primaryApptId) : null;
  // Primary's duration — used to render move-slot ghost markers at the right size
  const swapPrimaryDuration = swapPrimary
    ? toMin(swapPrimary.endTime) - toMin(swapPrimary.startTime)
    : 30;

  // Render a list of "move-slot" markers for a given column. Used inline in
  // each column's JSX, so we just return an array of <div>s.
  function renderMoveSlotMarkers(staffId: string, dateStr: string) {
    if (!swapMode) return null;
    const slots = swapMode.candidates.filter(
      (c): c is Extract<SwapModeCandidate, { kind: "move" }> =>
        c.kind === "move" && c.staffId === staffId && c.date === dateStr
    );
    return slots.map(slot => {
      const top = apptTop(slot.startTime, hourHeight);
      const height = (swapPrimaryDuration / 60) * hourHeight;
      return (
        <div key={`move-${slot.startTime}`}
          className="absolute left-0.5 right-0.5 rounded-lg border-2 border-dashed z-20 flex flex-col items-center justify-center px-1.5"
          style={{
            top, height,
            borderColor: "#3b82f6",
            background: "rgba(59,130,246,0.15)",
          }}>
          <p className="text-[10px] font-bold text-teal-900 leading-tight">✓ העברה לכאן</p>
          <p className="text-[10px] text-teal-700">{slot.startTime}</p>
          {/* Deselect button — always reachable, has pointer-events-auto */}
          <button
            className="absolute top-0.5 left-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-teal-500 text-white text-[9px] font-bold leading-none hover:bg-teal-600 transition"
            onClick={e => { e.stopPropagation(); toggleSwapMoveSlot(slot.staffId, slot.date, slot.startTime); }}
            title="הסר">
            ✕
          </button>
        </div>
      );
    });
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Swap mode banner ── */}
      {swapMode && (() => {
        const swapCount = swapMode.candidates.filter(c => c.kind === "swap").length;
        const moveCount = swapMode.candidates.filter(c => c.kind === "move").length;
        const total = swapMode.candidates.length;
        return (
          <div className="bg-teal-50 border-b-2 border-teal-300 px-3 py-2.5 flex items-center gap-3 shrink-0">
            <span className="text-teal-700 text-base">🔄</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-teal-900 truncate">
                מצב החלפה: {swapPrimary ? `${swapPrimary.customer.name} (${swapPrimary.startTime})` : "..."}
              </p>
              <p className="text-[11px] text-teal-700">
                {total === 0
                  ? "לחץ על תור (החלפה עם לקוח) או על שעה ריקה (העברה)"
                  : `${total} נבחרו · ${swapCount} החלפות · ${moveCount} העברות לשעה ריקה`}
              </p>
            </div>
            <button
              onClick={cancelSwapMode}
              disabled={swapSubmitting}
              className="px-3 py-1.5 rounded-lg text-xs text-neutral-600 hover:bg-neutral-100">
              ביטול
            </button>
            <button
              onClick={submitSwap}
              disabled={total === 0 || swapSubmitting}
              className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:bg-neutral-300 text-white rounded-lg text-xs font-bold transition">
              {swapSubmitting ? "שולח..." : `שלח ל-${total}`}
            </button>
          </div>
        );
      })()}

      {/* ── Top bar ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-white border-b border-neutral-200 shrink-0 flex-wrap gap-y-1.5">
        {/* Navigation */}
        <button onClick={() => navigate(-1)} className="w-8 h-8 rounded-lg hover:bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">◀</button>
        <button onClick={() => setDate(todayISO())} className="text-xs font-medium text-teal-600 hover:text-teal-700 hover:underline px-1 shrink-0">היום</button>
        <button onClick={() => navigate(1)} className="w-8 h-8 rounded-lg hover:bg-neutral-100 text-neutral-500 flex items-center justify-center shrink-0">▶</button>

        {/* Date label */}
        {view === "day" ? (
          <button
            className="font-semibold text-neutral-800 text-sm flex-1 min-w-0 truncate text-right hover:text-slate-800 transition"
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

        {/* Zoom controls — hidden on month (no hourHeight there) */}
        {view !== "month" && (
          <div className="flex bg-neutral-100 rounded-lg p-0.5 shrink-0" aria-label="זום יומן">
            <button
              onClick={() => setHourHeight(h => Math.max(28, h - 20))}
              disabled={hourHeight <= 28}
              className="w-7 h-7 flex items-center justify-center text-base font-bold text-neutral-700 disabled:text-neutral-300 hover:bg-white rounded-md transition"
              aria-label="הקטן יומן"
              title="הקטן יומן"
            >
              −
            </button>
            <button
              onClick={() => setHourHeight(h => Math.min(220, h + 20))}
              disabled={hourHeight >= 220}
              className="w-7 h-7 flex items-center justify-center text-base font-bold text-neutral-700 disabled:text-neutral-300 hover:bg-white rounded-md transition"
              aria-label="הגדל יומן"
              title="הגדל יומן"
            >
              +
            </button>
          </div>
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
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${showFilter ? "bg-teal-600 text-white border-teal-700" : "bg-white border-neutral-200 text-neutral-600"}`}>
              ✂️ {visibleStaff.length === allStaff.length ? "הכל" : `${visibleStaff.length}`}
            </button>
            {showFilter && (
              <div className="absolute left-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-neutral-200 p-2 w-48 z-30">
                <div className="flex items-center justify-between mb-1 px-1">
                  <span className="text-xs font-semibold text-neutral-700">ספרים</span>
                  <button onClick={() => setVisibleStaff(allStaff.map(s => s.id))} className="text-[11px] text-slate-800">הכל</button>
                </div>
                {allStaff.map((s, si) => (
                  <label key={s.id} className="flex items-center gap-2 px-1 py-1.5 cursor-pointer rounded-lg hover:bg-neutral-50">
                    <input type="checkbox" checked={visibleStaff.includes(s.id)}
                      onChange={e => setVisibleStaff(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))}
                      className="accent-slate-900" />
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
          className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-semibold hover:bg-teal-700 transition shrink-0">
          + תור
        </button>
      </div>

      {/* ── Calendar body ── */}
      {loading && appointments.length === 0
        ? <div className="flex-1 flex items-center justify-center text-neutral-400">טוען...</div>
        : view === "month" ? renderMonth() : renderTimeGrid()
      }

      {/* ── Modals ── */}
      {selectedAppt && <ApptModal
        appt={selectedAppt}
        onClose={() => setSelectedAppt(null)}
        onChange={handleStatusChange}
        onReload={loadAppointments}
        onEnterSwapMode={(id) => { enterSwapMode(id); }}
        onMarkSwap={async (proposalId, action) => { await markSwapResponse(proposalId, action); }}
        onApproveSwap={async (proposalId) => { await approveSwap(proposalId); }}
      />}
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

      {/* ── Notify-customer-after-drag modal ── */}
      {notifyMove && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setNotifyMove(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-600 text-xl shrink-0">📲</div>
              <div className="flex-1">
                <h3 className="font-bold text-neutral-900 text-base">לעדכן את הלקוח?</h3>
                <p className="text-sm text-neutral-600 mt-1 leading-relaxed">
                  התור של <span className="font-semibold">{notifyMove.customer.name}</span> עבר ל-{notifyMove.startTime}.
                  <br />לשלוח לו וואצאפ אוטומטי על השינוי?
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setNotifyMove(null)}
                disabled={notifySending}
                className="flex-1 bg-white border border-neutral-300 text-neutral-700 rounded-xl py-2.5 text-sm font-semibold hover:bg-neutral-50 transition disabled:opacity-50">
                לא, אל תעדכן
              </button>
              <button
                onClick={() => notifyMoveCustomer(notifyMove)}
                disabled={notifySending}
                className="flex-1 bg-teal-500 hover:bg-teal-600 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50 transition">
                {notifySending ? "שולח..." : "כן, שלח וואצאפ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Drag-move conflict modal ── */}
      {moveConflict && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => { setMoveConflict(null); loadAppointments(); }}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-800 text-xl shrink-0">⚠️</div>
              <div className="flex-1">
                <h3 className="font-bold text-neutral-900 text-base">השעה תפוסה</h3>
                <p className="text-sm text-neutral-600 mt-1 leading-relaxed">{moveConflict.message}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setMoveConflict(null); loadAppointments(); }}
                className="flex-1 bg-white border border-neutral-300 text-neutral-700 rounded-xl py-2.5 text-sm font-semibold hover:bg-neutral-50 transition">
                השאר במקום
              </button>
              <button
                onClick={async () => {
                  const { appt, target } = moveConflict;
                  setMoveConflict(null);
                  const ok = await persistMove(appt, target, true);
                  if (ok) {
                    // Build the post-move appt for the notify modal
                    const dur = toMin(appt.endTime) - toMin(appt.startTime);
                    const newStaff = allStaff.find(s => s.id === target.staffId);
                    setNotifyMove({
                      ...appt,
                      startTime: target.startTime,
                      endTime: minToTime(toMin(target.startTime) + dur),
                      date: target.date + "T00:00:00.000Z",
                      staff: { id: target.staffId, name: newStaff?.name || appt.staff.name },
                    });
                  }
                }}
                className="flex-1 bg-teal-600 text-white rounded-xl py-2.5 text-sm font-bold hover:bg-teal-700 transition">
                להעביר בכל זאת
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
