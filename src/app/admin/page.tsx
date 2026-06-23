"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { pickFriendSource } from "@/lib/referral";
import NotificationsBell from "./NotificationsBell";

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_HOUR_HEIGHT = 64;
const DAY_START = 8;  // fallback default — overridden by business settings
const DAY_END = 21;   // fallback default — overridden by business settings
const TOTAL_HOURS = DAY_END - DAY_START;

// Context for dynamic hourHeight (pinch-to-zoom)
const HHCtx = React.createContext(DEFAULT_HOUR_HEIGHT);
// Context for calendar display range (calendarStartHour / calendarEndHour from settings)
const HourRangeCtx = React.createContext({ start: DAY_START, end: DAY_END });

// Detects narrow viewports so draft blocks etc. can switch to a vertical
// stacked layout instead of the squished horizontal pill that happens in
// week-view columns on a phone.
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return isMobile;
}

const COLORS = [
  { bg: "bg-violet-500", light: "bg-violet-100 text-violet-900 border-violet-300" },
  { bg: "bg-sky-500",    light: "bg-sky-100 text-sky-900 border-sky-300" },
  { bg: "bg-emerald-500",light: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  { bg: "bg-indigo-500", light: "bg-indigo-100 text-indigo-900 border-indigo-300" },
  { bg: "bg-rose-500",   light: "bg-rose-100 text-rose-900 border-rose-300" },
  { bg: "bg-cyan-500",   light: "bg-cyan-100 text-cyan-900 border-cyan-300" },
];

// Per-barber appointment colors. Each barber gets a distinct hue (a deterministic
// hash of the staff id → a stable color family), so at a glance you can tell whose
// appointment is whose. WITHIN a barber's hue, the shade scales with service
// length: longer services get a bolder, more prominent shade so the big jobs pop.
// Tailwind needs full literal class names (no string interpolation) to keep them
// from being purged — hence the spelled-out 3-tier families below.
// Backgrounds use a low opacity suffix (/30, /35, /55) so blocks read as very
// soft, delicate see-through tints rather than solid fills — the grid lines
// behind stay clearly visible. The long/prominent tier stays a touch stronger
// so it still stands out.
const STAFF_COLOR_FAMILIES: [string, string, string][] = [
  // [short / light, medium, long / prominent]
  ["bg-sky-100/30 text-sky-900 border-sky-300",         "bg-sky-200/35 text-sky-900 border-sky-400",         "bg-sky-500/55 text-white border-sky-600"],
  ["bg-emerald-100/30 text-emerald-900 border-emerald-300", "bg-emerald-200/35 text-emerald-900 border-emerald-400", "bg-emerald-500/55 text-white border-emerald-600"],
  ["bg-violet-100/30 text-violet-900 border-violet-300", "bg-violet-200/35 text-violet-900 border-violet-400", "bg-violet-500/55 text-white border-violet-600"],
  ["bg-rose-100/30 text-rose-900 border-rose-300",       "bg-rose-200/35 text-rose-900 border-rose-400",       "bg-rose-500/55 text-white border-rose-600"],
  ["bg-amber-100/30 text-amber-900 border-amber-300",    "bg-amber-200/35 text-amber-900 border-amber-400",    "bg-amber-500/55 text-white border-amber-600"],
  ["bg-cyan-100/30 text-cyan-900 border-cyan-300",       "bg-cyan-200/35 text-cyan-900 border-cyan-400",       "bg-cyan-500/55 text-white border-cyan-600"],
  ["bg-fuchsia-100/30 text-fuchsia-900 border-fuchsia-300", "bg-fuchsia-200/35 text-fuchsia-900 border-fuchsia-400", "bg-fuchsia-500/55 text-white border-fuchsia-600"],
  ["bg-orange-100/30 text-orange-900 border-orange-300", "bg-orange-200/35 text-orange-900 border-orange-400", "bg-orange-500/55 text-white border-orange-600"],
  ["bg-teal-100/30 text-teal-900 border-teal-300",       "bg-teal-200/35 text-teal-900 border-teal-400",       "bg-teal-500/55 text-white border-teal-600"],
  ["bg-indigo-100/30 text-indigo-900 border-indigo-300", "bg-indigo-200/35 text-indigo-900 border-indigo-400", "bg-indigo-500/55 text-white border-indigo-600"],
];
// Map a service duration to a prominence tier (0 = short, 1 = medium, 2 = long).
function durationTier(durationMinutes: number): 0 | 1 | 2 {
  if (durationMinutes >= 45) return 2;
  if (durationMinutes >= 30) return 1;
  return 0;
}
function apptColorClass(staffId: string, durationMinutes: number): string {
  let h = 0;
  for (let i = 0; i < staffId.length; i++) h = (h * 31 + staffId.charCodeAt(i)) >>> 0;
  const family = STAFF_COLOR_FAMILIES[h % STAFF_COLOR_FAMILIES.length];
  return family[durationTier(durationMinutes)];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const todayISO = () => new Date().toISOString().split("T")[0];
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const minToTime = (m: number) => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate()+n); return d.toISOString().split("T")[0]; };
const dayOfWeek = (iso: string) => new Date(iso).getDay();
// Whole days between two YYYY-MM-DD dates (UTC — DST-safe). Positive = `to` is later.
const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86400000);
// Resolve a staff member's booking horizon (days bookable from today, inclusive),
// falling back to the business default. Matches the customer flow in /book/time.
const staffHorizonDays = (s: Staff, bizHorizon: number): number => {
  try {
    const st = s.settings ? JSON.parse(s.settings) : null;
    if (st && typeof st.bookingHorizonDays === "number") return st.bookingHorizonDays;
  } catch { /* ignore malformed settings JSON */ }
  return bizHorizon;
};
const HEB_DAY_LETTERS = ["א","ב","ג","ד","ה","ו","ש"];
const hebDayLetter = (iso: string) => HEB_DAY_LETTERS[new Date(iso).getDay()];
const fmtDateShort = (iso: string) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth()+1}`; };
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { weekday: "short", day: "numeric" });
const apptTop = (t: string, hh: number, ds = DAY_START) => ((toMin(t) - ds * 60) / 60) * hh;
// Height of an appointment block. We keep a minimum so tiny appointments stay
// tappable, but the floor never exceeds a half-hour slot at the current zoom —
// otherwise zoomed-out 30-min blocks get inflated and visually overlap the
// next slot. So at full zoom-out the blocks genuinely shrink.
const apptH = (s: string, e: string, hh: number) =>
  Math.max(((toMin(e) - toMin(s)) / 60) * hh, Math.min(20, hh * 0.5));

// ── Overlap lane packing ──────────────────────────────────────────────────────
// Given a column's appointments, work out how to lay overlapping ones SIDE BY
// SIDE so they don't stack on top of each other. Returns a map id → { lane,
// lanes } where `lanes` is how many columns the overlap-cluster needs and
// `lane` is this appointment's column index (0-based).
function computeApptLanes(appts: { id: string; startTime: string; endTime: string }[]): Record<string, { lane: number; lanes: number }> {
  const items = appts
    .map(a => ({ id: a.id, start: toMin(a.startTime), end: toMin(a.endTime), lane: 0 }))
    .sort((x, y) => x.start - y.start || x.end - y.end);
  const result: Record<string, { lane: number; lanes: number }> = {};
  let cluster: typeof items = [];
  let columnsEnd: number[] = []; // end-minute of the last appt placed in each column
  let clusterEnd = -1;

  const flush = () => {
    const lanes = Math.max(columnsEnd.length, 1);
    for (const it of cluster) result[it.id] = { lane: it.lane, lanes };
    cluster = [];
    columnsEnd = [];
    clusterEnd = -1;
  };

  for (const it of items) {
    // If this appointment starts after everything in the current cluster has
    // ended, the cluster is closed — finalize it before starting fresh.
    if (cluster.length && it.start >= clusterEnd) flush();
    let placed = columnsEnd.findIndex(end => end <= it.start);
    if (placed === -1) { placed = columnsEnd.length; columnsEnd.push(it.end); }
    else columnsEnd[placed] = it.end;
    it.lane = placed;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return result;
}
const nowPxFn = (hh: number, ds = DAY_START) => { const n = new Date(); return ((n.getHours() * 60 + n.getMinutes() - ds * 60) / 60) * hh; };
// Snap to 10-minute increments — the calendar grid "magnetizes" to clean times.
const SNAP_MIN = 5;
const yToTimeFn = (y: number, hh: number, ds = DAY_START, de = DAY_END) => {
  const mins = Math.round((y / hh) * 60 / SNAP_MIN) * SNAP_MIN + ds * 60;
  return minToTime(Math.max(ds * 60, Math.min(de * 60 - SNAP_MIN, mins)));
};
// Snap a raw pixel offset to the nearest 5-minute grid line (magnetize to the axis).
const snapYToGrid = (y: number, hh: number) => {
  const slotPx = (hh * SNAP_MIN) / 60;
  return Math.round(y / slotPx) * slotPx;
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
type Staff = { id: string; name: string; avatarUrl: string | null; isAvailable: boolean; schedules: Schedule[]; settings?: string | null };
type Service = { id: string; name: string; price: number; durationMinutes: number; ownerStaffId?: string | null };
type Appt = {
  id: string; startTime: string; endTime: string; status: string; price: number; date: string;
  note: string | null; staffNote: string | null;
  customer: { id: string; name: string; phone: string; referralSource: string | null };
  staff: { id: string; name: string };
  service: { id: string; name: string; durationMinutes: number };
  recurringId?: string | null;
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
type RawBreak = { start: string; end: string; name?: string; recurring?: boolean };

function WorkingOverlay({ staff, dow, override, beyondHorizon, staffId, date, onBreakClick, onBreakLongPress, movingBreak }: {
  staff: Staff;
  dow: number;
  override?: { isWorking: boolean; slots: string | null; breaks: string | null } | null;
  /** True when this date is past the staff member's booking horizon AND no manual
   *  override opens it. Renders the whole column as grayed "beyond booking range". */
  beyondHorizon?: boolean;
  staffId?: string;
  date?: string;
  onBreakClick?: (breakIdx: number, br: RawBreak) => void;
  /** Long-press on a break card → start dragging it to a new time/column. */
  onBreakLongPress?: (breakIdx: number, br: RawBreak, startMin: number, endMin: number, clientX: number, clientY: number) => void;
  /** The break currently being dragged — its original card fades out. */
  movingBreak?: { staffId: string; date: string; breakIdx: number } | null;
}) {
  const hh = React.useContext(HHCtx);
  const { start: calStart, end: calEnd } = React.useContext(HourRangeCtx);

  // Beyond the booking horizon and not manually opened → whole day greyed/closed.
  // A manual override (isWorking=true) always wins, so it's checked first below.
  if (!override && beyondHorizon) {
    return (
      <div className="absolute inset-0 bg-neutral-200/70 pointer-events-none flex items-center justify-center">
        <span className="text-neutral-400 text-[10px] font-semibold tracking-wide rotate-[-15deg] select-none text-center leading-tight">
          מעבר לטווח<br />ההזמנות
        </span>
      </div>
    );
  }

  let working: { start: number; end: number }[];
  let rawBreaks: RawBreak[] = [];

  if (override) {
    // Use date-specific override
    if (!override.isWorking) {
      return <div className="absolute inset-0 bg-red-50/60 pointer-events-none flex items-center justify-center">
        <span className="text-red-400 text-[10px] font-bold tracking-wide rotate-[-15deg] select-none opacity-80">🔒 סגור</span>
      </div>;
    }
    try { working = override.slots ? JSON.parse(override.slots).map((sl: { start: string; end: string }) => ({ start: toMin(sl.start), end: toMin(sl.end) })) : []; }
    catch { working = []; }
    try { rawBreaks = override.breaks ? JSON.parse(override.breaks) : []; }
    catch { rawBreaks = []; }
  } else {
    working = getWorkingRanges(staff, dow);
    const s = staff.schedules.find(x => x.dayOfWeek === dow);
    try { rawBreaks = s?.breaks ? JSON.parse(s.breaks) : []; } catch { rawBreaks = []; }
  }

  const breakRanges = rawBreaks.map(b => ({ start: toMin(b.start), end: toMin(b.end) }));

  const dayStartMin = calStart * 60;
  const dayEndMin = calEnd * 60;
  if (working.length === 0) {
    return <div className="absolute inset-0 bg-neutral-200/70 pointer-events-none" />;
  }
  // Build non-working segments
  type Segment = { start: number; end: number; type: "closed" | "break"; rawIdx?: number };
  const segments: Segment[] = [];
  let cursor = dayStartMin;
  const sorted = [...working].sort((a, b) => a.start - b.start);
  for (const w of sorted) {
    if (w.start > cursor) segments.push({ start: cursor, end: w.start, type: "closed" });
    cursor = w.end;
  }
  if (cursor < dayEndMin) segments.push({ start: cursor, end: dayEndMin, type: "closed" });
  breakRanges.forEach((b, idx) => segments.push({ start: b.start, end: b.end, type: "break", rawIdx: idx }));

  return (
    <>
      {segments.map((seg, i) => {
        const top = ((seg.start - dayStartMin) / 60) * hh;
        const height = ((seg.end - seg.start) / 60) * hh;
        // Closed / non-working time → flat full-width grey band (background only).
        if (seg.type !== "break") {
          return <div key={i} className="absolute left-0 right-0 pointer-events-none bg-neutral-200/70" style={{ top, height }} />;
        }
        // Break → render like a regular appointment card (inset, rounded) but
        // in the break (amber) palette, and draggable via long-press.
        const rawBreak = seg.rawIdx !== undefined ? rawBreaks[seg.rawIdx] : null;
        const breakName = rawBreak?.name || "הפסקה";
        const isMoving = !!movingBreak && movingBreak.staffId === staffId && movingBreak.date === date && movingBreak.breakIdx === seg.rawIdx;
        return (
          <BreakCard key={i}
            top={top} height={height} name={breakName}
            startMin={seg.start} endMin={seg.end}
            isMoving={isMoving}
            onClick={() => { if (onBreakClick && rawBreak && seg.rawIdx !== undefined) onBreakClick(seg.rawIdx, rawBreak); }}
            onLongPress={(x, y) => { if (onBreakLongPress && rawBreak && seg.rawIdx !== undefined) onBreakLongPress(seg.rawIdx, rawBreak, seg.start, seg.end, x, y); }}
          />
        );
      })}
    </>
  );
}

// ── Break card — looks like an appointment block, in the break (amber) palette.
//    Tap → edit; long-press → drag to a new time/column (like a regular appt). ──
function BreakCard({ top, height, name, startMin, endMin, isMoving, onClick, onLongPress }: {
  top: number; height: number; name: string; startMin: number; endMin: number;
  isMoving: boolean;
  onClick: () => void;
  onLongPress: (clientX: number, clientY: number) => void;
}) {
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpStart = useRef<{ x: number; y: number } | null>(null);
  const lpFired = useRef(false);
  const clearLP = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null; } };
  const veryShort = height < 28;
  return (
    <div
      className={`no-touch-select absolute left-0.5 right-0.5 flex flex-col items-center justify-center ${veryShort ? "rounded-md" : "rounded-lg"} border border-amber-300 bg-amber-100 text-amber-700 overflow-hidden cursor-pointer hover:bg-amber-200/80 transition-colors z-10 ${isMoving ? "opacity-30" : ""}`}
      style={{ top, height, touchAction: "none" }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => {
        e.stopPropagation();
        lpStart.current = { x: e.clientX, y: e.clientY };
        lpFired.current = false;
        clearLP();
        lpTimer.current = setTimeout(() => { lpFired.current = true; onLongPress(e.clientX, e.clientY); }, LONG_PRESS_MS);
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
        if (!lpFired.current) onClick();
        lpStart.current = null; lpFired.current = false;
      }}
      onPointerCancel={() => { clearLP(); lpStart.current = null; lpFired.current = false; }}>
      {height >= 14 && (
        <span className="text-[9px] font-semibold tracking-wide leading-none px-1 truncate max-w-full">☕ {name}</span>
      )}
      {height >= 30 && (
        <span className="text-amber-500 text-[8px] leading-none mt-0.5" dir="ltr">{minToTime(startMin)}–{minToTime(endMin)}</span>
      )}
    </div>
  );
}

// ── Break Edit Modal ─────────────────────────────────────────────────────────
function BreakEditModal({ staffId, date, breakIdx, initial, onClose, onRefresh }: {
  staffId: string;
  date: string;
  breakIdx: number;
  initial: RawBreak;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [name,  setName]  = useState(initial.name  || "הפסקה");
  const [start, setStart] = useState(initial.start);
  const [end,   setEnd]   = useState(initial.end);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  // Delete confirmation — ask whether to tell the waitlist a slot freed up.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removeNotifyWaitlist, setRemoveNotifyWaitlist] = useState(true);

  async function getCurrentBreaks(): Promise<{ breaks: RawBreak[]; slots: { start: string; end: string }[]; isWorking: boolean }> {
    // Try date-specific override first, then weekly schedule
    const [override, allStaff] = await Promise.all([
      fetch(`/api/admin/staff/${staffId}/schedule/override?date=${date}`).then(r => r.json()).catch(() => null),
      fetch("/api/admin/staff").then(r => r.json()).catch(() => []),
    ]);
    if (override?.staffId) {
      const slots = override.slots ? JSON.parse(override.slots) : [];
      const breaks: RawBreak[] = override.breaks ? JSON.parse(override.breaks) : [];
      return { breaks, slots, isWorking: override.isWorking };
    }
    const s = (allStaff as Staff[]).find(x => x.id === staffId);
    const dow = new Date(date + "T00:00:00").getDay();
    const sched = s?.schedules?.find(sc => sc.dayOfWeek === dow);
    if (!sched) return { breaks: [], slots: [{ start: "09:00", end: "20:00" }], isWorking: true };
    const slots = JSON.parse(sched.slots || "[]");
    const breaks: RawBreak[] = sched.breaks ? JSON.parse(sched.breaks) : [];
    return { breaks, slots, isWorking: sched.isWorking };
  }

  // notifyWaitlist: true → send now (manager confirmed), false → silent.
  // Default is silent: we never message the waitlist without an explicit
  // manager decision (the remove flow passes the toggle value explicitly).
  async function postBreaks(newBreaks: RawBreak[], notifyWaitlist = false) {
    const { slots, isWorking } = await getCurrentBreaks();
    const res = await fetch(`/api/admin/staff/${staffId}/schedule/override`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, isWorking, slots, breaks: newBreaks, notifyWaitlist }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `שגיאת שרת ${res.status}`);
    }
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      const { breaks } = await getCurrentBreaks();
      const updated = [...breaks];
      updated[breakIdx] = { start, end, name: name.trim() || "הפסקה" };
      const breaksForApi = updated.map(({ start: s, end: e, name: n }) =>
        n && n !== "הפסקה" ? { start: s, end: e, name: n } : { start: s, end: e }
      );
      await postBreaks(breaksForApi);
      onRefresh(); onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בשמירה — נסה שוב");
    }
    finally { setSaving(false); }
  }

  async function remove() {
    setSaving(true); setError(null);
    try {
      const { breaks } = await getCurrentBreaks();
      const updated = breaks.filter((_, i) => i !== breakIdx);
      await postBreaks(updated, removeNotifyWaitlist);
      onRefresh(); onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה במחיקה — נסה שוב");
    }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center md:items-center" onClick={onClose}>
      <div className="bg-white rounded-t-2xl md:rounded-2xl p-5 w-full max-w-sm shadow-2xl space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-neutral-900 text-base">עריכת הפסקה</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-neutral-400 hover:bg-neutral-100 text-lg">✕</button>
        </div>
        {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="text-xs text-neutral-500 block mb-1">שם ההפסקה</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="הפסקה"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">שעת התחלה</label>
              <input type="time" value={start} onChange={e => setStart(e.target.value)}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">שעת סיום</label>
              <input type="time" value={end} onChange={e => setEnd(e.target.value)}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" />
            </div>
          </div>
        </div>
        {confirmingRemove ? (
          <div className="bg-red-50/60 border border-red-200 rounded-xl p-3 space-y-3">
            <p className="text-sm font-semibold text-red-700">למחוק את ההפסקה?</p>
            <button type="button" onClick={() => setRemoveNotifyWaitlist(v => !v)}
              className="w-full flex items-center gap-2.5 text-right">
              <div className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${removeNotifyWaitlist ? "bg-teal-500" : "bg-neutral-300"}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${removeNotifyWaitlist ? "right-0.5" : "right-4"}`} />
              </div>
              <span className="text-sm text-slate-700">עדכן את רשימת ההמתנה שהתפנה זמן</span>
            </button>
            <div className="flex gap-2 pt-0.5">
              <button onClick={remove} disabled={saving}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">
                {saving ? "מוחק..." : "כן, מחק הפסקה"}
              </button>
              <button onClick={() => setConfirmingRemove(false)} disabled={saving}
                className="px-4 bg-white border border-slate-300 text-slate-700 rounded-lg py-2.5 text-sm">חזרה</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pt-1">
            <button onClick={() => { setRemoveNotifyWaitlist(true); setConfirmingRemove(true); }} disabled={saving}
              className="px-4 py-2.5 rounded-xl text-sm border border-red-100 text-red-500 hover:bg-red-50 disabled:opacity-50 transition">
              🗑 מחק
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 bg-orange-500 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-orange-600 disabled:opacity-50 transition">
              {saving ? "שומר..." : "💾 שמור הפסקה"}
            </button>
          </div>
        )}
      </div>
    </div>
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

