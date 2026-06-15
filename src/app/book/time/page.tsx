"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSlug, apiWithSlug, publicHref } from "@/lib/public-nav";

function formatDate(date: Date): string {
  // Use local date components (not toISOString which converts to UTC and can shift the date in Israel UTC+3)
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDayName(date: Date): string {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return days[date.getDay()];
}

function getDayShort(date: Date): string {
  const days = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
  return days[date.getDay()];
}

function getDateLabel(date: Date, today: Date): string {
  const diff = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  return `יום ${getDayName(date)}`;
}

// ── Calendar helpers ─────────────────────────────────────────────────────────
function addDaysLocal(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function startOfWeekSunday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // getDay 0=Sunday → step back to Sunday
  return d;
}
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
function monthYear(date: Date): string {
  return `${HE_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// ── Step bar ───────────────────────────────────────────────────────────────────
function StepBar({ step }: { step: number }) {
  const steps = ["ספר", "שירות", "זמן"];
  return (
    <div className="flex items-center gap-0">
      {steps.map((label, i) => {
        const idx = i + 1;
        const active = idx === step;
        const done = idx < step;
        return (
          <div key={idx} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all"
                style={{
                  background: active ? "var(--brand)" : done ? "var(--brand)" : "var(--divider)",
                  color: active || done ? "#000" : "var(--text-muted)",
                }}>
                {done ? "✓" : idx}
              </div>
              <span className="text-[9px] tracking-wide mt-0.5 font-medium"
                style={{ color: active ? "var(--brand)" : "var(--text-muted)" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="w-8 h-px mx-1 mb-4 transition-all"
                style={{ background: done ? "var(--brand)" : "var(--divider)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BackArrow({ href }: { href: string }) {
  return (
    <Link href={href}
      className="w-9 h-9 flex items-center justify-center rounded-full transition-colors"
      style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        style={{ color: "var(--text-sec)" }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

// ── Waitlist bottom-sheet ──────────────────────────────────────────────────────
function WaitlistSheet({
  staffId, serviceId, date, dateLabel,
  onClose, onSuccess,
}: {
  staffId: string; serviceId: string; date: string; dateLabel: string;
  onClose: () => void; onSuccess: () => void;
}) {
  const slug = useSlug();
  const [name, setName]     = useState("");
  const [phone, setPhone]   = useState("");
  const [pref, setPref]     = useState<"morning" | "afternoon" | "evening" | "any">("any");
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const prefs = [
    { v: "morning",   l: "בוקר",    s: "09:00–12:00" },
    { v: "afternoon", l: "צהריים",  s: "12:00–17:00" },
    { v: "evening",   l: "ערב",     s: "17:00–20:00" },
    { v: "any",       l: "כל שעה", s: "" },
  ] as const;

  const submit = async () => {
    if (!name.trim() || !phone.trim()) { setErr("שם וטלפון חובה"); return; }
    setErr(null);
    setSaving(true);
    const r = await fetch(apiWithSlug("/api/waitlist", slug), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, staffId, serviceId, date, preferredTimeOfDay: pref, isFlexible: pref === "any" }),
    });
    setSaving(false);
    if (r.ok || r.status === 200) { onSuccess(); return; }
    const j = await r.json().catch(() => ({}));
    setErr(j.error || "שגיאה בהרשמה");
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" dir="rtl"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onClose}>
      <div className="rounded-t-3xl p-6 space-y-5"
        style={{ background: "var(--card)", borderTop: "1px solid var(--divider)" }}
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto" style={{ background: "var(--divider)" }} />

        <div>
          <h2 className="text-base font-bold" style={{ color: "var(--text-pri)" }}>
            🔔 רשימת המתנה
          </h2>
          <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {dateLabel} — נודיע לך ב-WhatsApp כשיתפנה מקום
          </p>
        </div>

        <div>
          <p className="text-[10px] tracking-[0.2em] uppercase mb-3 font-semibold" style={{ color: "var(--text-muted)" }}>שעה מועדפת</p>
          <div className="grid grid-cols-2 gap-2">
            {prefs.map(p => (
              <button key={p.v} onClick={() => setPref(p.v)}
                className="py-3 px-3 rounded-xl text-sm text-right border transition-all"
                style={{
                  background: pref === p.v ? "var(--brand)" : "var(--bg-alt)",
                  border: `1px solid ${pref === p.v ? "var(--brand)" : "var(--divider)"}`,
                  color: pref === p.v ? "#000" : "var(--text-pri)",
                }}>
                <div className="text-xs font-semibold">{p.l}</div>
                {p.s && <div className="text-[10px] opacity-60 mt-0.5" dir="ltr">{p.s}</div>}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase block mb-2 font-semibold" style={{ color: "var(--text-muted)" }}>שם מלא</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="ישראל ישראלי"
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-colors"
              style={{ background: "var(--bg-alt)", border: "1.5px solid var(--divider)", color: "var(--text-pri)" }} />
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase block mb-2 font-semibold" style={{ color: "var(--text-muted)" }}>טלפון</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="050-0000000" type="tel" dir="ltr"
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none transition-colors"
              style={{ background: "var(--bg-alt)", border: "1.5px solid var(--divider)", color: "var(--text-pri)" }} />
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <button onClick={submit} disabled={saving}
          className="w-full py-4 text-sm font-bold tracking-[0.15em] uppercase rounded-full transition-all disabled:opacity-40"
          style={{ background: "var(--brand)", color: "#000" }}>
          {saving ? "שומר..." : "הצטרף להמתנה"}
        </button>
      </div>
    </div>
  );
}

// ── Waitlist success ───────────────────────────────────────────────────────────
function WaitlistSuccess({ dateLabel, onClose }: { dateLabel: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" dir="rtl"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onClose}>
      <div className="rounded-t-3xl p-6 text-center space-y-5"
        style={{ background: "var(--card)", borderTop: "1px solid var(--divider)" }}
        onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full mx-auto" style={{ background: "var(--divider)" }} />
        <div className="text-4xl">🔔</div>
        <div>
          <h2 className="text-base font-bold" style={{ color: "var(--text-pri)" }}>נרשמת בהצלחה</h2>
          <p className="text-xs mt-2 leading-relaxed" style={{ color: "var(--text-muted)" }}>
            ברגע שיתפנה תור ב{dateLabel} — נשלח לך הודעה ב-WhatsApp
          </p>
        </div>
        <button onClick={onClose}
          className="w-full py-4 text-sm font-bold tracking-[0.15em] uppercase rounded-full"
          style={{ background: "var(--brand)", color: "#000" }}>
          סגור
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
function ChooseTimePageContent() {
  const slug = useSlug();
  const searchParams = useSearchParams();
  const staffId = searchParams.get("staffId") || "";
  const serviceId = searchParams.get("serviceId") || "";

  const [selectedDate, setSelectedDate] = useState<string>("");
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [dates, setDates] = useState<{ date: string; label: string; dayName: string; dayShort: string; dayNum: number }[]>([]);
  const [waitlistOpen, setWaitlistOpen]     = useState(false);
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);
  // Calendar state
  const [today] = useState(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; });
  const [horizonDays, setHorizonDays] = useState(30);
  const [page, setPage] = useState(0); // window paged forward in 2-week steps
  const [availability, setAvailability] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.all([
      fetch(apiWithSlug("/api/business", slug)).then(r => r.json()).catch(() => null),
      staffId ? fetch(apiWithSlug("/api/staff", slug)).then(r => r.json()).catch(() => []) : Promise.resolve([]),
    ]).then(([biz, staffList]) => {
      const bizHorizon: number = biz?.bookingHorizonDays || 30;
      const staffRecord = Array.isArray(staffList) ? staffList.find((s: { id: string }) => s.id === staffId) : null;
      const days: number = staffRecord?.bookingHorizonDays ?? bizHorizon;
      buildDates(days);
    }).catch(() => buildDates(30));

    function buildDates(days: number) {
      setHorizonDays(days);
      const t0 = new Date();
      t0.setHours(0, 0, 0, 0);
      const nextDates = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(t0);
        d.setDate(d.getDate() + i);
        nextDates.push({
          date: formatDate(d),
          label: getDateLabel(d, t0),
          dayName: getDayName(d),
          dayShort: getDayShort(d),
          dayNum: d.getDate(),
        });
      }
      setDates(nextDates);
      setSelectedDate(formatDate(t0));
    }
  }, []);

  // ── Calendar window (2 weeks, Sun→Sat) + availability dots ──
  // Bookable up to the barber's horizon, but always allow browsing ≥6 months
  // forward so the customer can page/swipe ahead to find a specific date.
  const BROWSE_CAP_DAYS = 182;
  const maxDate = addDaysLocal(today, Math.max(horizonDays, BROWSE_CAP_DAYS) - 1);
  const windowStart = addDaysLocal(startOfWeekSunday(today), page * 14);
  const windowDays = Array.from({ length: 14 }, (_, i) => addDaysLocal(windowStart, i));
  const windowEnd = windowDays[13];
  const canPrev = page > 0;
  const canNext = addDaysLocal(windowStart, 14).getTime() <= maxDate.getTime();
  const calLabel = windowStart.getMonth() === windowEnd.getMonth()
    ? monthYear(windowStart)
    : `${HE_MONTHS[windowStart.getMonth()]} – ${HE_MONTHS[windowEnd.getMonth()]}`;

  // ── Swipe between weeks (RTL: swipe left = forward, swipe right = back) ──
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - (touchStartY.current ?? 0);
    touchStartX.current = null;
    touchStartY.current = null;
    // Ignore mostly-vertical swipes (scroll) and tiny moves
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) { if (canNext) setPage(p => p + 1); }      // finger moved left → forward
    else        { if (canPrev) setPage(p => Math.max(0, p - 1)); } // finger moved right → back
  };

  // Fetch which days in the visible window have free slots (green dots)
  useEffect(() => {
    if (!staffId || !serviceId) return;
    const from = formatDate(windowStart);
    const to = formatDate(windowEnd);
    fetch(apiWithSlug(`/api/slots/availability?staffId=${staffId}&serviceId=${serviceId}&from=${from}&to=${to}`, slug))
      .then(r => r.ok ? r.json() : { days: {} })
      .then((data: { days?: Record<string, boolean> }) => {
        setAvailability(prev => ({ ...prev, ...(data.days || {}) }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId, serviceId, page, slug, horizonDays]);

  useEffect(() => {
    if (!staffId || !serviceId || !selectedDate) return;
    setLoading(true);
    setWaitlistSuccess(false);
    fetch(apiWithSlug(`/api/slots?staffId=${staffId}&serviceId=${serviceId}&date=${selectedDate}`, slug))
      .then(res => res.ok ? res.json() : { slots: [] })
      .then((data: { slots?: string[]; closed?: boolean } | string[]) => {
        // Support both old array format (backward compat) and new { slots, closed } format
        const slotList: string[] = Array.isArray(data) ? data : (data.slots ?? []);
        const closed: boolean = Array.isArray(data) ? false : (data.closed ?? false);
        setSlots(slotList);
        // Keep the calendar dot in sync with the actual day view
        setAvailability(prev => ({ ...prev, [selectedDate]: slotList.length > 0 && !closed }));
        setLoading(false);
        // If today has no more available slots (all past), auto-advance to the next date
        if (slotList.length === 0 && !closed && dates.length > 1) {
          const todayStr = formatDate(new Date());
          if (selectedDate === todayStr) {
            const nextDate = dates.find(d => d.date > todayStr);
            if (nextDate) setSelectedDate(nextDate.date);
          }
        }
      })
      .catch(() => { setLoading(false); });
  }, [staffId, serviceId, selectedDate, dates]);

  // Label for the selected date — derived directly so it works for any date in
  // the browse range, not just the (shorter) horizon list.
  const selDateObj = selectedDate ? new Date(selectedDate + "T00:00:00") : null;
  const currentLabel = selDateObj ? getDateLabel(selDateObj, today) : "";
  const dateLabel = selDateObj ? `${currentLabel} ${selDateObj.getDate()}` : selectedDate;

  return (
    <div className="min-h-screen pb-24" dir="rtl" style={{ background: "var(--bg)" }}>

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 px-4 py-3"
        style={{ background: "var(--header-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center justify-between">
          <BackArrow href={publicHref(slug, `/book/service?staffId=${staffId}`)} />
          <h1 className="text-[13px] font-semibold tracking-[0.12em]" style={{ color: "var(--text-pri)" }}>
            בחירת תאריך ושעה
          </h1>
          <StepBar step={3} />
        </div>
      </div>

      {/* ── Date selector — weekly calendar (Sun→Sat), 2 weeks, pageable forward ── */}
      <div className="px-4 pt-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] tracking-[0.3em] uppercase font-semibold" style={{ color: "var(--brand)" }}>תאריך</p>
          <div className="flex items-center gap-3">
            {/* Earlier (toward today) — right-pointing chevron in RTL */}
            <button onClick={() => canPrev && setPage(p => Math.max(0, p - 1))} disabled={!canPrev}
              className="w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-90 disabled:opacity-30"
              style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }} aria-label="שבועיים אחורה">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} style={{ color: "var(--text-sec)" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <span className="text-xs font-semibold min-w-[88px] text-center" style={{ color: "var(--text-pri)" }}>{calLabel}</span>
            {/* Later — left-pointing chevron in RTL */}
            <button onClick={() => canNext && setPage(p => p + 1)} disabled={!canNext}
              className="w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-90 disabled:opacity-30"
              style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }} aria-label="שבועיים קדימה">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} style={{ color: "var(--text-sec)" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Swipeable calendar body — swipe left = forward weeks, right = back */}
        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ touchAction: "pan-y" }}>
        {/* Day-of-week header (Sunday rightmost in RTL) */}
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {["א", "ב", "ג", "ד", "ה", "ו", "ש"].map((d, i) => (
            <div key={i} className="text-center text-[10px] font-semibold py-0.5" style={{ color: "var(--text-muted)" }}>{d}</div>
          ))}
        </div>

        {/* 2-week grid */}
        <div className="grid grid-cols-7 gap-1.5">
          {windowDays.map(d => {
            const ds = formatDate(d);
            const inRange = d.getTime() >= today.getTime() && d.getTime() <= maxDate.getTime();
            const isActive = selectedDate === ds;
            const isToday = ds === formatDate(today);
            const open = availability[ds] === true;
            return (
              <button key={ds} disabled={!inRange} onClick={() => setSelectedDate(ds)}
                className="relative aspect-square flex items-center justify-center rounded-xl transition-all active:scale-95 disabled:cursor-default"
                style={{
                  background: isActive ? "var(--brand)" : inRange ? "var(--card)" : "transparent",
                  border: `1.5px solid ${isActive ? "var(--brand)" : isToday ? "var(--brand)" : inRange ? "var(--divider)" : "transparent"}`,
                  opacity: inRange ? 1 : 0.3,
                }}>
                <span className="text-[15px] font-bold leading-none"
                  style={{ color: isActive ? "#fff" : "var(--text-pri)" }}>
                  {d.getDate()}
                </span>
                {/* Green dot = day has free slots */}
                {inRange && open && (
                  <span className="absolute bottom-[5px] w-1.5 h-1.5 rounded-full"
                    style={{ background: isActive ? "rgba(255,255,255,0.9)" : "#22c55e" }} />
                )}
              </button>
            );
          })}
        </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-2.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#22c55e" }} />
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>יש תורים פנויים</span>
        </div>
      </div>

      {/* ── Time slots ── */}
      <div className="px-4 pt-5">
        {/* Section header */}
        <div className="flex items-center gap-2 mb-4">
          <p className="text-[10px] tracking-[0.3em] uppercase font-semibold" style={{ color: "var(--brand)" }}>
            {currentLabel}
          </p>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2.5">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-14 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
            ))}
          </div>
        ) : slots.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {slots.map(time => (
              <Link key={time}
                href={publicHref(slug, `/book/confirm?staffId=${staffId}&serviceId=${serviceId}&date=${selectedDate}&time=${time}`)}
                className="flex items-center justify-center rounded-2xl py-4 transition-all active:scale-[0.98]"
                dir="ltr"
                style={{
                  background: "var(--card)",
                  border: "1.5px solid var(--divider)",
                  fontSize: "16px",
                  fontWeight: 700,
                  letterSpacing: "0.15em",
                  color: "var(--text-pri)",
                }}>
                {time}
              </Link>
            ))}
          </div>
        ) : (
          <div className="py-16 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
              style={{ background: "var(--card)", border: "1px solid var(--divider)" }}>
              📅
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: "var(--text-pri)" }}>
                אין תורים פנויים ביום זה
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                אפשר להצטרף לרשימת ההמתנה ליום זה או לבחור תאריך אחר
              </p>
            </div>
          </div>
        )}

        {/* ── Waitlist CTA — available on both full and closed days ── */}
        {!loading && selectedDate && (
          <div className="mt-8 rounded-2xl p-4"
            style={{ background: "var(--card)", border: "1px solid var(--divider)" }}>
            <div className="flex items-start gap-3">
              <span className="text-xl mt-0.5">🔔</span>
              <div className="flex-1">
                <p className="text-[13px] font-semibold" style={{ color: "var(--text-pri)" }}>
                  {slots.length > 0 ? "אין את השעה שחיפשת?" : "רוצה תור ביום זה?"}
                </p>
                <p className="text-[11px] mt-1 mb-3 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  הצטרף לרשימת ההמתנה — נשלח לך הודעה ב-WhatsApp ברגע שיתפנה תור
                </p>
                <button onClick={() => { setWaitlistOpen(true); setWaitlistSuccess(false); }}
                  className="text-[12px] font-bold tracking-[0.12em] uppercase px-5 py-2.5 rounded-full transition-all"
                  style={{ border: "1.5px solid var(--brand)", color: "var(--brand)", background: "transparent" }}>
                  הצטרף לרשימת ההמתנה
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {waitlistOpen && !waitlistSuccess && (
        <WaitlistSheet staffId={staffId} serviceId={serviceId} date={selectedDate} dateLabel={dateLabel}
          onClose={() => setWaitlistOpen(false)}
          onSuccess={() => { setWaitlistOpen(false); setWaitlistSuccess(true); }} />
      )}
      {waitlistSuccess && (
        <WaitlistSuccess dateLabel={dateLabel} onClose={() => setWaitlistSuccess(false)} />
      )}
    </div>
  );
}

export default function ChooseTimePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
          <div className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "var(--text-muted)" }}>טוען...</div>
        </div>
      }
    >
      <ChooseTimePageContent />
    </Suspense>
  );
}