/**
 * Renders the customer's FULL name and auto-shrinks the font (between `min` and
 * `max`) so the WHOLE name is always visible — never cut off with an ellipsis.
 * The name may wrap onto up to `maxLines` lines; we measure the rendered text
 * against the available box and step the font down until it fits both the width
 * and the allowed number of lines. This keeps the look uniform at a given zoom
 * (most names render at `max`) while guaranteeing long names stay readable.
 */
function FitName({ name, max, min, maxLines }: { name: string; max: number; min: number; maxLines: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [font, setFont] = React.useState(max);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      const parent = el.parentElement;
      if (!parent) return;
      const availW = parent.clientWidth;
      const availH = parent.clientHeight;
      if (availW <= 0 || availH <= 0) return;

      let size = max;
      el.style.fontSize = `${size}px`;
      // Step down until the text fits horizontally (no word overflow) AND
      // vertically (within maxLines), or we hit the floor.
      while (
        size > min &&
        (el.scrollWidth > availW || el.scrollHeight > Math.min(availH, size * 1.15 * maxLines + 1))
      ) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
      setFont(size);
    };

    fit();
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [name, max, min, maxLines]);

  return (
    <div
      ref={ref}
      className="font-bold w-full"
      title={name}
      style={{
        fontSize: font,
        lineHeight: 1.15,
        whiteSpace: "normal",
        wordBreak: "break-word",
        overflow: "hidden",
      }}
    >
      {name}
    </div>
  );
}

function ApptBlock({ appt, colorClass, onClick, onLongPress, isMoving, swapState, lane }: {
  appt: Appt;
  colorClass: string;
  onClick: () => void;
  onLongPress: (clientX: number, clientY: number) => void;
  isMoving: boolean; // true if THIS appointment is the one being moved → fade out the original
  swapState: ApptBlockSwapState;
  /** Side-by-side placement among overlapping appointments. */
  lane?: { lane: number; lanes: number };
}) {
  const hh = React.useContext(HHCtx);
  const top = apptTop(appt.startTime, hh);
  const height = apptH(appt.startTime, appt.endTime, hh);
  // When this appointment overlaps others, share the column width so they sit
  // beside each other instead of stacking. Otherwise use the full column.
  const lanes = lane && lane.lanes > 1 ? lane.lanes : 1;
  const laneStyle: React.CSSProperties = lanes > 1
    ? { left: `calc(${(lane!.lane * 100) / lanes}% + 1px)`, width: `calc(${100 / lanes}% - 2px)` }
    : { left: 2, right: 2 };
  const veryShort = height < 30;   // e.g. zoomed-out 30-min slot
  const short = height < 46;
  // Preferred name font — driven by the zoom level (hourHeight). This is the
  // MAX size; FitName auto-shrinks from here only as far as needed so the full
  // name fits. Most names render at this size, so blocks stay visually uniform,
  // and a long name simply steps down a little instead of being truncated.
  const zoomFont = Math.max(9, Math.min(16, Math.round(10 + (hh - 28) * 0.08)));
  const heightCap = Math.max(8, height - (veryShort ? 4 : 6));
  let nameFont = Math.min(zoomFont, heightCap);
  if (lanes >= 3) nameFont = Math.min(nameFont, 11);
  // Allow the name to wrap to two lines on any block that isn't tiny. This is
  // what keeps the sizes UNIFORM: a longer name wraps to a second line at the
  // same font as a short name, instead of shrinking to squeeze onto one line.
  // FitName only steps the font down for the rare name too long for two lines.
  const nameLines = (!veryShort && lanes < 3) ? 2 : 1;
  // Secondary lines (service, time) sit a step below the name size.
  const subFont = Math.max(7, Math.round(nameFont * 0.8));
  // With a possible two-line name, require a bit more height before adding the
  // service/time lines so nothing gets cramped.
  const showService = lanes < 3 && height > (nameLines === 2 ? 58 : 44);
  const showTime    = lanes < 3 && height > (nameLines === 2 ? 76 : 60);
  const padClass = veryShort ? "px-1 py-0" : "px-1 py-0.5";

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
    badge = { text: "המקור", cls: "bg-teal-600 text-white" };
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
    <div className={`no-touch-select absolute flex flex-col ${short ? "justify-center" : "justify-start"} ${veryShort ? "rounded-md" : "rounded-lg"} border cursor-pointer hover:opacity-85 transition-opacity overflow-hidden ${padClass} z-10 ${colorClass} ${isMoving ? "opacity-30" : ""} ${ringClass}`}
      style={{ top, height, touchAction: "none", ...laneStyle, ...extraStyle }}
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
      {/* Full customer name (first + last) — ALWAYS shown in full. The font
          starts at the zoom-based size and auto-shrinks only as much as needed
          so the complete name fits (wrapping to up to `nameLines` lines); it is
          never cut off with an ellipsis. */}
      <FitName name={appt.customer.name} max={nameFont} min={7} maxLines={nameLines} />
      {showService && <p className="opacity-70 truncate" style={{ fontSize: subFont, lineHeight: 1.15 }}>{appt.service.name}</p>}
      {showTime && <p className="opacity-60 truncate" dir="ltr" style={{ fontSize: subFont, lineHeight: 1.15 }}>{appt.startTime}</p>}
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
  // Per-staff services (StaffService): the EXACT services the selected barber
  // offers, with their own custom name/price/duration. null = not loaded yet
  // (fall back to the global list). Reloaded whenever the chosen barber changes.
  const [staffServices, setStaffServices] = useState<Service[] | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  // Referral tracking — required when creating a NEW customer (parity with /book/confirm)
  const [referralSource, setReferralSource] = useState("");
  const [referrerPhone, setReferrerPhone] = useState("");
  const [referralOptions, setReferralOptions] = useState<string[]>([]);
  const [walkIn, setWalkIn] = useState(false);
  // Whether to send the customer a WhatsApp confirmation. On by default so a
  // barber booking for their own customer always notifies them.
  const [notifyCustomer, setNotifyCustomer] = useState(true);
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

  // Load the SELECTED barber's own services — so booking for them shows THEIR
  // custom service names/prices/durations, not the main manager's defaults.
  useEffect(() => {
    if (!form.staffId) { setStaffServices(null); return; }
    let cancelled = false;
    fetch(`/api/admin/staff/${form.staffId}/services`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled || !data?.services) return;
        const eff: Service[] = (data.services as Array<{
          id: string; name: string; price: number; durationMinutes: number;
          enabled: boolean; customName?: string | null; customPrice?: number | null; customDuration?: number | null;
        }>)
          .filter(s => s.enabled)
          .map(s => ({
            id: s.id,
            name: s.customName || s.name,
            price: s.customPrice ?? s.price,
            durationMinutes: s.customDuration ?? s.durationMinutes,
          }));
        setStaffServices(eff);
        // Clear a service the newly-chosen barber doesn't actually offer.
        setForm(p => (p.serviceId && !eff.some(e => e.id === p.serviceId) ? { ...p, serviceId: "" } : p));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [form.staffId]);

  // Effective service list: the barber's own services once loaded; otherwise
  // fall back to the global pool filtered to this barber (avoids a flash of empty).
  const availableServices: Service[] = staffServices
    ?? services.filter(s => !s.ownerStaffId || s.ownerStaffId === form.staffId);

  const selectedService = availableServices.find(s => s.id === form.serviceId);
  const endTime = selectedService
    ? minToTime(toMin(form.time) + selectedService.durationMinutes) : "";
  // Which source (owner-renamable) opens the referrer field.
  const friendSource = pickFriendSource(referralOptions);

  async function save(override = false) {
    if (!form.staffId || !form.serviceId || !form.date || !form.time) return;
    const phone = selectedCustomer?.phone || newCustomer.phone;
    const name = selectedCustomer?.name || newCustomer.name;
    if (!phone || !name) return;
    // Referral source is optional — no longer required to confirm the appointment.
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
        // Send the barber's CUSTOM price/duration so the appointment reflects
        // their own pricing, not the shared service default.
        price: selectedService?.price,
        durationMinutes: selectedService?.durationMinutes,
        // Referral fields are only meaningful for new customers
        referralSource: customerMode === "new" ? referralSource : undefined,
        referrerPhone:  customerMode === "new" && !!friendSource && referralSource === friendSource ? referrerPhone.trim() : undefined,
        walkIn,
        notifyCustomer,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-neutral-100">
          <h3 className="font-bold text-neutral-900 text-lg">קביעת תור</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-neutral-100">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">

          {/* Pre-filled summary banner when opened from grid click */}
          {fromGrid && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-teal-500 flex items-center justify-center text-white font-bold text-base shrink-0">
                {(selectedStaff?.name || staff?.name || "?")[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-sm">{selectedStaff?.name || staff?.name}</p>
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

          {/* Staff — always a dropdown so the barber can be changed */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">
              ספר
              {fromGrid && <span className="text-teal-600 font-medium"> · ניתן לשנות</span>}
            </label>
            <select value={form.staffId} onChange={e => setForm(p => ({ ...p, staffId: e.target.value }))}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white text-neutral-900 cursor-pointer">
              {!fromGrid && <option value="">בחר ספר...</option>}
              {allStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Service */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">שירות</label>
            <select value={form.serviceId} onChange={e => setForm(p => ({ ...p, serviceId: e.target.value }))}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm">
              <option value="">בחר שירות...</option>
              {availableServices
                .map(s => <option key={s.id} value={s.id}>{s.name} – ₪{s.price} ({s.durationMinutes} דק׳)</option>)}
            </select>
            {endTime && <p className="text-xs text-neutral-400 mt-1">יסתיים בשעה {endTime}</p>}
          </div>

          {/* Customer */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-neutral-500">לקוח</label>
              <div className="flex gap-2 text-xs">
                <button onClick={() => { setCustomerMode("search"); setWalkIn(false); }}
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

                {/* Referral source — optional, but blinks while empty so it's not forgotten */}
                <div className={`pt-1 ${!referralSource ? "referral-missing px-2 py-1.5 -mx-2" : ""}`}>
                  <label className="text-[11px] text-neutral-500 block mb-1 flex items-center gap-1">
                    מקור הגעה{" "}
                    {!referralSource ? (
                      <span className="text-amber-700 font-semibold">⚠ לא הוזן — מומלץ למלא</span>
                    ) : (
                      <span className="text-neutral-400">(לא חובה)</span>
                    )}
                  </label>
                  <select
                    value={referralSource}
                    onChange={e => setReferralSource(e.target.value)}
                    className={`w-full border rounded-lg px-3 py-2 text-sm bg-white ${
                      !referralSource ? "border-amber-400" : "border-neutral-200"
                    }`}
                  >
                    <option value="">איך הוא הגיע אלינו?</option>
                    {referralOptions.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* If "friend referred friend" — collect referrer's phone */}
                {!!friendSource && referralSource === friendSource && (
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

          {/* Walk-in toggle — only for new customers */}
          {customerMode === "new" && (
            <button
              type="button"
              onClick={() => setWalkIn(v => !v)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                walkIn
                  ? "bg-teal-50 border-teal-300 text-teal-800"
                  : "bg-neutral-50 border-neutral-200 text-neutral-500"
              }`}
            >
              <span className="text-xl">📲</span>
              <div className="flex-1 text-right">
                <p className="text-sm font-medium">לקוח מזדמן</p>
                <p className="text-xs opacity-70">שלח הודעת תודה עם קישור הזמנה בסוף התור</p>
              </div>
              <div className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${walkIn ? "bg-teal-500" : "bg-neutral-300"}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${walkIn ? "right-1" : "right-5"}`} />
              </div>
            </button>
          )}

          {/* Notify customer toggle — sends a WhatsApp confirmation. Hidden for
              walk-ins (those get their own thank-you message at the end). */}
          {!walkIn && (
            <button
              type="button"
              onClick={() => setNotifyCustomer(v => !v)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                notifyCustomer
                  ? "bg-teal-50 border-teal-300 text-teal-800"
                  : "bg-neutral-50 border-neutral-200 text-neutral-500"
              }`}
            >
              <span className="text-xl">💬</span>
              <div className="flex-1 text-right">
                <p className="text-sm font-medium">שלח אישור ללקוח</p>
                <p className="text-xs opacity-70">הודעת וואטסאפ עם פרטי התור</p>
              </div>
              <div className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${notifyCustomer ? "bg-teal-500" : "bg-neutral-300"}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${notifyCustomer ? "right-1" : "right-5"}`} />
              </div>
            </button>
          )}
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
                  className="flex-1 bg-teal-600 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-teal-700">
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
            !(selectedCustomer || (newCustomer.name && newCustomer.phone))}
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
  const [name, setName] = useState("הפסקה");
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

    // Add the new break (with its name, set before creation)
    const newBreaks = [...existingBreaks, { start, end, name: name.trim() || "הפסקה" }];

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
        <div className="mb-3">
          <label className="text-xs text-neutral-500 block mb-1">שם ההפסקה</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="הפסקה" maxLength={40}
            className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
        </div>
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
  // Cancel confirmation — ask the barber what to notify before cancelling.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelNotifyCustomer, setCancelNotifyCustomer] = useState(true);
  const [cancelNotifyWaitlist, setCancelNotifyWaitlist] = useState(true);

  // ── Inline single-field editing ──────────────────────────────────────────
  // Each pencil edits ONLY its own field (name / date / time / price) instead
  // of opening the full edit form.
  const [inlineEdit, setInlineEdit] = useState<null | "name" | "date" | "time" | "price">(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineErr, setInlineErr] = useState<string | null>(null);
  const [inlineConflict, setInlineConflict] = useState<string | null>(null);
  // Local display copies — updated after a successful inline save so the modal
  // reflects the change without needing to be reopened.
  const [dispName,  setDispName]  = useState(appt.customer.name);
  const [dispPhone, setDispPhone] = useState(appt.customer.phone);
  const [dispDate,  setDispDate]  = useState(appt.date);
  const [dispStart, setDispStart] = useState(appt.startTime);
  const [dispEnd,   setDispEnd]   = useState(appt.endTime);
  const [dispPrice, setDispPrice] = useState(appt.price);
  // Working values for the currently-open inline editor
  const [editName,  setEditName]  = useState(appt.customer.name);
  const [editPhone, setEditPhone] = useState(appt.customer.phone);
  const [editDate,  setEditDate]  = useState(appt.date.split("T")[0]);
  const [editStart, setEditStart] = useState(appt.startTime);
  const [editEnd,   setEditEnd]   = useState(appt.endTime);
  const [editPrice, setEditPrice] = useState(String(appt.price));
  // Customer search in name editor
  const [custSuggestions, setCustSuggestions] = useState<{id:string;name:string;phone:string}[]>([]);
  // When a DIFFERENT existing customer is picked from the pool, we reassign the
  // appointment to them instead of renaming the current customer. Holds that
  // chosen customer's id; cleared when the user types manually (= edit in place).
  const [editCustomerId, setEditCustomerId] = useState<string | null>(null);

  useEffect(() => {
    if (inlineEdit !== "name" || editName.length < 1) { setCustSuggestions([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/admin/customers?q=${encodeURIComponent(editName)}`)
        .then(r => r.json()).then(d => setCustSuggestions(Array.isArray(d) ? d.slice(0, 6) : []));
    }, 200);
    return () => clearTimeout(t);
  }, [editName, inlineEdit]);

  function openInline(field: "name" | "date" | "time" | "price") {
    setInlineErr(null);
    setInlineConflict(null);
    if (field === "name") { setEditName(dispName); setEditPhone(dispPhone); setEditCustomerId(null); }
    if (field === "date") setEditDate(dispDate.split("T")[0]);
    if (field === "time") { setEditStart(dispStart); setEditEnd(dispEnd); }
    if (field === "price") setEditPrice(String(dispPrice));
    setInlineEdit(field);
  }

  // PATCH the appointment with just the changed field(s). Returns the updated
  // appointment on success, or null (and sets error/conflict state) on failure.
  async function patchApptField(partial: Record<string, unknown>, override = false): Promise<Appt | null> {
    setInlineSaving(true);
    setInlineErr(null);
    const body: Record<string, unknown> = { ...partial };
    if (override) body.override = true;
    const r = await fetch(`/api/admin/appointments/${appt.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setInlineSaving(false);
    if (r.status === 409) { const j = await r.json().catch(() => ({})); setInlineConflict(j.error || "יש התנגשות"); return null; }
    if (!r.ok) { const j = await r.json().catch(() => ({})); setInlineErr(j.error || "שגיאה בשמירה"); return null; }
    return await r.json().catch(() => null);
  }

  async function saveInlineName() {
    setInlineSaving(true);
    setInlineErr(null);

    // Case 1 — a DIFFERENT existing customer was picked from the pool: move the
    // appointment to them. We must NOT rename the current customer (that both
    // corrupts the original record and fails on the unique-phone constraint).
    if (editCustomerId && editCustomerId !== appt.customer.id) {
      const r = await fetch(`/api/admin/appointments/${appt.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: editCustomerId }),
      });
      setInlineSaving(false);
      if (!r.ok) { const j = await r.json().catch(() => ({})); setInlineErr(j.error || "שגיאה בשמירה"); return; }
      setDispName(editName.trim());
      setDispPhone(editPhone.trim());
      setEditCustomerId(null);
      setInlineEdit(null);
      onReload?.();
      return;
    }

    // Case 2 — editing THIS customer's name/phone in place (typo fix etc.).
    const r = await fetch(`/api/admin/customers/${appt.customer.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), phone: editPhone.trim() }),
    });
    setInlineSaving(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setInlineErr(j.error || "שגיאה בשמירה"); return; }
    if (editName.trim()) setDispName(editName.trim());
    if (editPhone.trim()) setDispPhone(editPhone.trim());
    setInlineEdit(null);
    onReload?.();
  }

  async function saveInlinePrice() {
    const updated = await patchApptField({ price: Number(editPrice) });
    if (updated) { setDispPrice(updated.price); setInlineEdit(null); onReload?.(); }
  }

  async function saveInlineDate(override = false) {
    const updated = await patchApptField({ date: editDate }, override);
    if (updated) { setDispDate(updated.date); setInlineConflict(null); setInlineEdit(null); onReload?.(); }
  }

  async function saveInlineTime(override = false) {
    // Send both start and end — the barber can adjust either independently.
    const updated = await patchApptField({ startTime: editStart, endTime: editEnd }, override);
    if (updated) { setDispStart(updated.startTime); setDispEnd(updated.endTime); setInlineConflict(null); setInlineEdit(null); onReload?.(); }
  }
  const [referralSource, setReferralSource] = useState(appt.customer.referralSource || "");
  const [editingReferral, setEditingReferral] = useState(false);
  const [savingReferral, setSavingReferral] = useState(false);
  const [referralOptions, setReferralOptions] = useState<string[]>([]);

  // Customer history modal
  const [showHistory, setShowHistory] = useState(false);

  // Active swap proposals where this appointment is involved
  const [proposalsAsPrimary, setProposalsAsPrimary] = useState<SwapProposal[]>([]);
  const [proposalAsCandidate, setProposalAsCandidate] = useState<SwapProposal | null>(null);

  // Delay notification
  const [showDelayInput, setShowDelayInput] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState("");
  const [delaySending, setDelaySending] = useState(false);
  const [delaySent, setDelaySent] = useState(false);
  const [delayError, setDelayError] = useState<string | null>(null);

  // Quick message
  const [showQuickMsg, setShowQuickMsg] = useState(false);
  const [quickMsg, setQuickMsg] = useState("");
  const [quickSending, setQuickSending] = useState(false);
  const [quickSent, setQuickSent] = useState(false);
  const [quickError, setQuickError] = useState("");

  // Convert this single appointment into a recurring (fixed) appointment.
  const [showRecurring, setShowRecurring] = useState(false);
  const [recurFreq, setRecurFreq] = useState<1 | 2 | 4>(1);
  // How far ahead to schedule: "12" (3 חודשים) | "26" (חצי שנה) | "52" (שנה) | "forever" (לתמיד)
  const [recurHorizon, setRecurHorizon] = useState<"12" | "26" | "52" | "forever">("forever");
  const [recurSaving, setRecurSaving] = useState(false);
  const [recurDone, setRecurDone] = useState<number | null>(null);
  const [recurError, setRecurError] = useState<string | null>(null);

  // Cancel an existing recurring series (or all of them).
  const [showCancelRecurring, setShowCancelRecurring] = useState(false);
  const [cancelRecurBusy, setCancelRecurBusy] = useState(false);

  async function createRecurring() {
    setRecurSaving(true);
    setRecurError(null);
    try {
      const dayPart = dispDate.split("T")[0];
      const dayOfWeek = new Date(dayPart + "T00:00:00.000Z").getUTCDay();
      const r = await fetch("/api/admin/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: appt.customer.id,
          staffId: appt.staff.id,
          serviceId: appt.service.id,
          dayOfWeek,
          startTime: dispStart,
          frequencyWeeks: recurFreq,
          startDate: dayPart,
          price: dispPrice,
          ...(recurHorizon === "forever"
            ? { forever: true }
            : { horizonWeeks: Number(recurHorizon) }),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setRecurError(j.error || "שגיאה ביצירת תור קבוע"); }
      else {
        setRecurDone(typeof j.created === "number" ? j.created : 0);
        setShowRecurring(false);
        onReload?.();
        setTimeout(() => setRecurDone(null), 5000);
      }
    } catch {
      setRecurError("שגיאת רשת — נסה שוב");
    } finally {
      setRecurSaving(false);
    }
  }

  // Cancel THIS recurring series (future occurrences) — appt.recurringId must be set.
  async function cancelThisSeries() {
    if (!appt.recurringId) return;
    if (!window.confirm("לבטל את כל התורים העתידיים בסדרה הקבועה הזו?")) return;
    setCancelRecurBusy(true);
    try {
      await fetch(`/api/admin/recurring/${appt.recurringId}?future=true`, { method: "DELETE" });
      setShowCancelRecurring(false);
      onReload?.();
      onClose();
    } catch {
      /* network — leave panel open so the user can retry */
    } finally {
      setCancelRecurBusy(false);
    }
  }

  // Cancel EVERY recurring series at once (owner → all, barber → own).
  async function cancelAllRecurring() {
    if (!window.confirm("לבטל את כל התורים הקבועים? כל הסדרות הקבועות יבוטלו (תורים עתידיים בלבד).")) return;
    setCancelRecurBusy(true);
    try {
      await fetch(`/api/admin/recurring?future=true`, { method: "DELETE" });
      setShowCancelRecurring(false);
      onReload?.();
      onClose();
    } catch {
      /* network — leave panel open so the user can retry */
    } finally {
      setCancelRecurBusy(false);
    }
  }

  async function sendQuickMessage() {
    if (!quickMsg.trim()) return;
    setQuickSending(true);
    setQuickError("");
    try {
      const res = await fetch("/api/admin/chats/send-quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: appt.customer.phone,
          customerName: appt.customer.name,
          message: quickMsg.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setQuickError(data.error || "שגיאה בשליחה"); }
      else {
        setQuickSent(true);
        setQuickMsg("");
        setShowQuickMsg(false);
        setTimeout(() => setQuickSent(false), 3000);
      }
    } catch {
      setQuickError("שגיאת חיבור");
    }
    setQuickSending(false);
  }

  // Build template messages with the customer/staff/time info already filled in
  const apptDateLabel = new Date(appt.date).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  const quickTemplates = [
    `היי ${appt.customer.name}, רק לאשר שהתור שלך ב${apptDateLabel} ב-${appt.startTime} עדיין רלוונטי? 🙏`,
    `היי ${appt.customer.name}, אני מאחר/ת בכמה דקות, מתנצל/ת על העיכוב 🙏`,
    `היי ${appt.customer.name}, התור הקרוב מתחיל בעוד 10 דקות. נתראה בקרוב! ✂️`,
  ];

  useEffect(() => {
    fetch("/api/admin/referral-sources")
      .then(r => r.ok ? r.json() : [])
      .then(data => setReferralOptions(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Load swap proposals involving this appointment.
  // Wrapped in a callable so we can refresh in-place after marking responses,
  // without forcing the user to close & reopen the modal.
  const refreshProposals = useCallback(() => {
    fetch(`/api/admin/swap-proposals?status=open&primaryAppointmentId=${appt.id}`)
      .then(r => r.ok ? r.json() : [])
      .then((d: SwapProposal[]) => setProposalsAsPrimary(Array.isArray(d) ? d : []))
      .catch(() => {});
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

  useEffect(() => { refreshProposals(); }, [refreshProposals]);

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

  // Cancel with explicit choices, then close the window (the appointment is gone).
  async function confirmCancel() {
    setUpdating(true);
    await fetch(`/api/admin/appointments/${appt.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "cancelled_by_staff",
        notifyCustomer: cancelNotifyCustomer,
        notifyWaitlist: cancelNotifyWaitlist,
      }),
    });
    onChange(appt.id, "cancelled_by_staff");
    setUpdating(false);
    setConfirmingCancel(false);
    onReload?.();
    onClose(); // close the customer window after cancelling
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
    setDelayError(null);
    try {
      const r = await fetch(`/api/admin/appointments/${appt.id}/notify-delay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delayMinutes: mins }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        setDelaySent(true);
        setShowDelayInput(false);
        setDelayMinutes("");
        setTimeout(() => setDelaySent(false), 3000);
      } else {
        setDelayError(j.error || "שליחת ההודעה נכשלה");
      }
    } catch {
      setDelayError("שגיאת רשת — נסה שוב");
    } finally {
      setDelaySending(false);
    }
  }

  const cleanPhone = dispPhone.replace(/\D/g, "").replace(/^0/, "972");

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
    <>
    {showHistory && (
      <CustomerHistoryModal
        customerId={appt.customer.id}
        customerName={appt.customer.name}
        onClose={() => setShowHistory(false)}
      />
    )}
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[20rem] shadow-2xl max-h-[82vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-neutral-100">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h3 className="font-bold text-base text-neutral-900 truncate">{appt.service.name}</h3>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${meta.badgeClass}`}>{meta.label}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {appt.recurringId ? (
              <button onClick={() => setShowCancelRecurring(v => !v)} title="תור קבוע — ניהול"
                className={`w-7 h-7 rounded-full flex items-center justify-center transition text-sm ${showCancelRecurring ? "bg-blue-600 text-white" : "bg-blue-100 hover:bg-blue-200"}`}>🔁</button>
            ) : (
              <button onClick={() => { setShowRecurring(v => !v); setRecurError(null); }} title="הפוך לתור קבוע"
                className={`w-7 h-7 rounded-full flex items-center justify-center transition text-sm ${showRecurring ? "bg-blue-600 text-white" : "bg-neutral-100 hover:bg-blue-50"}`}>🔁</button>
            )}
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center hover:bg-neutral-200 transition text-sm">✕</button>
          </div>
        </div>

        {/* Customer — compact row with pencil to edit (name/phone only) */}
        <div className="px-4 py-2 border-b border-neutral-100">
          {inlineEdit === "name" ? (
            <div className="space-y-2">
              <div className="relative">
                <input value={editName} onChange={e => { setEditName(e.target.value); setEditCustomerId(null); }} placeholder="חפש לקוח..."
                  autoFocus
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                {custSuggestions.length > 0 && (
                  <div className="absolute right-0 left-0 top-full mt-1 bg-white border border-neutral-200 rounded-xl shadow-xl z-50 overflow-hidden">
                    {custSuggestions.map(c => (
                      <button key={c.id} type="button"
                        onPointerDown={e => { e.preventDefault(); setEditName(c.name); setEditPhone(c.phone); setEditCustomerId(c.id); setCustSuggestions([]); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-teal-50 text-right transition border-b border-neutral-50 last:border-0">
                        <div className="w-7 h-7 rounded-full bg-neutral-200 text-neutral-700 flex items-center justify-center text-xs font-bold shrink-0">{c.name[0]}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-neutral-800 truncate">{c.name}</p>
                          <p className="text-[11px] text-neutral-400" dir="ltr">{c.phone}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input value={editPhone} onChange={e => { setEditPhone(e.target.value); setEditCustomerId(null); }} placeholder="טלפון" dir="ltr"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              {inlineErr && <p className="text-xs text-red-600">{inlineErr}</p>}
              <div className="flex gap-2">
                <button onClick={saveInlineName} disabled={inlineSaving}
                  className="flex-1 bg-teal-600 text-white rounded-lg py-1.5 text-xs font-semibold disabled:opacity-50">
                  {inlineSaving ? "שומר..." : "שמור"}
                </button>
                <button onClick={() => { setInlineEdit(null); setCustSuggestions([]); }} className="px-3 text-xs text-neutral-500">ביטול</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-neutral-200 flex items-center justify-center text-neutral-700 font-bold shrink-0">
                {dispName[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-neutral-900 text-sm truncate">{dispName}</p>
                <p className="text-xs text-neutral-500" dir="ltr">{dispPhone}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowHistory(true)} title="היסטוריית לקוח"
                  className="w-7 h-7 rounded-lg bg-neutral-100 hover:bg-amber-50 hover:text-amber-700 flex items-center justify-center text-neutral-500 text-sm transition">🕘</button>
                <button onClick={() => openInline("name")} title="ערוך שם לקוח"
                  className="w-7 h-7 rounded-lg bg-neutral-100 hover:bg-teal-50 hover:text-teal-700 flex items-center justify-center text-neutral-500 text-sm transition">✏️</button>
                <a href={`tel:${dispPhone}`}
                  className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center text-sm hover:bg-neutral-200 transition">📞</a>
                <a href={`https://wa.me/${cleanPhone}`} target="_blank"
                  className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-sm hover:bg-emerald-200 transition">💬</a>
              </div>
            </div>
          )}
        </div>

        {/* Details row — תאריך / שעה / מחיר each with pencil (inline, per-field) */}
        {inlineEdit === "date" || inlineEdit === "time" || inlineEdit === "price" ? (
          <div className="px-4 py-2 border-b border-neutral-100 space-y-2">
            {inlineEdit === "date" && (
              <>
                <label className="text-[11px] text-neutral-500 block">תאריך</label>
                <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} dir="ltr"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </>
            )}
            {inlineEdit === "time" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-neutral-500 block mb-1">שעת התחלה</label>
                    <input type="time" step={600} value={editStart} dir="ltr"
                      onChange={e => {
                        // Moving the start shifts the end by the same amount so the
                        // appointment keeps its length — the end stays editable below.
                        const newStart = e.target.value;
                        const dur = toMin(editEnd) - toMin(editStart);
                        setEditStart(newStart);
                        if (dur > 0 && newStart) {
                          setEditEnd(minToTime(Math.min(toMin(newStart) + dur, 23 * 60 + 59)));
                        }
                      }}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                  <div>
                    <label className="text-[11px] text-neutral-500 block mb-1">שעת סיום</label>
                    <input type="time" step={600} value={editEnd} onChange={e => setEditEnd(e.target.value)} dir="ltr"
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                </div>
                <p className="text-[11px] text-neutral-400">
                  {toMin(editEnd) > toMin(editStart)
                    ? `אורך התור: ${toMin(editEnd) - toMin(editStart)} דקות`
                    : "⚠ שעת הסיום חייבת להיות אחרי שעת ההתחלה"}
                </p>
              </>
            )}
            {inlineEdit === "price" && (
              <>
                <label className="text-[11px] text-neutral-500 block">מחיר (₪)</label>
                <input type="number" min={0} value={editPrice} onChange={e => setEditPrice(e.target.value)}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </>
            )}
            {inlineErr && <p className="text-xs text-red-600">{inlineErr}</p>}
            {inlineConflict ? (
              <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-2">
                <p className="text-slate-900">{inlineConflict}</p>
                <div className="flex gap-2">
                  <button onClick={() => inlineEdit === "date" ? saveInlineDate(true) : saveInlineTime(true)} disabled={inlineSaving}
                    className="flex-1 bg-teal-600 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-teal-700 disabled:opacity-50">כן, שמור בכל זאת</button>
                  <button onClick={() => setInlineConflict(null)}
                    className="flex-1 bg-white border border-slate-300 text-slate-700 rounded-lg py-1.5 text-xs">ביטול</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 pt-0.5">
                <button
                  onClick={() => inlineEdit === "date" ? saveInlineDate() : inlineEdit === "time" ? saveInlineTime() : saveInlinePrice()}
                  disabled={inlineSaving}
                  className="flex-1 bg-teal-600 text-white rounded-lg py-1.5 text-xs font-semibold disabled:opacity-50">
                  {inlineSaving ? "שומר..." : "שמור"}
                </button>
                <button onClick={() => { setInlineEdit(null); setInlineErr(null); }} className="px-3 text-xs text-neutral-500">ביטול</button>
              </div>
            )}
          </div>
        ) : (
          <div className="px-4 py-2 border-b border-neutral-100 grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] text-neutral-400">תאריך</p>
              <div className="flex items-center gap-1">
                <p className="font-medium text-neutral-800 text-sm leading-tight">{fmtDay(dispDate)}</p>
                <button onClick={() => openInline("date")} title="ערוך תאריך"
                  className="shrink-0 text-neutral-400 hover:text-teal-600 text-sm transition">✏️</button>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] text-neutral-400">שעה</p>
              <div className="flex items-center gap-1">
                <p className="font-medium text-neutral-800 text-sm" dir="ltr">{dispStart}–{dispEnd}</p>
                <button onClick={() => openInline("time")} title="ערוך שעה"
                  className="shrink-0 text-neutral-400 hover:text-teal-600 text-sm transition">✏️</button>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] text-neutral-400">מחיר</p>
              <div className="flex items-center gap-1">
                <p className="font-bold text-slate-800 text-sm">₪{dispPrice}</p>
                <button onClick={() => openInline("price")} title="ערוך מחיר"
                  className="shrink-0 text-neutral-400 hover:text-teal-600 text-sm transition">✏️</button>
              </div>
            </div>
          </div>
        )}

        {/* Convert to recurring (תור קבוע) */}
        {recurDone !== null && (
          <div className="px-4 py-2 border-b border-neutral-100">
            <p className="text-sm text-blue-700 font-medium text-center">
              ✓ נוצר תור קבוע — {recurDone} תורים נקבעו קדימה
            </p>
          </div>
        )}
        {showRecurring && (
          <div className="px-4 py-2.5 border-b border-neutral-100 bg-blue-50/50 space-y-2">
            <p className="text-xs font-semibold text-blue-800">🔁 הפוך לתור קבוע</p>
            <p className="text-[11px] text-neutral-500 leading-snug">
              ייקבעו תורים נוספים ל{dispName} בכל {recurFreq === 1 ? "שבוע" : recurFreq === 2 ? "שבועיים" : "חודש"} באותו יום ושעה.
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {([[1, "כל שבוע"], [2, "כל שבועיים"], [4, "כל חודש"]] as const).map(([f, label]) => (
                <button key={f} onClick={() => setRecurFreq(f)}
                  className={`py-1.5 rounded-lg text-xs font-medium transition border ${recurFreq === f ? "bg-blue-600 text-white border-blue-600" : "bg-white text-neutral-600 border-neutral-200 hover:border-blue-300"}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-neutral-500 leading-snug pt-0.5">למשך כמה זמן?</p>
            <div className="grid grid-cols-4 gap-1.5">
              {([["12", "3 חודשים"], ["26", "חצי שנה"], ["52", "שנה"], ["forever", "לתמיד"]] as const).map(([h, label]) => (
                <button key={h} onClick={() => setRecurHorizon(h)}
                  className={`py-1.5 rounded-lg text-[11px] font-medium transition border ${recurHorizon === h ? "bg-blue-600 text-white border-blue-600" : "bg-white text-neutral-600 border-neutral-200 hover:border-blue-300"}`}>
                  {label}
                </button>
              ))}
            </div>
            {recurHorizon === "forever" && (
              <p className="text-[10px] text-neutral-400 leading-snug">
                התורים ימשיכו להיקבע אוטומטית קדימה ללא הגבלת זמן.
              </p>
            )}
            {recurError && <p className="text-xs text-red-600">{recurError}</p>}
            <div className="flex gap-2 pt-0.5">
              <button onClick={createRecurring} disabled={recurSaving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-1.5 text-xs font-semibold disabled:opacity-50 transition">
                {recurSaving ? "יוצר..." : "צור תור קבוע"}
              </button>
              <button onClick={() => { setShowRecurring(false); setRecurError(null); }}
                className="px-3 text-xs text-neutral-500">ביטול</button>
            </div>
          </div>
        )}
        {/* Manage / cancel an existing recurring series */}
        {showCancelRecurring && appt.recurringId && (
          <div className="px-4 py-2.5 border-b border-neutral-100 bg-blue-50/50 space-y-2">
            <p className="text-xs font-semibold text-blue-800">🔁 תור קבוע</p>
            <p className="text-[11px] text-neutral-500 leading-snug">
              התור הזה חלק מסדרה קבועה. ניתן לבטל את כל התורים העתידיים בלחיצה אחת.
            </p>
            <button onClick={cancelThisSeries} disabled={cancelRecurBusy}
              className="w-full bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-lg py-1.5 text-xs font-semibold disabled:opacity-50 transition">
              {cancelRecurBusy ? "מבטל..." : "בטל את הסדרה הזו"}
            </button>
            <button onClick={cancelAllRecurring} disabled={cancelRecurBusy}
              className="w-full bg-red-600 hover:bg-red-700 text-white rounded-lg py-1.5 text-xs font-semibold disabled:opacity-50 transition">
              בטל את כל התורים הקבועים
            </button>
            <button onClick={() => setShowCancelRecurring(false)}
              className="w-full px-3 py-1 text-xs text-neutral-500">סגור</button>
          </div>
        )}

        {/* Referral source — blinks while missing so it's caught on the next visit too */}
        <div className={`px-4 py-2 border-b border-neutral-100 ${!referralSource && !editingReferral ? "referral-missing" : ""}`}>
          <div className="flex items-center justify-between mb-1">
            <p className={`text-xs ${!referralSource && !editingReferral ? "text-amber-700 font-semibold" : "text-neutral-400"}`}>
              מקור הגעה{!referralSource && !editingReferral ? " — ⚠ חסר" : ""}
            </p>
            {!editingReferral && (
              <button onClick={() => setEditingReferral(true)}
                className={`text-xs hover:underline ${referralSource ? "text-slate-800" : "text-amber-700 font-semibold"}`}>
                {referralSource ? "ערוך" : "הוסף עכשיו"}
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
            <p className={`text-sm ${referralSource ? "text-neutral-800" : "text-amber-700 italic font-medium"}`}>
              {referralSource || "לא הוזן — לחץ \"הוסף עכשיו\""}
            </p>
          )}
        </div>

        {/* Customer note */}
        {appt.note && (
          <div className="px-4 py-2 border-b border-neutral-100">
            <p className="text-xs text-neutral-400 mb-1">הערת לקוח</p>
            <p className="text-sm text-neutral-700 bg-neutral-50 rounded-lg px-3 py-2">{appt.note}</p>
          </div>
        )}

        {/* Staff note */}
        <div className="px-4 py-2 border-b border-neutral-100">
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
        <div className="px-4 py-2 border-b border-neutral-100">
          <p className="text-xs text-neutral-400 mb-2">שינוי סטטוס</p>
          {confirmingCancel ? (
            <div className="bg-red-50/60 border border-red-200 rounded-xl p-3 space-y-3">
              <p className="text-sm font-semibold text-red-700">לבטל את התור של {dispName}?</p>
              {/* notify customer toggle */}
              <button type="button" onClick={() => setCancelNotifyCustomer(v => !v)}
                className="w-full flex items-center gap-2.5 text-right">
                <div className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${cancelNotifyCustomer ? "bg-teal-500" : "bg-neutral-300"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${cancelNotifyCustomer ? "right-0.5" : "right-4"}`} />
                </div>
                <span className="text-sm text-slate-700">עדכן את הלקוח על הביטול בוואטסאפ</span>
              </button>
              {/* notify waitlist toggle */}
              <button type="button" onClick={() => setCancelNotifyWaitlist(v => !v)}
                className="w-full flex items-center gap-2.5 text-right">
                <div className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${cancelNotifyWaitlist ? "bg-teal-500" : "bg-neutral-300"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${cancelNotifyWaitlist ? "right-0.5" : "right-4"}`} />
                </div>
                <span className="text-sm text-slate-700">עדכן את רשימת ההמתנה שהתפנה תור</span>
              </button>
              <div className="flex gap-2 pt-0.5">
                <button onClick={confirmCancel} disabled={updating}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-50">
                  {updating ? "מבטל..." : "כן, בטל תור"}
                </button>
                <button onClick={() => setConfirmingCancel(false)} disabled={updating}
                  className="px-4 bg-white border border-slate-300 text-slate-700 rounded-lg py-2 text-sm">חזרה</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button disabled={appt.status === "confirmed" || updating} onClick={() => setStatus("confirmed")}
                className="py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-default bg-emerald-50 text-emerald-700 border border-emerald-200">✓ מאשר</button>
              <button disabled={appt.status === "cancelled_by_staff" || updating} onClick={() => { setCancelNotifyCustomer(true); setCancelNotifyWaitlist(true); setConfirmingCancel(true); }}
                className="py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-40 disabled:cursor-default bg-red-50 text-red-600 border border-red-200">בטל תור</button>
            </div>
          )}
        </div>

        {/* ── Swap panel ── */}
        <div className="px-4 py-2 border-b border-neutral-100">
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
                    onClick={() => onMarkSwap(proposalAsCandidate.id, "mark_accepted").then(() => { refreshProposals(); onReload?.(); })}
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
              {/* Both sides can finalize the swap once the customer agreed */}
              {proposalAsCandidate.status === "accepted_by_customer" && (
                <button onClick={() => onApproveSwap(proposalAsCandidate.id)}
                  className="w-full mt-1 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold">
                  🤝 אשר החלפה (יבוצע ויישלח אישור לשני הלקוחות)
                </button>
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
                          <button onClick={() => onMarkSwap(p.id, "mark_accepted").then(() => { refreshProposals(); onReload?.(); })}
                            className="py-1 rounded text-[10px] bg-emerald-500 hover:bg-emerald-600 text-white font-bold">
                            ✓ הסכים
                          </button>
                          <button onClick={() => onMarkSwap(p.id, "mark_rejected").then(() => { refreshProposals(); onReload?.(); })}
                            className="py-1 rounded text-[10px] bg-red-100 hover:bg-red-200 text-red-700 font-bold">
                            ✗ דחה
                          </button>
                          <button onClick={() => onMarkSwap(p.id, "cancel").then(() => { refreshProposals(); onReload?.(); })}
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
              className="w-full py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold transition flex items-center justify-center gap-2">
              🔄 החלף / העבר תור
            </button>
          )}
        </div>

        {/* Delay notification */}
        <div className="px-4 py-2 border-b border-neutral-100">
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
                  onClick={() => { setShowDelayInput(false); setDelayMinutes(""); setDelayError(null); }}
                  className="text-neutral-400 hover:text-neutral-600 px-2 rounded-lg hover:bg-neutral-50 transition">
                  ✕
                </button>
              </div>
              {delayError && (
                <p className="text-xs text-red-600 font-medium">{delayError}</p>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowDelayInput(true)}
              className="w-full py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 text-xs font-medium transition flex items-center justify-center gap-2">
              ⏱ עדכון עיכוב
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="px-4 py-3 space-y-2">
          {/* Quick message — sends from system, persists in chats */}
          {quickSent ? (
            <p className="text-sm text-emerald-600 font-medium text-center py-2">✓ ההודעה נשלחה ל-{appt.customer.name}</p>
          ) : showQuickMsg ? (
            <div className="space-y-2 bg-emerald-50/50 border border-emerald-100 rounded-xl p-3">
              {/* Quick templates */}
              <div className="flex flex-wrap gap-1">
                {quickTemplates.map((tpl, i) => (
                  <button key={i}
                    onClick={() => setQuickMsg(tpl)}
                    className="text-[10px] bg-white hover:bg-emerald-100 border border-emerald-200 text-emerald-700 px-2 py-1 rounded-full transition">
                    {["📅 אישור", "⏱ עיכוב", "🔔 תזכורת"][i]}
                  </button>
                ))}
              </div>
              <textarea
                value={quickMsg}
                onChange={e => setQuickMsg(e.target.value)}
                rows={3}
                placeholder={`כתוב הודעה ל${appt.customer.name}...`}
                dir="rtl"
                autoFocus
                className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 resize-none"
              />
              {quickError && <p className="text-xs text-red-500">{quickError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={sendQuickMessage}
                  disabled={quickSending || !quickMsg.trim()}
                  className="flex-1 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 transition">
                  {quickSending ? "שולח..." : "💬 שלח ב-WhatsApp"}
                </button>
                <button
                  onClick={() => { setShowQuickMsg(false); setQuickMsg(""); setQuickError(""); }}
                  className="px-4 py-2 text-neutral-500 hover:bg-neutral-100 rounded-lg text-sm transition">
                  ביטול
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowQuickMsg(true)}
              className="block w-full py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium text-center hover:bg-emerald-600 transition">
              💬 שלח הודעה מהירה
            </button>
          )}
          <a href={`https://wa.me/${cleanPhone}`} target="_blank"
            className="block w-full py-1.5 rounded-lg bg-white border border-neutral-200 text-neutral-600 text-xs font-medium text-center hover:bg-neutral-50 transition">
            פתח WhatsApp ישירות ↗
          </a>
        </div>
      </div>
    </div>
    </>
  );
}

// ── Customer history modal ─────────────────────────────────────────────────────
type CustomerHistory = {
  name: string;
  phone: string;
  notes?: string | null;
  notificationPrefs?: string | null;
  totalVisits?: number;
  past?: Array<{ id: string; date: string; startTime: string; status: string; staff?: { name: string } | null; service?: { name: string } | null }>;
};

function CustomerHistoryModal({ customerId, customerName, onClose }:
  { customerId: string; customerName: string; onClose: () => void }
) {
  const [data, setData] = useState<CustomerHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/customers/${customerId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [customerId]);

  // Notes are stored inside notificationPrefs JSON ({ notes: "..." })
  let note = "";
  if (data?.notificationPrefs) {
    try { note = JSON.parse(data.notificationPrefs)?.notes || ""; } catch { /* ignore */ }
  }

  // Distinct barbers visited (from past appointments)
  const past = data?.past || [];
  const barberCounts = new Map<string, number>();
  for (const a of past) {
    const n = a.staff?.name;
    if (n) barberCounts.set(n, (barberCounts.get(n) || 0) + 1);
  }
  const barbers = Array.from(barberCounts.entries());

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-neutral-100 sticky top-0 bg-white">
          <h3 className="font-bold text-neutral-900 text-base">היסטוריה · {customerName}</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center text-sm hover:bg-neutral-200 transition">✕</button>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-neutral-400 text-sm">טוען...</div>
        ) : !data ? (
          <div className="px-5 py-10 text-center text-neutral-400 text-sm">לא נמצאו נתונים</div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Notes about the customer */}
            <div>
              <p className="text-xs text-neutral-400 mb-1">הערה על הלקוח</p>
              {note ? (
                <p className="text-sm text-neutral-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{note}</p>
              ) : (
                <p className="text-sm text-neutral-400 italic">אין הערות</p>
              )}
            </div>

            {/* Barbers visited */}
            <div>
              <p className="text-xs text-neutral-400 mb-1.5">ספרים שהיה אצלם</p>
              {barbers.length === 0 ? (
                <p className="text-sm text-neutral-400 italic">אין ביקורים</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {barbers.map(([name, count]) => (
                    <span key={name} className="text-xs bg-teal-50 text-teal-700 border border-teal-100 rounded-full px-2.5 py-1">
                      {name} · {count}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Visit history list */}
            <div>
              <p className="text-xs text-neutral-400 mb-1.5">
                ביקורים אחרונים {typeof data.totalVisits === "number" ? `(${data.totalVisits} תספורות)` : ""}
              </p>
              {past.length === 0 ? (
                <p className="text-sm text-neutral-400 italic">אין היסטוריה</p>
              ) : (
                <ul className="space-y-1.5">
                  {past.slice(0, 30).map(a => (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-xs border border-neutral-100 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="font-medium text-neutral-800 truncate">{a.service?.name || "שירות"}</p>
                        <p className="text-neutral-500">{a.staff?.name || "—"}</p>
                      </div>
                      <div className="text-left shrink-0">
                        <p className="text-neutral-700">{new Date(a.date).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" })}</p>
                        <p className="text-neutral-400" dir="ltr">{a.startTime}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
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
                  className="flex-1 bg-teal-600 text-white rounded-lg py-1.5 text-xs font-medium hover:bg-teal-700">
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
  const [breaks, setBreaks] = useState<{ start: string; end: string; recurring?: boolean }[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [newWaiting, setNewWaiting] = useState({ name: "", phone: "", serviceId: "" });
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  // Add-to-waitlist: pick from existing customers ("search") or type a new one ("new")
  const [waitMode, setWaitMode] = useState<"search" | "new">("search");
  const [waitQuery, setWaitQuery] = useState("");
  const [waitCustomers, setWaitCustomers] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [waitSelected, setWaitSelected] = useState<{ id: string; name: string; phone: string } | null>(null);
  // When a save EXPANDS availability and people are waiting that day, we always
  // ask the manager before messaging the waitlist (instead of auto-sending).
  const [notifyPrompt, setNotifyPrompt] = useState<{ count: number } | null>(null);
  const [notifying, setNotifying] = useState(false);

  useEffect(() => {
    // First check for a date-specific override, then fall back to weekly schedule
    Promise.all([
      fetch(`/api/admin/staff/${staffId}/schedule/override?date=${date}`).then(r => r.json()),
      fetch("/api/admin/staff").then(r => r.json()),
    ]).then(([override, allStaff]) => {
      if (override && override.staffId) {
        // Date-specific override exists — use it
        const slots = override.slots ? JSON.parse(override.slots) : [];
        setHours({
          isWorking: override.isWorking,
          start: slots[0]?.start || "09:00",
          end: slots[0]?.end || "20:00",
        });
        setBreaks(override.breaks ? JSON.parse(override.breaks) : []);
      } else {
        // No override — fall back to weekly recurring schedule
        const s = allStaff.find((x: {id:string}) => x.id === staffId);
        const dow = new Date(date + "T00:00:00").getDay();
        const sched = s?.schedules?.find((sc: {dayOfWeek: number}) => sc.dayOfWeek === dow);
        if (sched) {
          const slots = JSON.parse(sched.slots || "[]");
          setHours({ isWorking: sched.isWorking, start: slots[0]?.start || "09:00", end: slots[0]?.end || "20:00" });
          setBreaks(sched.breaks ? JSON.parse(sched.breaks) : []);
        }
      }
    }).catch(() => {});
    fetch(`/api/admin/waitlist?date=${date}&staffId=${staffId}`).then(r => r.json()).then(setWaitlist).catch(() => {});
    fetch("/api/admin/services").then(r => r.json()).then(setServices).catch(() => {});
  }, [date, staffId]);

  // Live customer search for the "add to waitlist" picker
  useEffect(() => {
    if (waitMode !== "search" || waitQuery.length < 1) { setWaitCustomers([]); return; }
    fetch(`/api/admin/customers?q=${encodeURIComponent(waitQuery)}`)
      .then(r => r.json()).then(setWaitCustomers).catch(() => {});
  }, [waitQuery, waitMode]);

  // Post-save handling shared by both save flows. Reads the override response:
  // if availability grew and someone is waiting that day, surface the "notify
  // the waitlist?" prompt; otherwise just confirm + auto-close.
  async function afterSave(res: Response) {
    const data = await res.json().catch(() => ({} as { availabilityExpanded?: boolean; waitlistCount?: number }));
    setSaved(true);
    onRefresh();
    if (data?.availabilityExpanded && (data?.waitlistCount ?? 0) > 0) {
      setNotifyPrompt({ count: data.waitlistCount as number });
    } else {
      setTimeout(() => { setSaved(false); onClose(); }, 800);
    }
  }

  async function confirmNotifyWaitlist() {
    setNotifying(true);
    try {
      await fetch(`/api/admin/staff/${staffId}/schedule/notify-waitlist`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
    } catch { /* graceful — provider may be unconfigured */ }
    setNotifying(false);
    setNotifyPrompt(null);
    setSaved(false);
    onClose();
  }

  function dismissNotifyPrompt() {
    setNotifyPrompt(null);
    setSaved(false);
    onClose();
  }

  async function doSave(body: object) {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/staff/${staffId}/schedule/override`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `HTTP ${res.status}`);
      }
      await afterSave(res);
    } catch (e) {
      setSaveError(`שגיאה בשמירה${e instanceof Error ? `: ${e.message}` : ""} — נסה שוב`);
    } finally {
      setSaving(false);
    }
  }

  async function saveHours() {
    await doSave({ date, isWorking: hours.isWorking, slots: [{ start: hours.start, end: hours.end }], breaks });
  }

  async function closeDay() {
    setHours(p => ({ ...p, isWorking: false }));
    await doSave({ date, isWorking: false });
  }

  function removeBreak(idx: number) {
    setBreaks(prev => prev.filter((_, i) => i !== idx));
  }

  function addBreak() {
    setBreaks(prev => [...prev, { start: "13:00", end: "14:00", recurring: false }]);
  }

  // Save breaks:
  // - Day override always gets ALL breaks (so today is always correct).
  // - Breaks marked as recurring ALSO update the weekly schedule (PATCH).
  async function saveBreaks() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      // Strip recurring flag for API calls (API doesn't know about it)
      const breaksForApi = breaks.map(({ start, end }) => ({ start, end }));

      // Always save as a day override first
      const r1 = await fetch(`/api/admin/staff/${staffId}/schedule/override`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, isWorking: hours.isWorking, slots: [{ start: hours.start, end: hours.end }], breaks: breaksForApi }),
      });
      if (!r1.ok) throw new Error(`HTTP ${r1.status}`);

      // If any breaks are recurring → also update weekly schedule with recurring breaks only
      const recurringBreaks = breaks.filter(b => b.recurring).map(({ start, end }) => ({ start, end }));
      if (recurringBreaks.length > 0) {
        const dow = new Date(date + "T00:00:00").getDay();
        const r2 = await fetch(`/api/admin/staff/${staffId}/schedule`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dayOfWeek: dow, isWorking: hours.isWorking, slots: [{ start: hours.start, end: hours.end }], breaks: recurringBreaks }),
        });
        if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
      }

      await afterSave(r1);
    } catch (e) {
      setSaveError(`שגיאה בשמירה${e instanceof Error ? `: ${e.message}` : ""} — נסה שוב`);
    } finally {
      setSaving(false);
    }
  }

  async function addToWaitlist() {
    const phone = waitMode === "search" ? waitSelected?.phone : newWaiting.phone;
    const name  = waitMode === "search" ? waitSelected?.name  : newWaiting.name;
    if (!phone || !newWaiting.serviceId) return;
    await fetch("/api/admin/waitlist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, name: name || phone, serviceId: newWaiting.serviceId, staffId, date }),
    });
    setNewWaiting({ name: "", phone: "", serviceId: "" });
    setWaitSelected(null); setWaitQuery(""); setWaitCustomers([]);
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
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4" onClick={notifyPrompt ? undefined : onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {notifyPrompt && (
          <div className="px-5 py-6 space-y-4">
            <div className="text-center space-y-1.5">
              <div className="text-3xl">⏳</div>
              <h3 className="font-bold text-neutral-900 text-base">התפנה זמן ביום זה</h3>
              <p className="text-sm text-neutral-500">
                {notifyPrompt.count === 1
                  ? "לקוח אחד ממתין ברשימת ההמתנה ליום הזה."
                  : `${notifyPrompt.count} לקוחות ממתינים ברשימת ההמתנה ליום הזה.`}
                <br />
                להודיע להם שהתפנה תור?
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={confirmNotifyWaitlist} disabled={notifying}
                className="flex-1 bg-teal-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                {notifying ? "שולח..." : "כן, הודע להם"}
              </button>
              <button onClick={dismissNotifyPrompt} disabled={notifying}
                className="px-4 bg-white border border-neutral-300 text-neutral-700 py-2.5 rounded-xl text-sm disabled:opacity-50">
                לא, תודה
              </button>
            </div>
          </div>
        )}
        {!notifyPrompt && <>
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
              className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === key ? "border-teal-600 text-slate-700" : "border-transparent text-neutral-500"}`}>
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
              {saveError && (
                <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 border border-red-200">{saveError}</p>
              )}
              {saved && (
                <p className="text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-200 font-semibold text-center">✓ נשמר!</p>
              )}
              <div className="flex gap-2">
                <button onClick={saveHours} disabled={saving || saved}
                  className="flex-1 bg-teal-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {saving ? "שומר..." : "שמור"}
                </button>
                <button onClick={closeDay} disabled={saving || saved}
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
                <div key={i} className="bg-orange-50 rounded-xl px-3 py-2 border border-orange-100 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono font-medium text-orange-800 flex-1" dir="ltr">{br.start} – {br.end}</span>
                    <button onClick={() => removeBreak(i)} className="text-red-400 text-sm hover:text-red-600 shrink-0">✕</button>
                  </div>
                  <div className="flex items-center gap-2" dir="ltr">
                    <input type="time" value={br.start}
                      onChange={e => setBreaks(prev => prev.map((b, j) => j === i ? { ...b, start: e.target.value } : b))}
                      className="border border-orange-200 rounded px-2 py-1 text-xs flex-1" />
                    <span className="text-xs text-orange-400">—</span>
                    <input type="time" value={br.end}
                      onChange={e => setBreaks(prev => prev.map((b, j) => j === i ? { ...b, end: e.target.value } : b))}
                      className="border border-orange-200 rounded px-2 py-1 text-xs flex-1" />
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none w-fit">
                    <input type="checkbox" checked={!!br.recurring}
                      onChange={e => setBreaks(prev => prev.map((b, j) => j === i ? { ...b, recurring: e.target.checked } : b))}
                      className="w-3.5 h-3.5 accent-teal-600" />
                    <span className="text-[11px] text-neutral-500">
                      קבוע — כל יום {new Date(date + "T00:00:00").toLocaleDateString("he-IL", { weekday: "long" })}
                    </span>
                  </label>
                </div>
              ))}
              <button onClick={addBreak}
                className="w-full border-2 border-dashed border-neutral-200 text-neutral-400 py-2 rounded-xl text-sm hover:border-slate-300 hover:text-slate-800 transition">
                + הוסף הפסקה
              </button>

              {saveError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 border border-red-200">{saveError}</p>}
              {saved && <p className="text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-200 font-semibold text-center">✓ נשמר!</p>}
              <button onClick={saveBreaks} disabled={saving || saved}
                className="w-full bg-teal-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? "שומר..." : "שמור הפסקות"}
              </button>
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
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-neutral-500">הוסף להמתנה</p>
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => { setWaitMode("search"); setNewWaiting(p => ({ ...p, name: "", phone: "" })); }}
                      className={`px-2 py-0.5 rounded-full ${waitMode === "search" ? "bg-slate-100 text-slate-700" : "text-neutral-400"}`}>
                      מרשימת לקוחות
                    </button>
                    <button onClick={() => { setWaitMode("new"); setWaitSelected(null); setWaitQuery(""); setWaitCustomers([]); }}
                      className={`px-2 py-0.5 rounded-full ${waitMode === "new" ? "bg-slate-100 text-slate-700" : "text-neutral-400"}`}>
                      לקוח חדש
                    </button>
                  </div>
                </div>

                {waitMode === "search" ? (
                  waitSelected ? (
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <span className="text-sm font-medium text-emerald-800 flex-1">{waitSelected.name}</span>
                      <span className="text-xs text-emerald-600" dir="ltr">{waitSelected.phone}</span>
                      <button onClick={() => setWaitSelected(null)} className="text-emerald-500 text-xs">✕</button>
                    </div>
                  ) : (
                    <>
                      <input value={waitQuery} onChange={e => setWaitQuery(e.target.value)}
                        placeholder="חפש לפי שם או טלפון..."
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                      {waitCustomers.length > 0 && (
                        <div className="border border-neutral-200 rounded-lg max-h-40 overflow-y-auto">
                          {waitCustomers.map(c => (
                            <button key={c.id} onClick={() => { setWaitSelected(c); setWaitQuery(""); setWaitCustomers([]); }}
                              className="w-full text-right px-3 py-2 hover:bg-neutral-50 border-b border-neutral-50 last:border-0">
                              <p className="text-sm font-medium">{c.name}</p>
                              <p className="text-xs text-neutral-400" dir="ltr">{c.phone}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )
                ) : (
                  <>
                    <input value={newWaiting.name} onChange={e => setNewWaiting(p => ({ ...p, name: e.target.value }))}
                      placeholder="שם" className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                    <input value={newWaiting.phone} onChange={e => setNewWaiting(p => ({ ...p, phone: e.target.value }))}
                      placeholder="טלפון" dir="ltr" className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                  </>
                )}

                <select value={newWaiting.serviceId} onChange={e => setNewWaiting(p => ({ ...p, serviceId: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">בחר שירות...</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={addToWaitlist}
                  disabled={!newWaiting.serviceId || (waitMode === "search" ? !waitSelected : !newWaiting.phone)}
                  className="w-full bg-teal-600 text-white py-2 rounded-xl text-sm font-semibold disabled:opacity-40">
                  + הוסף לרשימה
                </button>
              </div>
            </div>
          )}
        </div>
        </>}
      </div>
    </div>
  );
}

// ── Time Column ───────────────────────────────────────────────────────────────
function TimeColumn() {
  const hh = React.useContext(HHCtx);
  const { start: calStart, end: calEnd } = React.useContext(HourRangeCtx);
  const totalHours = calEnd - calStart;
  const totalHeight = totalHours * hh;
  return (
    <div className="w-14 shrink-0 relative select-none" style={{ height: totalHeight }}>
      {Array.from({ length: totalHours + 1 }, (_, i) => (
        <div key={i} className="absolute right-2 text-[11px] text-neutral-600 font-mono font-semibold" style={{ top: i * hh - 7 }}>
          {String(calStart + i).padStart(2, "0")}:00
        </div>
      ))}
    </div>
  );
}

// ── Grid Lines (15-minute intervals) ──────────────────────────────────────────
function GridLines() {
  const hh = React.useContext(HHCtx);
  const { start: calStart, end: calEnd } = React.useContext(HourRangeCtx);
  // 4 segments per hour (15 min each)
  const segments = (calEnd - calStart) * 4;
  return (
    <div className="absolute inset-0 pointer-events-none">
      {Array.from({ length: segments + 1 }, (_, i) => {
        const isHour    = i % 4 === 0;
        const isHalfHour = i % 2 === 0;
        return (
          <div key={i}
            className={`absolute left-0 right-0 border-t ${
              isHour      ? "border-neutral-300" :
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
  onMove, onConfirm, onDismiss, onDragMoved, onHorizontalDragEnd, columnSnapDeltaX,
}: {
  startY: number;
  durationMinutes: number;   // must match primary appointment length
  onMove: (y: number) => void;
  onConfirm: (startTime: string) => void;
  onDismiss: () => void;
  onDragMoved?: () => void;
  /** Called when the user releases after a horizontal drag — clientX of the pointer */
  onHorizontalDragEnd?: (clientX: number) => void;
  /** Magnetize horizontal drag to the day/staff axis (same as a real appointment). */
  columnSnapDeltaX?: (clientX: number, originClientX: number) => number | null;
}) {
  const hh = React.useContext(HHCtx);
  const { start: calStart, end: calEnd } = React.useContext(HourRangeCtx);
  const isMobile = useIsMobile();
  const totalH = (calEnd - calStart) * hh;
  const blockH = Math.max((durationMinutes / 60) * hh, isMobile ? 40 : 36);
  // Magnetize to the 5-minute grid, exactly like dragging a real appointment.
  const clampedTop = snapYToGrid(Math.max(0, Math.min(totalH - blockH, startY)), hh);
  const startTime = yToTimeFn(clampedTop, hh, calStart, calEnd);
  const dragRef = useRef<{ clientY: number; clientX: number; startY: number } | null>(null);
  // CSS translateX so the block slides across columns while pointer capture is held
  const [transX, setTransX] = React.useState(0);

  return (
    <div
      className="no-touch-select absolute left-1 right-1 select-none cursor-grab active:cursor-grabbing"
      style={{
        top: clampedTop,
        height: blockH,
        touchAction: "none",
        transform: transX !== 0 ? `translateX(${transX}px)` : undefined,
        zIndex: transX !== 0 ? 50 : 30,  // float above other columns when dragging sideways
      }}
      onPointerDown={e => {
        // Don't hijack clicks that land on buttons — let them fire normally
        if ((e.target as HTMLElement).closest("button")) return;
        e.stopPropagation();
        // Listen on `window` (not pointer-capture) so the drag survives the
        // per-move re-render that `onMove` triggers — mobile WebKit otherwise
        // drops the capture and the drag freezes. See DraftApptBlock for detail.
        const start = { clientY: e.clientY, clientX: e.clientX, startY: clampedTop };
        dragRef.current = start;
        setTransX(0);
        let moved = false;
        const onWinMove = (ev: PointerEvent) => {
          ev.preventDefault();
          const newY = Math.max(0, Math.min(totalH - blockH, start.startY + ev.clientY - start.clientY));
          onMove(newY);
          const snapped = columnSnapDeltaX?.(ev.clientX, start.clientX);
          setTransX(snapped != null ? snapped : ev.clientX - start.clientX);
          if (Math.abs(ev.clientY - start.clientY) > 5 || Math.abs(ev.clientX - start.clientX) > 5) moved = true;
        };
        const onWinUp = (ev: PointerEvent) => {
          const dx = Math.abs(ev.clientX - start.clientX);
          if (moved) onDragMoved?.();
          // Sticky to current day, but a small horizontal nudge slides to another day
          if (dx > 15) onHorizontalDragEnd?.(ev.clientX);
          dragRef.current = null;
          setTransX(0);
          window.removeEventListener("pointermove", onWinMove);
          window.removeEventListener("pointerup", onWinUp);
          window.removeEventListener("pointercancel", onWinUp);
        };
        window.addEventListener("pointermove", onWinMove, { passive: false });
        window.addEventListener("pointerup", onWinUp);
        window.addEventListener("pointercancel", onWinUp);
      }}
      onClick={e => e.stopPropagation()}>

      <div className="relative w-full h-full">
        {/* Floating time bubble — above the bar so the finger can't hide it */}
        <div
          className={`absolute left-1/2 -translate-x-1/2 bg-teal-700 text-white text-[13px] font-extrabold px-3 py-0.5 rounded-full shadow-xl ring-2 ring-white pointer-events-none whitespace-nowrap z-50 ${clampedTop < 40 ? "top-[40px]" : "-top-8"}`}
          dir="ltr">
          ↕ {startTime}
        </div>
        {/* Slim draggable bar (grip + time) — the grab area; NOT a button so it
            can be dragged anywhere along it. A compact confirm sits at the end. */}
        <div
          className="absolute inset-x-0 top-0 h-7 rounded-lg bg-teal-600 flex items-center gap-2 px-2 shadow-lg ring-1 ring-teal-700/50"
          style={{ borderRight: "4px solid rgba(13, 148, 136, 1)" }}>
          {/* Dismiss */}
          <button className="shrink-0 text-white/80 hover:text-white text-[11px] leading-none p-0.5"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDismiss(); }}>✕</button>
          {/* grip dots — signals "drag me" */}
          <span className="flex flex-col gap-[3px] shrink-0 opacity-80">
            <span className="flex gap-[3px]"><i className="w-[3px] h-[3px] rounded-full bg-white block" /><i className="w-[3px] h-[3px] rounded-full bg-white block" /></span>
            <span className="flex gap-[3px]"><i className="w-[3px] h-[3px] rounded-full bg-white block" /><i className="w-[3px] h-[3px] rounded-full bg-white block" /></span>
          </span>
          <span className="text-white text-[14px] font-extrabold tabular-nums" dir="ltr">{startTime}</span>
          {/* Confirm — compact, doesn't cover the drag area */}
          <button
            className="shrink-0 mr-auto text-[10px] font-bold text-teal-700 bg-white hover:bg-teal-50 rounded px-2 py-1 leading-none transition"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onConfirm(startTime); }}>
            ✓ העבר לכאן
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Draft Appointment Block (Google-Calendar style click-to-place) ─────────────
function DraftApptBlock({
  startY, staffName,
  onMove, onConfirm, onAddBreak, onDismiss, onDragMoved, onHorizontalDragEnd, columnSnapDeltaX, onColHover,
}: {
  startY: number; staffName: string; date: string;
  onMove: (y: number) => void;
  onConfirm: () => void;
  onAddBreak: () => void;
  onDismiss: () => void;
  onDragMoved?: () => void;
  /** Called when the user releases after a horizontal drag — clientX of the pointer */
  onHorizontalDragEnd?: (clientX: number) => void;
  /** Magnetize horizontal drag to the day/staff axis. Given current + origin
   *  clientX, returns the translateX that snaps the block onto the column under
   *  the finger (so it locks to a day instead of floating between days). */
  columnSnapDeltaX?: (clientX: number, originClientX: number) => number | null;
  /** Reports the pointer X during a drag so the parent can highlight the target
   *  day column (null on release/cancel). Makes the day-axis lock visible. */
  onColHover?: (clientX: number | null) => void;
}) {
  const hh = React.useContext(HHCtx);
  const { start: calStart, end: calEnd } = React.useContext(HourRangeCtx);
  const isMobile = useIsMobile();
  const totalH = (calEnd - calStart) * hh;
  // The VISIBLE frame represents a single 10-minute window, so it grows/shrinks
  // as the calendar is zoomed (hourHeight). Floored so it stays tappable.
  const tenMinH = Math.max(7, Math.round((10 / 60) * hh));
  // Touch HIT area — bigger than the thin frame on mobile so the frame is still
  // easy to grab with a finger; on desktop the pill is its own size.
  const blockH = isMobile ? Math.max(tenMinH, 44) : 36;
  // Magnetize the block to the 5-minute grid so it locks onto clean times.
  const clampedTop = snapYToGrid(Math.max(0, Math.min(totalH - blockH, startY)), hh);
  const time = yToTimeFn(clampedTop, hh, calStart, calEnd);
  const dragRef = useRef<{ clientY: number; clientX: number; startY: number } | null>(null);
  // CSS translateX so the block slides across columns while pointer capture is held
  const [transX, setTransX] = React.useState(0);
  void staffName;

  // ── Keep the mobile action pill inside the viewport ──
  // The pill is centered over a narrow column, so on the edge columns it would
  // overflow off-screen (e.g. "+ קבע" clipped on the left). Measure the block's
  // position after layout and nudge the pill horizontally so it stays visible.
  const blockRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const [pillShift, setPillShift] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!isMobile) return;
    const block = blockRef.current, pill = pillRef.current;
    if (!block || !pill) return;
    const br = block.getBoundingClientRect();
    const pw = pill.offsetWidth;
    const centerX = br.left + br.width / 2;
    const margin = 6;
    const vw = window.innerWidth;
    let shift = 0;
    const left = centerX - pw / 2;
    const right = centerX + pw / 2;
    if (left < margin) shift = margin - left;
    else if (right > vw - margin) shift = (vw - margin) - right;
    setPillShift(Math.round(shift));
  }, [isMobile, time, transX, clampedTop]);

  return (
    <div
      ref={blockRef}
      className="no-touch-select absolute left-1 right-1 select-none cursor-grab active:cursor-grabbing"
      style={{
        top: clampedTop,
        height: blockH,
        touchAction: "none",
        transform: transX !== 0 ? `translateX(${transX}px)` : undefined,
        zIndex: transX !== 0 ? 50 : 30,  // float above other columns when dragging sideways
      }}
      onPointerDown={e => {
        if ((e.target as HTMLElement).closest("button")) return;
        e.stopPropagation();
        // NOTE: we deliberately do NOT use setPointerCapture here. `onMove`
        // re-renders this block on every move, and mobile WebKit drops the
        // capture when the captured element re-renders mid-gesture — which made
        // the drag "freeze/cancel" after the first tiny movement. Instead we
        // listen on `window`, which keeps receiving events across re-renders.
        const start = { clientY: e.clientY, clientX: e.clientX, startY: clampedTop };
        dragRef.current = start;
        setTransX(0);
        let moved = false;
        const onWinMove = (ev: PointerEvent) => {
          ev.preventDefault();
          // Vertical: update time
          const newY = Math.max(0, Math.min(totalH - blockH, start.startY + ev.clientY - start.clientY));
          onMove(newY);
          // Horizontal: MAGNETIZE to the day/staff axis — snap the block so it
          // aligns exactly with the column under the finger.
          const snapped = columnSnapDeltaX?.(ev.clientX, start.clientX);
          setTransX(snapped != null ? snapped : ev.clientX - start.clientX);
          // Highlight the day column under the finger (visible day-axis lock).
          onColHover?.(ev.clientX);
          if (Math.abs(ev.clientY - start.clientY) > 5 || Math.abs(ev.clientX - start.clientX) > 5) moved = true;
        };
        const onWinUp = (ev: PointerEvent) => {
          const dx = Math.abs(ev.clientX - start.clientX);
          if (moved) onDragMoved?.();
          // If horizontal drag happened, inform parent of final clientX so it can pick target column
          if (dx > 15) onHorizontalDragEnd?.(ev.clientX);
          onColHover?.(null);
          dragRef.current = null;
          setTransX(0);
          window.removeEventListener("pointermove", onWinMove);
          window.removeEventListener("pointerup", onWinUp);
          window.removeEventListener("pointercancel", onWinUp);
        };
        window.addEventListener("pointermove", onWinMove, { passive: false });
        window.addEventListener("pointerup", onWinUp);
        window.addEventListener("pointercancel", onWinUp);
      }}
      onClick={e => e.stopPropagation()}>

      {isMobile ? (
        // ── Mobile: a transparent ~10-minute window — just an outline frame the
        //    finger drags. The frame scales with zoom (tenMinH); a generous
        //    invisible hit area (blockH) keeps it easy to grab. The time floats
        //    above the frame with a gap so the finger never hides it.
        <div className="relative w-full h-full">
          {/* Floating action pill — time + compact buttons, attached right by the
              start-line marker so it never covers the calendar grid/day headers.
              Buttons stopPropagation so taps don't start a drag. */}
          <div
            ref={pillRef}
            style={{ transform: `translateX(calc(-50% + ${pillShift}px))` }}
            className={`absolute left-1/2 flex items-center gap-1.5 bg-white rounded-full shadow-xl ring-1 ring-slate-200 pl-1.5 pr-2 py-1 whitespace-nowrap z-50 ${clampedTop < 60 ? "top-full mt-2" : "-top-12"}`}>
            <button
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-sm leading-none transition"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onDismiss(); }}>✕</button>
            <span className="text-sm font-extrabold text-slate-800 tabular-nums" dir="ltr">{time}</span>
            <button
              className="shrink-0 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs px-3 py-1.5 rounded-full transition"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onConfirm(); }}>+ קבע</button>
            <button
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 hover:bg-teal-50 text-[15px] transition"
              title="הוסף הפסקה"
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onAddBreak(); }}>☕</button>
          </div>
          {/* Transparent 10-minute frame — outline only, anchored at the start line */}
          <div
            className="absolute inset-x-0 top-0 rounded-md border-2 border-teal-500 bg-teal-400/15 shadow-[0_0_0_1px_rgba(255,255,255,0.7)]"
            style={{ height: tenMinH }}>
            {/* Start-line accent so the exact time is unmistakable */}
            <div className="absolute -top-px right-0 left-0 h-0.5 rounded-full bg-teal-600" />
          </div>
        </div>
      ) : (
        // ── Desktop: compact horizontal pill
        <div
          className="w-full h-full rounded-md bg-white/85 backdrop-blur-sm border border-slate-300/70 flex items-center gap-1.5 px-2"
          style={{ borderRight: "2.5px solid rgba(13, 148, 136, 0.85)" }}>
          <button
            className="text-slate-400 hover:text-slate-700 text-xs leading-none shrink-0 p-1"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDismiss(); }}>✕</button>
          <button
            className="flex-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 truncate text-right"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onConfirm(); }}>
            + קבע ב־{time}
          </button>
          <button
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md bg-slate-100 hover:bg-teal-50 border border-slate-200 hover:border-teal-300 text-[14px] transition"
            title="הוסף הפסקה"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onAddBreak(); }}>
            ☕
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Calendar ─────────────────────────────────────────────────────────────
export default function AdminCalendar() {
  const [view, setView] = useState<ViewType>("week");
  const [date, setDate] = useState(todayISO());
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [visibleStaff, setVisibleStaff] = useState<string[]>([]);
  // activeBarber is shared across ALL views (day/week/3day) — used for the "+ תור" button default
  const [weekBarber, setWeekBarber] = useState<string>("");
  const [dayBarber, setDayBarber] = useState<string>("");
  // Calendar display hours — loaded from business settings
  const [calStart, setCalStart] = useState(DAY_START);
  const [calEnd, setCalEnd] = useState(DAY_END);
  // Business-default booking horizon (days). Per-staff overrides live in staff.settings.
  const [bizHorizon, setBizHorizon] = useState(30);
  // Barber permissions
  const [isOwner, setIsOwner] = useState(true); // optimistic
  const [barbersCanViewOthersCalendar, setBarbersCanViewOthersCalendar] = useState(false);
  // Hours picker (local override stored in localStorage)
  const [showHoursPicker, setShowHoursPicker] = useState(false);
  const [localCalStart, setLocalCalStart] = useState(DAY_START);
  const [localCalEnd, setLocalCalEnd] = useState(DAY_END);
  const [appointments, setAppointments] = useState<Appt[]>([]);
  // Override map: keyed by `${staffId}|YYYY-MM-DD`
  const [overrideMap, setOverrideMap] = useState<Record<string, { isWorking: boolean; slots: string | null; breaks: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [showFilter, setShowFilter] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<Appt | null>(null);
  const [newAppt, setNewAppt] = useState<{ staffId: string; date: string; time: string } | null>(null);
  const [addBreak, setAddBreak] = useState<{ staffId: string; date: string; time: string } | null>(null);
  const [editingBreak, setEditingBreak] = useState<{ staffId: string; date: string; breakIdx: number; initial: RawBreak } | null>(null);
  const [draftAppt, setDraftAppt] = useState<{ staffId: string; date: string; startY: number } | null>(null);
  const [draftMoveSlot, setDraftMoveSlot] = useState<{ staffId: string; date: string; startY: number } | null>(null);
  const [dayMenu, setDayMenu] = useState<{ date: string; staffId: string } | null>(null);
  const [waitlistCounts, setWaitlistCounts] = useState<Record<string, number>>({});
  const [swipeToast, setSwipeToast] = useState<string | null>(null);
  const isMobile = useIsMobile();
  // ── Zoom & drag ──────────────────────────────────────────────────────────────
  const [hourHeight, setHourHeight] = useState(DEFAULT_HOUR_HEIGHT);
  const [drag, setDrag] = useState<DragState>(null);
  const hourHeightRef = useRef(DEFAULT_HOUR_HEIGHT);
  hourHeightRef.current = hourHeight;
  const totalHours = calEnd - calStart;
  const totalHeight = totalHours * hourHeight;
  const [nowY, setNowY] = useState(() => nowPxFn(DEFAULT_HOUR_HEIGHT, DAY_START));

  // ── Draft appointment action handlers (used by fixed mobile bottom bar) ──────
  const handleDraftConfirm = React.useCallback(() => {
    if (!draftAppt) return;
    setNewAppt({ staffId: draftAppt.staffId, date: draftAppt.date, time: yToTimeFn(draftAppt.startY, hourHeight, calStart, calEnd) });
    setDraftAppt(null);
  }, [draftAppt, hourHeight, calStart, calEnd]);
  const handleDraftBreak = React.useCallback(() => {
    if (!draftAppt) return;
    setAddBreak({ staffId: draftAppt.staffId, date: draftAppt.date, time: yToTimeFn(draftAppt.startY, hourHeight, calStart, calEnd) });
    setDraftAppt(null);
  }, [draftAppt, hourHeight, calStart, calEnd]);
  const gridRef = useRef<HTMLDivElement>(null);

  // Cancel an open draft when the user taps anywhere OUTSIDE the calendar grid
  // — e.g. the hamburger menu, headers, toolbar. Taps INSIDE the grid reposition
  // the draft (handled by the column onClick), and the draft's own action pill
  // lives inside the grid so its buttons keep working.
  useEffect(() => {
    if (!draftAppt && !draftMoveSlot) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (gridRef.current?.contains(t)) return;       // inside the calendar — reposition, don't cancel
      setDraftAppt(null);
      setDraftMoveSlot(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [draftAppt, draftMoveSlot]);
  // The week/3day grid wrapper — translated horizontally during swipe-to-page-weeks.
  const weekPagerRef = useRef<HTMLDivElement>(null);
  // Tracks a horizontal swipe over the barber-name picker (switches barbers).
  const barberSwipe = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
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

  // Mirror the active draft (select-time) state into a ref so the imperative
  // touch handler can read it. While a draft slot is active we lock week-paging
  // / date-flicking so adjusting the slot left/right doesn't switch the week.
  const draftApptRef = useRef<typeof draftAppt>(null);
  draftApptRef.current = draftAppt;

  // ── Drag-to-MOVE breaks (same long-press → ghost → drop model as appts) ──────
  type BreakDragState = {
    staffId: string; date: string; breakIdx: number;
    name: string; durationMin: number; origStartMin: number;
    // How far (in minutes) below the break's top the finger grabbed it. Used to
    // keep the break rigid under the finger while dragging — otherwise the
    // break's TOP snaps to the finger and you can never pin it to the hour you
    // actually aimed for.
    grabOffsetMin: number;
    pointerX: number; pointerY: number;
    dropTarget: { staffId: string; date: string; startTime: string } | null;
  };
  const [breakDrag, setBreakDrag] = useState<BreakDragState | null>(null);
  const breakDragRef = useRef<BreakDragState | null>(null);
  breakDragRef.current = breakDrag;
  const breakDragProcessed = useRef(false);

  // Guard against double-finalize: when the user taps the in-drag ✓/✕ buttons
  // their onPointerDown fires before the global pointerup, so without this flag
  // finalizeMoveDrag would run twice and create a duplicate pendingMove.
  const isDragProcessed = useRef(false);

  // ── Resume-drag support ("אדייק שוב") ──────────────────────────────────────
  // When a move is RE-ENTERED from the pending card, no pointer is down yet, so
  // a stray tap must not drop the ghost. We require real finger movement before
  // a resumed drag can finalize. These refs track that.
  const dragResumedRef = useRef(false);          // true while a drag was resumed via the pending card
  const dragMovedRef = useRef(false);            // pointer actually moved during the resumed drag
  const dragStartPt = useRef<{ x: number; y: number } | null>(null);

  // Same resume guards for BREAK drags (mirrors the appointment flow above).
  const breakDragResumedRef = useRef(false);
  const breakDragMovedRef = useRef(false);
  const breakDragStartPt = useRef<{ x: number; y: number } | null>(null);

  // Last VALID drop target seen during a drag. On release the pointer is often
  // over a gap (between columns / outside the grid) where computeDropTarget
  // returns null — which would throw the drag away and force the user to start
  // over. We fall back to this last-known-good target so a sloppy release keeps
  // the move instead of losing it. Tracked separately for appts and breaks.
  const lastMoveTargetRef = useRef<{ staffId: string; date: string; startTime: string } | null>(null);
  const lastBreakTargetRef = useRef<{ staffId: string; date: string; startTime: string } | null>(null);

  // After a drop, we DON'T immediately PATCH the API. We hold the proposed
  // target in `pendingMove` and show a small confirmation card with three
  // actions: confirm (commits the move), continue (re-enters drag mode for
  // fine-tuning), and cancel (drops the proposal entirely). This prevents
  // accidental moves on mobile where a long-press easily turns into a sloppy
  // release.
  type PendingMove = {
    appt: Appt;
    target: { staffId: string; date: string; startTime: string };
  };
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);

  // Same idea for BREAK drags: after releasing, hold the proposed target and
  // show a confirm card (✓/✕) instead of writing the schedule immediately —
  // mirrors the appointment move flow so a sloppy release can't silently move
  // a break to the wrong time.
  type PendingBreakMove = {
    drag: BreakDragState;
    target: { staffId: string; date: string; startTime: string };
  };
  const [pendingBreakMove, setPendingBreakMove] = useState<PendingBreakMove | null>(null);

  // Column refs — keyed by `${staffId}|${date}` so we can identify which column
  // the pointer is over during a drag-move. Rebuilt on each render based on
  // current view (day = many staff, week = many days).
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Find which column (staffId + date) contains a given clientX screen coordinate.
  // Used by DraftApptBlock to land on the right column after a horizontal drag.
  const findColumnByX = React.useCallback((clientX: number): { staffId: string; date: string } | null => {
    for (const [key, el] of Object.entries(colRefs.current)) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        const [staffId, date] = key.split("|");
        return { staffId, date };
      }
    }
    return null;
  }, []);

  // Magnetize horizontal drags to the day/staff axis: given where the drag
  // STARTED (originClientX) and where the finger is NOW (clientX), return the
  // exact translateX that snaps the block to align with the column under the
  // finger. This makes the block jump cleanly column-to-column instead of
  // floating in the gap between two days.
  const columnSnapDeltaX = React.useCallback((clientX: number, originClientX: number): number | null => {
    const rectAt = (x: number): DOMRect | null => {
      for (const el of Object.values(colRefs.current)) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right) return rect;
      }
      return null;
    };
    const origin = rectAt(originClientX);
    const target = rectAt(clientX);
    if (!origin || !target) return null;
    return target.left - origin.left;
  }, []);

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
    // Opening an existing appointment exits any open time-selection draft.
    setDraftAppt(null);
    setDraftMoveSlot(null);
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
  // Only owners persist their chosen barber. For a barber, switching is temporary —
  // they always reopen on their own calendar (handled in loadStaff).
  useEffect(() => { if (weekBarber && isOwner) savePrefs({ weekBarber }); }, [weekBarber, isOwner]);

  // Update nowY whenever hourHeight or calStart changes
  useEffect(() => {
    setNowY(nowPxFn(hourHeight, calStart));
    const t = setInterval(() => setNowY(nowPxFn(hourHeightRef.current, calStart)), 60_000);
    return () => clearInterval(t);
  }, [hourHeight, calStart]);

  // Ref so the swipe handler always calls the current navigate()
  const navigateRef = useRef<(dir: -1 | 1) => void>(() => {});
  navigateRef.current = navigate;

  // Navigate between barbers in week/3day view (swipe gesture)
  function navigateBarber(dir: -1 | 1) {
    if (!allStaff.length) return;
    const idx = allStaff.findIndex(s => s.id === weekBarber);
    const base = idx === -1 ? 0 : idx;
    const newIdx = (base + dir + allStaff.length) % allStaff.length;
    const newS = allStaff[newIdx];
    setWeekBarber(newS.id);
    setSwipeToast(newS.name);
  }
  const navigateBarberRef = useRef<(dir: -1 | 1) => void>(() => {});
  navigateBarberRef.current = navigateBarber;

  // Swipe left/right over the barber-name picker → switch between barbers' calendars.
  function onBarberTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) return;
    barberSwipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onBarberTouchEnd(e: React.TouchEvent) {
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - barberSwipe.current.x;
    const dy = Math.abs(t.clientY - barberSwipe.current.y);
    if (Math.abs(dx) > 35 && Math.abs(dx) > dy * 1.5) {
      navigateBarber(dx > 0 ? -1 : 1);
    }
  }

  // Slide the week grid in from the side after a swipe — "paging" feedback so the
  // user sees the week move/flip rather than snap. `dx` is the swipe delta.
  function playWeekSlide(dx: number) {
    const el = weekPagerRef.current;
    if (!el) return;
    const w = el.clientWidth || 320;
    // New week enters from the opposite edge of the swipe direction.
    const from = dx > 0 ? -w : w;
    el.style.transition = "none";
    el.style.transform = `translateX(${from}px)`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = "transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = "translateX(0)";
    }));
  }
  const playWeekSlideRef = useRef<(dx: number) => void>(() => {});
  playWeekSlideRef.current = playWeekSlide;

  // Expose current view to the swipe closure (which captures nothing via deps:[])
  const viewRef = useRef<ViewType>(view);
  viewRef.current = view;

  // Auto-dismiss swipe toast after 1.4 s
  useEffect(() => {
    if (!swipeToast) return;
    const t = setTimeout(() => setSwipeToast(null), 1400);
    return () => clearTimeout(t);
  }, [swipeToast]);

  // Pinch-to-zoom + horizontal swipe-to-navigate touch handler on the grid
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    let startDist = 0;
    let startHH = 0;
    let swipeStartX = 0;
    let swipeStartY = 0;
    let isPinch = false;
    let axis: null | "x" | "y" = null; // locked gesture axis for the current touch
    let paging = false;                // live horizontal week-paging in progress

    const isWeekView = () => viewRef.current === "week" || viewRef.current === "3day";

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        isPinch = true;
        startDist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY
        );
        startHH = hourHeightRef.current;
      } else if (e.touches.length === 1) {
        isPinch = false;
        axis = null;
        paging = false;
        swipeStartX = e.touches[0].clientX;
        swipeStartY = e.touches[0].clientY;
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
        return;
      }
      if (isPinch || e.touches.length !== 1 || swipeStartX === 0) return;
      const dx = e.touches[0].clientX - swipeStartX;
      const dy = e.touches[0].clientY - swipeStartY;
      // Lock to an axis once the finger has clearly moved.
      if (axis === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      // Live week-paging: only in week/3day view, only when dragging horizontally,
      // and never while moving an appointment. The whole grid follows the finger.
      if (axis === "x" && isWeekView() && !dragMoveRef.current && !draftApptRef.current && !breakDragRef.current) {
        paging = true;
        e.preventDefault(); // stop vertical scroll from fighting the page drag
        const el = weekPagerRef.current;
        if (el) { el.style.transition = "none"; el.style.transform = `translateX(${dx}px)`; }
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      startDist = 0;
      const dx = (e.changedTouches[0]?.clientX ?? swipeStartX) - swipeStartX;
      const dy = Math.abs((e.changedTouches[0]?.clientY ?? swipeStartY) - swipeStartY);

      if (paging) {
        // Live week-paging finished — commit (slide new week in) or snap back.
        const el = weekPagerRef.current;
        const committed = Math.abs(dx) > 70;
        if (committed) {
          // User's requested direction: drag left→right (dx>0) = NEXT week.
          const weekDir: -1 | 1 = dx > 0 ? 1 : -1;
          if (el) {
            const w = el.clientWidth || 320;
            el.style.transition = "transform 0.14s ease-out";
            el.style.transform = `translateX(${dx > 0 ? w : -w}px)`;
          }
          window.setTimeout(() => {
            navigateRef.current(weekDir);          // advance one week
            playWeekSlideRef.current(dx);          // slide the new week in
          }, 140);
        } else if (el) {
          el.style.transition = "transform 0.16s ease-out";
          el.style.transform = "translateX(0)";
        }
      } else if (!isPinch && e.changedTouches.length === 1 && swipeStartX !== 0) {
        // Non-paging gesture (day view) — navigate dates on a strong horizontal flick.
        const dragActive = !!dragMoveRef.current || !!draftApptRef.current || !!breakDragRef.current;
        if (!dragActive && Math.abs(dx) > 90 && Math.abs(dx) > dy * 2) {
          // Match the week view: drag left→right (dx>0) = NEXT (forward),
          // right→left = previous. (Day view used to be inverted.)
          navigateRef.current(dx > 0 ? 1 : -1);
        }
      }
      swipeStartX = 0;
      axis = null;
      paging = false;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
    // Re-attach when the grid (re)mounts: it only exists once loading finishes
    // and is replaced by a placeholder in month view, so gridRef.current changes.
  }, [loading, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Staff + services + settings loader (extracted so it can be re-called) ──
  const loadStaff = useCallback(async (isFirstLoad = false) => {
    const [st, sv, biz, me] = await Promise.all([
      fetch("/api/admin/staff").then(r => r.json()),
      fetch("/api/admin/services").then(r => r.json()),
      fetch("/api/admin/settings").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("/api/admin/me").then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    // Restrict the visible staff list for a barber who lacks "view all calendars".
    // They only ever see their own column — the appointments API enforces the
    // same scoping on the server, so other barbers' data never reaches them.
    const myStaffId: string | null = me?.staffId ?? null;
    const canViewAllCalendars = (me?.isOwner ?? true) || (me?.barbersCanViewOthersCalendar ?? false);
    const effectiveStaff: Staff[] = (canViewAllCalendars || !myStaffId)
      ? (st as Staff[])
      : (st as Staff[]).filter((s: Staff) => s.id === myStaffId);
    setAllStaff(effectiveStaff);
    if (isFirstLoad) {
      setVisibleStaff(effectiveStaff.map((s: Staff) => s.id));
      if (effectiveStaff.length) {
        const saved = loadPrefs().weekBarber;
        const iAmBarber = !!me && !me.isOwner;
        let defaultBarber = effectiveStaff[0].id;
        if (iAmBarber && myStaffId && effectiveStaff.some((s: Staff) => s.id === myStaffId)) {
          // A barber always lands on their OWN calendar — never a remembered
          // selection of someone else's. Switching to another barber is temporary.
          defaultBarber = myStaffId;
        } else if (saved && effectiveStaff.some((s: Staff) => s.id === saved)) {
          defaultBarber = saved;
        } else if (myStaffId && effectiveStaff.some((s: Staff) => s.id === myStaffId)) {
          defaultBarber = myStaffId;
        }
        setWeekBarber(defaultBarber);
        setDayBarber(defaultBarber);
      }
    }
    if (me) {
      setIsOwner(me.isOwner ?? true);
      setBarbersCanViewOthersCalendar(me.barbersCanViewOthersCalendar ?? false);
      // Barbers always default to their own week view on first load
      if (isFirstLoad && !me.isOwner) {
        setView("week");
        savePrefs({ view: "week" });
      }
    }
    setServices(sv);
    if (biz && typeof biz.bookingHorizonDays === "number") setBizHorizon(biz.bookingHorizonDays);
    if (isFirstLoad) {
      let serverStart = DAY_START;
      let serverEnd = DAY_END;
      if (biz?.settings) {
        try {
          const s = JSON.parse(biz.settings);
          if (typeof s.calendarStartHour === "number") serverStart = s.calendarStartHour;
          if (typeof s.calendarEndHour   === "number") serverEnd = s.calendarEndHour;
        } catch { /* ignore */ }
      }
      const savedHours = typeof window !== "undefined" ? localStorage.getItem("cal_hours") : null;
      if (savedHours) {
        try {
          const h = JSON.parse(savedHours);
          if (typeof h.start === "number") serverStart = h.start;
          if (typeof h.end === "number") serverEnd = h.end;
        } catch { /* ignore */ }
      }
      setCalStart(serverStart);
      setCalEnd(serverEnd);
      setLocalCalStart(serverStart);
      setLocalCalEnd(serverEnd);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load staff + services + calendar settings once on mount
  useEffect(() => { loadStaff(true); }, [loadStaff]);

  // Re-fetch staff (schedules/breaks) when the tab becomes visible again —
  // this picks up changes made in settings without a full page refresh.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadStaff(false); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadStaff]);

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
    const startDate = dates[0];
    const endDate   = dates[dates.length - 1];
    const [apptResults, overridesRaw] = await Promise.all([
      Promise.all(dates.map(d => fetch(`/api/admin/appointments?date=${d}`).then(r => r.json()))),
      fetch(`/api/admin/schedule-overrides?startDate=${startDate}&endDate=${endDate}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    ]);
    setAppointments(apptResults.flat());
    // Build override map keyed by `${staffId}|YYYY-MM-DD`
    const map: Record<string, { isWorking: boolean; slots: string | null; breaks: string | null }> = {};
    for (const ov of (overridesRaw as Array<{ staffId: string; date: string; isWorking: boolean; slots: string | null; breaks: string | null }>)) {
      map[`${ov.staffId}|${ov.date}`] = { isWorking: ov.isWorking, slots: ov.slots, breaks: ov.breaks };
    }
    setOverrideMap(map);
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
    if (gridRef.current && !loading) gridRef.current.scrollTop = Math.max(nowPxFn(hourHeightRef.current, calStart) - 120, 0);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch waitlist counts for visible dates — scoped to the week's barber so the
  // red badge only appears on the calendar of the staff member who actually has
  // someone waiting (not on every barber's calendar).
  useEffect(() => {
    const dates = getDates();
    // Week view always shows a single barber — scope the badge to that barber.
    const effectiveStaffId = weekBarber || allStaff[0]?.id || "";
    const staffParam = effectiveStaffId ? `&staffId=${effectiveStaffId}` : "";
    Promise.all(
      dates.map(d =>
        fetch(`/api/admin/waitlist?date=${d}${staffParam}`).then(r => r.json()).then(data => [d, data.length])
      )
    ).then(results => {
      const counts: Record<string, number> = {};
      for (const [d, count] of results) counts[d as string] = count as number;
      setWaitlistCounts(counts);
    }).catch(() => {});
  }, [getDates, weekBarber, allStaff]);

  function saveLocalHours() {
    setCalStart(localCalStart);
    setCalEnd(localCalEnd);
    localStorage.setItem("cal_hours", JSON.stringify({ start: localCalStart, end: localCalEnd }));
    setShowHoursPicker(false);
  }

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
        const startTime = yToTimeFn(yInCol, hourHeightRef.current, calStart, calEnd);
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
    isDragProcessed.current = false; // reset for a fresh drag
    dragResumedRef.current = false;  // a fresh long-press drag, not a resume
    lastMoveTargetRef.current = null;
    setDragMove({ appt, pointerX: clientX, pointerY: clientY, dropTarget: null });
    // Haptic feedback (iOS Safari + Android Chrome)
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(30);
    }
  }

  // Drop handler — does NOT commit the move. Instead, hands off to
  // `pendingMove` so the user gets one more chance to confirm/adjust/cancel
  // before any API call. The original appointment stays in place visually.
  const finalizeMoveDrag = useCallback((target: { staffId: string; date: string; startTime: string } | null) => {
    // Prevent double-fire: the in-drag ✓/✕ buttons use onPointerDown which
    // fires before the global window pointerup — without this guard, the
    // global handler would run a second finalizeMoveDrag call on the same drop.
    if (isDragProcessed.current) return;
    isDragProcessed.current = true;

    const drag = dragMoveRef.current;
    setDragMove(null);
    // Block the synthetic click that fires on the grid cell under the cursor
    // right after pointerup — otherwise it would create a DraftApptBlock on
    // top of the drop location.
    suppressNextGridClick.current = true;
    if (!drag || !target) return;
    const origDate = drag.appt.date.slice(0, 10);
    const origStaff = drag.appt.staff.id;
    const origStart = drag.appt.startTime;
    // No change → no-op
    if (target.staffId === origStaff && target.date === origDate && target.startTime === origStart) return;

    setPendingMove({ appt: drag.appt, target });
  }, []);

  // Commit a confirmed pending move: optimistic local update + PATCH.
  const commitPendingMove = useCallback(async () => {
    const pending = pendingMove;
    if (!pending) return;
    setPendingMove(null);
    const duration = toMin(pending.appt.endTime) - toMin(pending.appt.startTime);
    const newEnd = minToTime(toMin(pending.target.startTime) + duration);
    const newStaff = allStaff.find(s => s.id === pending.target.staffId);
    const movedAppt: Appt = {
      ...pending.appt,
      startTime: pending.target.startTime,
      endTime: newEnd,
      date: pending.target.date + "T00:00:00.000Z",
      staff: { id: pending.target.staffId, name: newStaff?.name || pending.appt.staff.name },
    };
    setAppointments(prev => prev.map(a => a.id === pending.appt.id ? movedAppt : a));
    try {
      const succeeded = await persistMove(pending.appt, pending.target, false);
      if (succeeded) setNotifyMove(movedAppt);
    } catch (err) {
      console.error(err);
    }
  }, [pendingMove, allStaff, persistMove]);

  // Re-enter drag mode from the pending card so the user can keep fine-tuning
  // the position from exactly where they released — instead of starting over.
  // The ghost reappears at the last drop target and the in-drag action bar
  // shows again. A stray tap won't drop it (see dragResumedRef guard below):
  // the user must actually slide their finger to reposition.
  const continuePendingMove = useCallback(() => {
    const pending = pendingMove;
    setPendingMove(null);
    if (!pending) return;
    isDragProcessed.current = false;
    dragResumedRef.current = true;
    dragMovedRef.current = false;
    dragStartPt.current = null;
    lastMoveTargetRef.current = pending.target;
    setDragMove({ appt: pending.appt, pointerX: 0, pointerY: 0, dropTarget: pending.target });
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(20);
  }, [pendingMove]);

  // Global pointermove + pointerup listeners — only attached while dragging
  useEffect(() => {
    if (!dragMove) return;
    // For a RESUMED drag the finger isn't down yet — record the touch-down
    // point so we can tell a real slide from a stray tap.
    const onDown = (e: PointerEvent) => {
      dragStartPt.current = { x: e.clientX, y: e.clientY };
      dragMovedRef.current = false;
    };
    const onMove = (e: PointerEvent) => {
      if (isDragProcessed.current) return; // already handled via button tap
      e.preventDefault();
      // Mark "moved" once the finger travels a meaningful distance from where
      // it touched down (only relevant for resumed drags; normal long-press
      // drags have no recorded start point and count as moved immediately).
      if (dragStartPt.current) {
        const dx = e.clientX - dragStartPt.current.x;
        const dy = e.clientY - dragStartPt.current.y;
        if (Math.hypot(dx, dy) > 8) dragMovedRef.current = true;
      } else {
        dragMovedRef.current = true;
      }
      const dropTarget = computeDropTarget(e.clientX, e.clientY);
      if (dropTarget) lastMoveTargetRef.current = dropTarget; // remember last good spot
      setDragMove(prev => prev ? { ...prev, pointerX: e.clientX, pointerY: e.clientY, dropTarget } : null);
    };
    const onUp = (e: PointerEvent) => {
      // A resumed drag ignores a release that never moved — otherwise the
      // ghost would drop the instant the user taps, defeating the "continue
      // adjusting" purpose. Keep drag mode active until a real slide happens.
      if (dragResumedRef.current && !dragMovedRef.current) return;
      // Release is forgiving: if the finger ends over a gap (null target),
      // fall back to the last valid spot we tracked so the drag isn't lost.
      const dropTarget = computeDropTarget(e.clientX, e.clientY) ?? lastMoveTargetRef.current;
      finalizeMoveDrag(dropTarget); // no-op if isDragProcessed is already true
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragMove !== null, computeDropTarget, finalizeMoveDrag]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Break-move drag: read/write the break inside the staff schedule ──────────
  // Breaks live in the schedule (override or weekly) as a JSON array, not as
  // Appointment rows — so moving one means rewriting that day's breaks list.
  const getBreaksForDay = useCallback(async (sId: string, d: string): Promise<{ breaks: RawBreak[]; slots: { start: string; end: string }[]; isWorking: boolean }> => {
    const override = await fetch(`/api/admin/staff/${sId}/schedule/override?date=${d}`).then(r => r.ok ? r.json() : null).catch(() => null);
    if (override?.staffId) {
      return {
        breaks: override.breaks ? JSON.parse(override.breaks) : [],
        slots: override.slots ? JSON.parse(override.slots) : [],
        isWorking: override.isWorking,
      };
    }
    const s = allStaff.find(x => x.id === sId);
    const dow = new Date(d + "T00:00:00").getDay();
    const sched = s?.schedules?.find(sc => sc.dayOfWeek === dow);
    if (!sched) return { breaks: [], slots: [{ start: "09:00", end: "20:00" }], isWorking: true };
    return {
      breaks: sched.breaks ? JSON.parse(sched.breaks) : [],
      slots: JSON.parse(sched.slots || "[]"),
      isWorking: sched.isWorking,
    };
  }, [allStaff]);

  const persistBreakMove = useCallback(async (drag: BreakDragState, target: { staffId: string; date: string; startTime: string }) => {
    const fmt = (b: RawBreak): RawBreak => (b.name && b.name !== "הפסקה" ? { start: b.start, end: b.end, name: b.name } : { start: b.start, end: b.end });
    const newStart = target.startTime;
    const newEnd = minToTime(toMin(newStart) + drag.durationMin);
    const movedBreak: RawBreak = drag.name && drag.name !== "הפסקה"
      ? { start: newStart, end: newEnd, name: drag.name }
      : { start: newStart, end: newEnd };
    const post = (sId: string, d: string, breaks: RawBreak[], ctx: { slots: { start: string; end: string }[]; isWorking: boolean }) =>
      fetch(`/api/admin/staff/${sId}/schedule/override`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: d, isWorking: ctx.isWorking, slots: ctx.slots, breaks, notifyWaitlist: false }),
      });
    try {
      const src = await getBreaksForDay(drag.staffId, drag.date);
      if (!src.breaks[drag.breakIdx]) { loadAppointments(); return; }
      if (drag.staffId === target.staffId && drag.date === target.date) {
        const updated = src.breaks.map((b, i) => (i === drag.breakIdx ? movedBreak : fmt(b)));
        await post(drag.staffId, drag.date, updated, src);
      } else {
        const srcUpdated = src.breaks.filter((_, i) => i !== drag.breakIdx).map(fmt);
        await post(drag.staffId, drag.date, srcUpdated, src);
        const tgt = await getBreaksForDay(target.staffId, target.date);
        await post(target.staffId, target.date, [...tgt.breaks.map(fmt), movedBreak], tgt);
      }
    } catch (err) {
      console.error(err);
    }
    loadAppointments();
  }, [getBreaksForDay, loadAppointments]);

  const finalizeBreakDrag = useCallback((target: { staffId: string; date: string; startTime: string } | null) => {
    if (breakDragProcessed.current) return;
    breakDragProcessed.current = true;
    const drag = breakDragRef.current;
    setBreakDrag(null);
    suppressNextGridClick.current = true;
    if (!drag || !target) return;
    const newStartMin = toMin(target.startTime);
    // No move (same column + same start time) → don't write
    if (target.staffId === drag.staffId && target.date === drag.date && newStartMin === drag.origStartMin) return;
    // Don't write yet — hand off to a confirm card so the user approves the
    // dragged time (mirrors the appointment drag flow).
    setPendingBreakMove({ drag, target });
  }, []);

  // Re-enter break drag from the pending card (mirror of continuePendingMove):
  // the amber ghost reappears at the last target and the in-drag bar shows
  // again. A stray tap won't drop it — the user must slide their finger.
  const continuePendingBreakMove = useCallback(() => {
    const pending = pendingBreakMove;
    setPendingBreakMove(null);
    if (!pending) return;
    breakDragProcessed.current = false;
    breakDragResumedRef.current = true;
    breakDragMovedRef.current = false;
    breakDragStartPt.current = null;
    lastBreakTargetRef.current = pending.target;
    setBreakDrag({ ...pending.drag, pointerX: 0, pointerY: 0, dropTarget: pending.target });
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(20);
  }, [pendingBreakMove]);

  // Re-anchor a raw drop target (whose startTime = the finger's time) so the
  // break keeps the same offset relative to the finger as when it was grabbed.
  // Without this the break's TOP jumps to the finger and precise placement is
  // impossible. Snaps to the grid and clamps within the working day.
  const adjustBreakDrop = useCallback((raw: { staffId: string; date: string; startTime: string } | null) => {
    const drag = breakDragRef.current;
    if (!raw || !drag) return raw;
    let startMin = toMin(raw.startTime) - drag.grabOffsetMin;
    startMin = Math.round(startMin / SNAP_MIN) * SNAP_MIN;
    startMin = Math.max(calStart * 60, Math.min(calEnd * 60 - drag.durationMin, startMin));
    return { ...raw, startTime: minToTime(startMin) };
  }, [calStart, calEnd]);

  function startBreakDrag(sId: string, d: string, breakIdx: number, br: RawBreak, startMin: number, endMin: number, x: number, y: number) {
    breakDragProcessed.current = false;
    breakDragResumedRef.current = false; // a fresh long-press drag, not a resume
    lastBreakTargetRef.current = null;
    // Capture where inside the break the finger grabbed it (clamped to the
    // break's own span) so the drag stays anchored to that point.
    const grab = computeDropTarget(x, y);
    const grabOffsetMin = grab
      ? Math.max(0, Math.min(endMin - startMin, toMin(grab.startTime) - startMin))
      : 0;
    setBreakDrag({
      staffId: sId, date: d, breakIdx,
      name: br.name || "הפסקה", durationMin: endMin - startMin, origStartMin: startMin,
      grabOffsetMin,
      pointerX: x, pointerY: y, dropTarget: null,
    });
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(30);
  }

  // Global listeners while a break is being dragged.
  useEffect(() => {
    if (!breakDrag) return;
    // For a RESUMED break drag the finger isn't down yet — record the
    // touch-down point so we can tell a real slide from a stray tap.
    const onDown = (e: PointerEvent) => {
      breakDragStartPt.current = { x: e.clientX, y: e.clientY };
      breakDragMovedRef.current = false;
    };
    const onMove = (e: PointerEvent) => {
      if (breakDragProcessed.current) return;
      e.preventDefault();
      // Mark "moved" once the finger travels a meaningful distance (only
      // relevant for resumed drags; fresh long-press drags count as moved).
      if (breakDragStartPt.current) {
        const dx = e.clientX - breakDragStartPt.current.x;
        const dy = e.clientY - breakDragStartPt.current.y;
        if (Math.hypot(dx, dy) > 8) breakDragMovedRef.current = true;
      } else {
        breakDragMovedRef.current = true;
      }
      const dropTarget = adjustBreakDrop(computeDropTarget(e.clientX, e.clientY));
      if (dropTarget) lastBreakTargetRef.current = dropTarget; // remember last good spot
      setBreakDrag(prev => prev ? { ...prev, pointerX: e.clientX, pointerY: e.clientY, dropTarget } : null);
    };
    const onUp = (e: PointerEvent) => {
      // A resumed drag ignores a release that never moved — keep drag mode
      // active until a real slide happens (mirrors the appointment flow).
      if (breakDragResumedRef.current && !breakDragMovedRef.current) return;
      // Forgiving release: fall back to the last valid spot if the finger
      // ends over a gap, so a sloppy release doesn't throw the break away.
      const dropTarget = adjustBreakDrop(computeDropTarget(e.clientX, e.clientY)) ?? lastBreakTargetRef.current;
      finalizeBreakDrag(dropTarget);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [breakDrag !== null, computeDropTarget, finalizeBreakDrag, adjustBreakDrop]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setNewAppt({ staffId, date: d, time: yToTimeFn(startY, hourHeight, calStart, calEnd) });
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
                  {dayAppts.slice(0, 3).map((a) => (
                    <div key={a.id} className={`text-[10px] rounded px-1 truncate ${apptColorClass(a.staff.id, a.service.durationMinutes)}`}>
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

    // Day view: ≤6 staff → columns fill screen; >6 staff → 80px each + horizontal scroll.
    // Week/month view: date columns always fill screen — never force a minWidth.
    const FIT_THRESHOLD = 6;
    const tooManyStaff = isDay && displayedStaff.length > FIT_THRESHOLD;
    const colMinWidth = tooManyStaff ? 80 : undefined;
    const gridMinWidth = tooManyStaff ? `${56 + displayedStaff.length * 80}px` : undefined;

    return (
      <div ref={weekPagerRef} className="flex flex-col flex-1 min-h-0 will-change-transform">
        {/* Column headers — scrollable horizontally to match the grid */}
        <div className="overflow-x-auto shrink-0 border-b border-neutral-200 bg-white">
          <div className="flex" style={{ minWidth: gridMinWidth }}>
            <div className="w-14 shrink-0" />
            {isDay
              ? displayedStaff.map((s, si) => (
                <div key={s.id} style={colMinWidth ? { minWidth: colMinWidth } : {}} className="flex-1 min-w-0 flex flex-col items-center py-1.5 border-r border-neutral-100 last:border-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold ${COLORS[si % COLORS.length].bg}`}>
                    {s.name[0]}
                  </div>
                  <span className="text-[10px] text-neutral-700 mt-0.5 font-medium text-center leading-tight px-1 w-full break-words">{s.name}</span>
                  <span className="text-[9px] text-neutral-400 leading-none mt-0.5">
                    {hebDayLetter(date)}׳ {fmtDateShort(date)}
                  </span>
                  <button
                    onClick={() => setDayMenu({ date, staffId: s.id })}
                    title="עריכת שעות יום"
                    className="text-[10px] text-neutral-400 hover:text-teal-600 px-1.5 py-0.5 rounded hover:bg-teal-50 transition-colors">
                    ⚙ שעות
                  </button>
                </div>
              ))
              : dates.map(d => {
                const isToday = d === todayISO();
                const staffForDay = weekStaff;
                const weekOverride = staffForDay ? overrideMap[`${staffForDay.id}|${d}`] : undefined;
                const isDayClosed = weekOverride ? !weekOverride.isWorking : false;
                // Beyond the booking horizon and not manually opened → greyed header.
                const beyond = !weekOverride && !!staffForDay
                  && daysBetween(todayISO(), d) >= staffHorizonDays(staffForDay, bizHorizon);
                return (
                  <div key={d} className={`flex-1 min-w-0 flex flex-col items-center py-1 border-r border-neutral-100 last:border-0 cursor-pointer hover:bg-neutral-50 relative ${isDayClosed ? "bg-red-50/50" : beyond ? "bg-neutral-100/70" : ""}`}
                    onClick={() => staffForDay && setDayMenu({ date: d, staffId: staffForDay.id })}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      isToday ? "bg-teal-600 text-white shadow-md ring-2 ring-teal-300" : isDayClosed ? "bg-red-100 text-red-400" : beyond ? "bg-neutral-200 text-neutral-400" : "bg-neutral-100 text-neutral-600"
                    }`}>
                      {hebDayLetter(d)}
                    </div>
                    <span className={`text-[10px] mt-0.5 font-medium leading-none ${isToday ? "text-teal-700 font-bold" : isDayClosed ? "text-red-400" : beyond ? "text-neutral-400" : "text-neutral-400"}`}>
                      {fmtDateShort(d)}
                    </span>
                    {isDayClosed && <span className="text-[8px] text-red-400 leading-none">🔒</span>}
                    {beyond && !isDayClosed && <span className="text-[8px] text-neutral-400 leading-none">🔒</span>}
                    {waitlistCounts[d] > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
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
          <HourRangeCtx.Provider value={{ start: calStart, end: calEnd }}>
            <div className="flex" style={{ height: totalHeight, minWidth: gridMinWidth }}>
              <TimeColumn />
              <div className="flex flex-1 relative">
                <GridLines />
                {/* Now line — day view: spans all columns; week view: per-column (inside each day) */}
                {isDay && dates.includes(todayISO()) && nowY >= 0 && nowY <= totalHeight && (
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
                        className="no-touch-select flex-1 relative border-r border-neutral-100 last:border-0 cursor-crosshair" style={colMinWidth ? { minWidth: colMinWidth } : {}}
                        onClick={e => {
                          if (suppressNextGridClick.current) { suppressNextGridClick.current = false; return; }
                          // A tap anywhere inside the calendar REPOSITIONS the open
                          // draft to the new time (handleGridClick overwrites it).
                          // Cancelling only happens on taps OUTSIDE the grid — handled
                          // by the outside-tap effect.
                          handleGridClick(e, s.id, date);
                        }}
                        onPointerDown={e => handlePointerDown(e, s.id, date)}
                        onPointerMove={e => handlePointerMove(e, s.id, date)}
                        onPointerUp={e => handlePointerUp(e, s.id, date)}
                        onPointerCancel={() => setDrag(null)}>
                        <WorkingOverlay staff={s} dow={dayOfWeek(date)} override={overrideMap[`${s.id}|${date}`]}
                          beyondHorizon={daysBetween(todayISO(), date) >= staffHorizonDays(s, bizHorizon)}
                          staffId={s.id} date={date}
                          movingBreak={breakDrag}
                          onBreakLongPress={(idx, br, sMin, eMin, x, y) => startBreakDrag(s.id, date, idx, br, sMin, eMin, x, y)}
                          onBreakClick={(idx, br) => setEditingBreak({ staffId: s.id, date, breakIdx: idx, initial: br })} />
                        {/* Break drag drop-ghost */}
                        {breakDrag?.dropTarget?.staffId === s.id && breakDrag?.dropTarget?.date === date && (() => {
                          const ghostTop = apptTop(breakDrag.dropTarget!.startTime, hourHeight);
                          const ghostH = (breakDrag.durationMin / 60) * hourHeight;
                          return (
                            <div className="absolute left-0.5 right-0.5 rounded-lg border-2 border-dashed pointer-events-none z-30"
                              style={{ top: ghostTop, height: ghostH, borderColor: "#f59e0b", background: "rgba(245,158,11,0.18)" }}>
                              <div className={`absolute left-1/2 -translate-x-1/2 bg-amber-500 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow-lg whitespace-nowrap ${ghostTop < 36 ? "top-full mt-1" : "-top-6"}`} dir="ltr">
                                {breakDrag.dropTarget!.startTime}
                              </div>
                              <div className="flex items-center justify-center h-full">
                                <p className="text-[10px] font-bold text-amber-800 leading-tight">☕ {breakDrag.name}</p>
                              </div>
                            </div>
                          );
                        })()}
                        {/* Drag-to-create ghost rectangle */}
                        {colDrag && dragDist >= 6 && (
                          <div className="absolute left-0.5 right-0.5 bg-slate-300/40 border-2 border-dashed border-teal-600 rounded-lg pointer-events-none z-20 flex flex-col justify-start px-1.5 py-1"
                            style={{ top: Math.min(colDrag.startY, colDrag.endY), height: Math.max(dragDist, 8) }}>
                            {dragDist > 20 && (
                              <span className="text-[10px] font-bold text-slate-900 leading-tight">
                                {yToTimeFn(Math.min(colDrag.startY, colDrag.endY), hourHeight)}
                              </span>
                            )}
                          </div>
                        )}
                        {/* Drag-to-MOVE drop ghost — shows where the appointment will land */}
                        {isDropTarget && dragMove && (() => {
                          const ghostTop = apptTop(dragMove.dropTarget!.startTime, hourHeight);
                          const ghostH = apptH(dragMove.appt.startTime, dragMove.appt.endTime, hourHeight);
                          return (
                            <div className="absolute left-0.5 right-0.5 rounded-lg border-2 border-dashed pointer-events-none z-30"
                              style={{ top: ghostTop, height: ghostH, borderColor: "#10b981", background: "rgba(16,185,129,0.18)" }}>
                              {/* Time bubble — above the ghost, so finger doesn't cover it */}
                              <div className={`absolute left-1/2 -translate-x-1/2 bg-emerald-700 text-white text-base font-extrabold px-3.5 py-1 rounded-full shadow-xl ring-2 ring-white whitespace-nowrap ${ghostTop < 52 ? "top-full mt-2.5" : "-top-10"}`} dir="ltr">
                                {dragMove.dropTarget!.startTime}
                              </div>
                              <div className="flex flex-col items-center justify-center h-full">
                                <p className="text-[10px] font-bold text-emerald-900 leading-tight">{dragMove.appt.customer.name}</p>
                              </div>
                            </div>
                          );
                        })()}
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
                            columnSnapDeltaX={columnSnapDeltaX}
                            onHorizontalDragEnd={clientX => {
                              const target = findColumnByX(clientX);
                              if (!target) return;
                              suppressNextGridClick.current = true;
                              if (target.staffId !== draftAppt?.staffId || target.date !== draftAppt?.date) {
                                setDraftAppt(prev => prev ? { ...prev, staffId: target.staffId, date: target.date } : null);
                              }
                            }}
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
                            columnSnapDeltaX={columnSnapDeltaX}
                            onHorizontalDragEnd={clientX => {
                              const target = findColumnByX(clientX);
                              if (!target) return;
                              suppressNextGridClick.current = true;
                              setDraftMoveSlot(prev => prev ? { ...prev, staffId: target.staffId, date: target.date } : null);
                            }}
                          />
                        )}
                        {(() => {
                          const dayAppts = getAppts(s.id, date);
                          const lanes = computeApptLanes(dayAppts);
                          return dayAppts.map(a => (
                            <ApptBlock key={a.id} appt={a} colorClass={apptColorClass(a.staff.id, a.service.durationMinutes)}
                              isMoving={dragMove?.appt.id === a.id}
                              swapState={swapStateFor(a.id)}
                              lane={lanes[a.id]}
                              onClick={() => handleApptClick(a)}
                              onLongPress={(x, y) => startMoveDrag(a, x, y)} />
                          ));
                        })()}
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
                        className="no-touch-select flex-1 relative border-r border-neutral-100 last:border-0 cursor-crosshair"
                        onClick={e => {
                          if (suppressNextGridClick.current) { suppressNextGridClick.current = false; return; }
                          // A tap anywhere inside the calendar REPOSITIONS the open
                          // draft to the new time (handleGridClick overwrites it).
                          // Cancelling only happens on taps OUTSIDE the grid — handled
                          // by the outside-tap effect.
                          handleGridClick(e, s.id, d);
                        }}
                        onPointerDown={e => handlePointerDown(e, s.id, d)}
                        onPointerMove={e => handlePointerMove(e, s.id, d)}
                        onPointerUp={e => handlePointerUp(e, s.id, d)}
                        onPointerCancel={() => setDrag(null)}>
                        <WorkingOverlay staff={s} dow={dayOfWeek(d)} override={overrideMap[`${s.id}|${d}`]}
                          beyondHorizon={daysBetween(todayISO(), d) >= staffHorizonDays(s, bizHorizon)}
                          staffId={s.id} date={d}
                          movingBreak={breakDrag}
                          onBreakLongPress={(idx, br, sMin, eMin, x, y) => startBreakDrag(s.id, d, idx, br, sMin, eMin, x, y)}
                          onBreakClick={(idx, br) => setEditingBreak({ staffId: s.id, date: d, breakIdx: idx, initial: br })} />
                        {/* Break drag drop-ghost */}
                        {breakDrag?.dropTarget?.staffId === s.id && breakDrag?.dropTarget?.date === d && (() => {
                          const ghostTop = apptTop(breakDrag.dropTarget!.startTime, hourHeight);
                          const ghostH = (breakDrag.durationMin / 60) * hourHeight;
                          return (
                            <div className="absolute left-0.5 right-0.5 rounded-lg border-2 border-dashed pointer-events-none z-30"
                              style={{ top: ghostTop, height: ghostH, borderColor: "#f59e0b", background: "rgba(245,158,11,0.18)" }}>
                              <div className={`absolute left-1/2 -translate-x-1/2 bg-amber-500 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow-lg whitespace-nowrap ${ghostTop < 36 ? "top-full mt-1" : "-top-6"}`} dir="ltr">
                                {breakDrag.dropTarget!.startTime}
                              </div>
                              <div className="flex items-center justify-center h-full">
                                <p className="text-[10px] font-bold text-amber-800 leading-tight">☕ {breakDrag.name}</p>
                              </div>
                            </div>
                          );
                        })()}
                        {/* Per-column now line — only today */}
                        {d === todayISO() && nowY >= 0 && nowY <= totalHeight && (
                          <div className="absolute left-0 right-0 z-20 pointer-events-none flex items-center" style={{ top: nowY }}>
                            <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                            <div className="flex-1 border-t-2 border-red-400" />
                          </div>
                        )}
                        {colDrag && dragDist >= 6 && (
                          <div className="absolute left-0.5 right-0.5 bg-slate-300/40 border-2 border-dashed border-teal-600 rounded-lg pointer-events-none z-20 flex flex-col justify-start px-1.5 py-1"
                            style={{ top: Math.min(colDrag.startY, colDrag.endY), height: Math.max(dragDist, 8) }}>
                            {dragDist > 20 && (
                              <span className="text-[10px] font-bold text-slate-900 leading-tight">
                                {yToTimeFn(Math.min(colDrag.startY, colDrag.endY), hourHeight)}
                              </span>
                            )}
                          </div>
                        )}
                        {/* Drag-to-MOVE drop ghost */}
                        {isDropTarget && dragMove && (() => {
                          const ghostTop = apptTop(dragMove.dropTarget!.startTime, hourHeight);
                          const ghostH = apptH(dragMove.appt.startTime, dragMove.appt.endTime, hourHeight);
                          return (
                            <div className="absolute left-0.5 right-0.5 rounded-lg border-2 border-dashed pointer-events-none z-30"
                              style={{ top: ghostTop, height: ghostH, borderColor: "#10b981", background: "rgba(16,185,129,0.18)" }}>
                              <div className={`absolute left-1/2 -translate-x-1/2 bg-emerald-700 text-white text-base font-extrabold px-3.5 py-1 rounded-full shadow-xl ring-2 ring-white whitespace-nowrap ${ghostTop < 52 ? "top-full mt-2.5" : "-top-10"}`} dir="ltr">
                                {dragMove.dropTarget!.startTime}
                              </div>
                              <div className="flex flex-col items-center justify-center h-full">
                                <p className="text-[10px] font-bold text-emerald-900 leading-tight">{dragMove.appt.customer.name}</p>
                              </div>
                            </div>
                          );
                        })()}
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
                            columnSnapDeltaX={columnSnapDeltaX}
                            onHorizontalDragEnd={clientX => {
                              const target = findColumnByX(clientX);
                              if (!target) return;
                              suppressNextGridClick.current = true;
                              if (target.date !== draftAppt?.date) {
                                setDraftAppt(prev => prev ? { ...prev, date: target.date } : null);
                              }
                            }}
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
                            columnSnapDeltaX={columnSnapDeltaX}
                            onHorizontalDragEnd={clientX => {
                              const target = findColumnByX(clientX);
                              if (!target) return;
                              suppressNextGridClick.current = true;
                              setDraftMoveSlot(prev => prev ? { ...prev, staffId: target.staffId, date: target.date } : null);
                            }}
                          />
                        )}
                        {(() => {
                          const dayAppts = getAppts(s.id, d);
                          const lanes = computeApptLanes(dayAppts);
                          return dayAppts.map(a => (
                            <ApptBlock key={a.id} appt={a} colorClass={apptColorClass(a.staff.id, a.service.durationMinutes)}
                              isMoving={dragMove?.appt.id === a.id}
                              swapState={swapStateFor(a.id)}
                              lane={lanes[a.id]}
                              onClick={() => handleApptClick(a)}
                              onLongPress={(x, y) => startMoveDrag(a, x, y)} />
                          ));
                        })()}
                        {renderMoveSlotMarkers(s.id, d)}
                      </div>
                    );
                  })
                }
              </div>
            </div>
          </HourRangeCtx.Provider>
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
            borderColor: "#0d9488",
            background: "rgba(20, 184, 166, 0.15)",
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
      {/* ── Swipe-to-barber toast (week/3day view) ── */}
      {swipeToast && (
        <div className="fixed inset-x-0 top-16 z-50 flex justify-center pointer-events-none">
          <div className="bg-neutral-900/80 text-white text-sm font-semibold px-5 py-2 rounded-full shadow-lg">
            {swipeToast}
          </div>
        </div>
      )}

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
              className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-neutral-300 text-white rounded-lg text-xs font-bold transition">
              {swapSubmitting ? "שולח..." : `שלח ל-${total}`}
            </button>
          </div>
        );
      })()}

      {/* ── Top bar — two rows on mobile ── */}
      <div className="bg-white border-b border-neutral-200 shrink-0">

        {/* Row 1: navigation + date label + new appt button */}
        <div className="flex items-center gap-1 px-2 py-1.5">
          {/* Back — in RTL layout ▶ sits on the right = earlier dates */}
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-lg hover:bg-neutral-100 text-neutral-600 flex items-center justify-center shrink-0 text-base">▶</button>
          <button onClick={() => setDate(todayISO())} className="text-xs font-semibold text-teal-600 border border-teal-200 rounded-lg px-2 py-1 shrink-0 hover:bg-teal-50 transition">היום</button>
          {/* Forward — ◀ sits on the left = later dates */}
          <button onClick={() => navigate(1)} className="w-9 h-9 rounded-lg hover:bg-neutral-100 text-neutral-600 flex items-center justify-center shrink-0 text-base">◀</button>

          {/* Date label — takes remaining space */}
          {view === "day" ? (
            <button
              className="font-semibold text-neutral-800 text-xs flex-1 min-w-0 text-right hover:text-teal-700 transition leading-tight"
              onClick={() => setDayMenu({ date, staffId: displayedStaff[0]?.id || allStaff[0]?.id || "" })}>
              {dateLabel}
            </button>
          ) : (
            <span className="font-semibold text-neutral-800 text-xs flex-1 min-w-0 leading-tight text-right">{dateLabel}</span>
          )}

          {/* New appointment button */}
          <button onClick={() => {
            const defaultStaffId =
              (view === "week" || view === "3day") ? (weekBarber || allStaff[0]?.id || "") :
              view === "day" ? (dayBarber || displayedStaff[0]?.id || allStaff[0]?.id || "") :
              (allStaff[0]?.id || "");
            setNewAppt({ staffId: defaultStaffId, date, time: "10:00" });
          }}
            className="flex items-center gap-1 px-3 py-2 bg-teal-600 text-white rounded-lg text-xs font-semibold hover:bg-teal-700 transition shrink-0">
            + תור
          </button>

          {/* Notifications bell — own bookings/cancellations (barber) or all (owner) */}
          <NotificationsBell />
        </div>

        {/* Row 2: view switcher + barber picker + zoom */}
        <div className="flex items-center gap-1.5 px-2 pb-1.5">
          {/* View switcher */}
          <div className="flex bg-neutral-100 rounded-lg p-0.5 shrink-0">
            {(["day","week","month"] as ViewType[]).map(v => (
              <button key={v} onClick={() => {
                setView(v);
                // Switching to day view → always show all staff (כולם)
                if (v === "day") setVisibleStaff(allStaff.map(s => s.id));
              }}
                className={`px-2.5 py-1 text-[11px] rounded-md font-medium transition ${view === v ? "bg-white shadow text-neutral-900" : "text-neutral-500"}`}>
                {v === "day" ? "יום" : v === "week" ? "שבוע" : "חודש"}
              </button>
            ))}
          </div>

          {/* Barber picker — swipe left/right here to switch between barbers' calendars */}
          {(isOwner || barbersCanViewOthersCalendar) && (view === "week" || view === "3day") && allStaff.length > 1 && (
            <div className="relative flex-1 min-w-0" onTouchStart={onBarberTouchStart} onTouchEnd={onBarberTouchEnd}>
              <select value={weekBarber} onChange={e => setWeekBarber(e.target.value)}
                className="border border-neutral-200 rounded-lg pr-2 pl-6 py-1 text-xs text-neutral-700 w-full appearance-none">
                {allStaff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <span className="pointer-events-none absolute inset-y-0 left-1.5 flex items-center text-[11px] text-neutral-400 select-none">‹ ›</span>
            </div>
          )}
          {/* Day view staff selection is handled by the ✂️ filter button — no separate barber picker needed */}

          {/* Zoom — hidden on mobile (use pinch) / shown on desktop */}
          {view !== "month" && (
            <div className="flex bg-neutral-100 rounded-lg p-0.5 shrink-0">
              <button onClick={() => setHourHeight(h => Math.max(28, h - 20))} disabled={hourHeight <= 28}
                className="w-7 h-7 flex items-center justify-center text-base font-bold text-neutral-700 disabled:text-neutral-300 hover:bg-white rounded-md transition">−</button>
              <button onClick={() => setHourHeight(h => Math.min(220, h + 20))} disabled={hourHeight >= 220}
                className="w-7 h-7 flex items-center justify-center text-base font-bold text-neutral-700 disabled:text-neutral-300 hover:bg-white rounded-md transition">+</button>
            </div>
          )}

          {/* Day barber filter */}
          {view === "day" && (
            <div className="relative shrink-0">
              <button onClick={() => setShowFilter(!showFilter)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition ${showFilter ? "bg-teal-600 text-white border-teal-700" : "bg-white border-neutral-200 text-neutral-600"}`}>
                ✂️ {visibleStaff.length === allStaff.length ? "הכל" : visibleStaff.length}
              </button>
              {showFilter && (
                <div className="absolute left-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-neutral-200 p-2 w-44 z-30">
                  <div className="flex items-center justify-between mb-1 px-1">
                    <span className="text-xs font-semibold text-neutral-700">ספרים</span>
                    <button onClick={() => setVisibleStaff(allStaff.map(s => s.id))} className="text-[11px] text-slate-800">הכל</button>
                  </div>
                  {allStaff.map((s, si) => (
                    <label key={s.id} className="flex items-center gap-2 px-1 py-1.5 cursor-pointer rounded-lg hover:bg-neutral-50">
                      <input type="checkbox" checked={visibleStaff.includes(s.id)}
                        onChange={e => setVisibleStaff(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))}
                        className="accent-slate-900" />
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${COLORS[si % COLORS.length].bg}`}>{s.name[0]}</div>
                      <span className="text-xs text-neutral-800">{s.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Refresh — desktop only */}
          <button onClick={loadAppointments} className="hidden sm:flex w-8 h-8 rounded-lg hover:bg-neutral-100 text-neutral-500 items-center justify-center shrink-0 mr-auto" title="רענן">🔄</button>
        </div>
      </div>

      {/* ── Calendar body ── (overflow-x-hidden clips the week page-slide) */}
      <div className="flex-1 flex flex-col min-h-0 overflow-x-hidden">
        {loading && appointments.length === 0
          ? <div className="flex-1 flex items-center justify-center text-neutral-400">טוען...</div>
          : view === "month" ? renderMonth() : renderTimeGrid()
        }
      </div>

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
      {editingBreak && (
        <BreakEditModal
          staffId={editingBreak.staffId}
          date={editingBreak.date}
          breakIdx={editingBreak.breakIdx}
          initial={editingBreak.initial}
          onClose={() => setEditingBreak(null)}
          onRefresh={loadAppointments}
        />
      )}

      {/* ── In-drag action bar ── */}
      {/* Floats at the bottom of the screen WHILE the user is actively dragging */}
      {/* an appointment. On mobile this is the primary way to confirm/cancel    */}
      {/* because the user can tap a button with a second finger (or release and  */}
      {/* tap quickly). On desktop it's a handy status pill. Only shown when the  */}
      {/* pointer is over a valid drop column (dropTarget != null).               */}
      {dragMove?.dropTarget && (
        <div className="fixed inset-x-0 bottom-0 z-[45] pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 px-3 py-3 sm:py-2"
            style={{ background: "linear-gradient(to top, rgba(255,255,255,0.92) 70%, transparent)" }}>
            {/* Cancel drag — releases without setting pendingMove */}
            <button
              className="w-12 h-12 sm:w-9 sm:h-9 shrink-0 bg-white border border-red-300 rounded-xl text-red-500 text-lg sm:text-sm font-bold shadow-lg flex items-center justify-center active:scale-95 transition-transform"
              onPointerDown={e => {
                e.preventDefault();
                e.stopPropagation();
                // Mark processed so global pointerup is a no-op, then cancel
                finalizeMoveDrag(null);
              }}>
              ✕
            </button>
            {/* Confirm drop — leads to pendingMove card for final approval */}
            <button
              className="flex-1 h-12 sm:h-9 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-sm font-bold shadow-lg flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
              onPointerDown={e => {
                e.preventDefault();
                e.stopPropagation();
                // Read target before any state changes
                const target = dragMoveRef.current?.dropTarget ?? null;
                finalizeMoveDrag(target);
              }}>
              <span>✓</span>
              <span>קבע ב‑{dragMove.dropTarget.startTime}</span>
            </button>
          </div>
        </div>
      )}

      {/* ── In-drag action bar for BREAKS ── */}
      {/* Mirrors the appointment bar above (amber instead of teal) so dragging */}
      {/* a break gives the same confirm/cancel control while moving.           */}
      {breakDrag?.dropTarget && (
        <div className="fixed inset-x-0 bottom-0 z-[45] pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 px-3 py-3 sm:py-2"
            style={{ background: "linear-gradient(to top, rgba(255,255,255,0.92) 70%, transparent)" }}>
            {/* Cancel drag — releases without setting pendingBreakMove */}
            <button
              className="w-12 h-12 sm:w-9 sm:h-9 shrink-0 bg-white border border-red-300 rounded-xl text-red-500 text-lg sm:text-sm font-bold shadow-lg flex items-center justify-center active:scale-95 transition-transform"
              onPointerDown={e => {
                e.preventDefault();
                e.stopPropagation();
                finalizeBreakDrag(null);
              }}>
              ✕
            </button>
            {/* Confirm drop — leads to pendingBreakMove card for final approval */}
            <button
              className="flex-1 h-12 sm:h-9 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-bold shadow-lg flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
              onPointerDown={e => {
                e.preventDefault();
                e.stopPropagation();
                const target = breakDragRef.current?.dropTarget ?? null;
                finalizeBreakDrag(target);
              }}>
              <span>✓</span>
              <span>הזז ל‑{breakDrag.dropTarget.startTime}</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Pending-move confirmation card (drag-to-MOVE) ── */}
      {/* Renders as a centered floating sheet so it works equally on phone */}
      {/* (where a "release here" affordance is critical) and desktop. */}
      {pendingMove && (() => {
        const targetStaff = allStaff.find(s => s.id === pendingMove.target.staffId);
        const dateLabel = new Date(pendingMove.target.date + "T00:00:00").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
        return (
          <div className="fixed inset-x-0 bottom-0 sm:inset-0 z-[55] flex items-end sm:items-center justify-center p-3 sm:p-4 pointer-events-none">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-slate-200 p-4 space-y-3 pointer-events-auto safe-bottom">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center text-teal-700 text-lg shrink-0">↔️</div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 text-sm">להעביר את התור?</p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {pendingMove.appt.customer.name} → <span className="font-semibold text-slate-800">{targetStaff?.name || pendingMove.appt.staff.name}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {dateLabel} · {pendingMove.target.startTime}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setPendingMove(null)}
                  className="py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition">
                  ✕ ביטול
                </button>
                <button
                  onClick={continuePendingMove}
                  className="py-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition"
                  title="סגור ואחזור לדייק במיקום">
                  ↻ אדייק שוב
                </button>
                <button
                  onClick={commitPendingMove}
                  className="py-2 rounded-lg bg-teal-600 text-white text-xs font-bold hover:bg-teal-700 transition">
                  ✓ אישור
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Pending BREAK-move confirmation card (drag-to-MOVE a break) ── */}
      {pendingBreakMove && (() => {
        const targetStaff = allStaff.find(s => s.id === pendingBreakMove.target.staffId);
        const dateLabel = new Date(pendingBreakMove.target.date + "T00:00:00").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
        const endTime = minToTime(toMin(pendingBreakMove.target.startTime) + pendingBreakMove.drag.durationMin);
        return (
          <div className="fixed inset-x-0 bottom-0 sm:inset-0 z-[55] flex items-end sm:items-center justify-center p-3 sm:p-4 pointer-events-none">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-slate-200 p-4 space-y-3 pointer-events-auto safe-bottom">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-lg shrink-0">☕</div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 text-sm">להזיז את ההפסקה?</p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {pendingBreakMove.drag.name} → <span className="font-semibold text-slate-800">{targetStaff?.name || "אותו ספר"}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5" dir="rtl">
                    {dateLabel} · <span dir="ltr">{pendingBreakMove.target.startTime}–{endTime}</span>
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setPendingBreakMove(null)}
                  className="py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition">
                  ✕ ביטול
                </button>
                <button
                  onClick={continuePendingBreakMove}
                  className="py-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition"
                  title="סגור ואחזור לדייק במיקום">
                  ↻ אדייק שוב
                </button>
                <button
                  onClick={() => { const p = pendingBreakMove; setPendingBreakMove(null); if (p) persistBreakMove(p.drag, p.target); }}
                  className="py-2 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition">
                  ✓ אישור
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
