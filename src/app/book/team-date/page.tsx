"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import Link from "next/link";
import { useSlug, apiWithSlug, publicHref, useSmartBack } from "@/lib/public-nav";

type TeamSlot = {
  time: string;
  staffId: string;
  staffName: string;
  staffAvatar: string | null;
  serviceId: string;
  serviceName: string;
  price: number;
  duration: number;
};

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function getDayName(date: Date): string {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return days[date.getDay()];
}
function getDateLabel(date: Date, today: Date): string {
  const diff = Math.floor((date.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  return `יום ${getDayName(date)}`;
}
function addDaysLocal(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function startOfWeekSunday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
function monthYear(date: Date): string {
  return `${HE_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function BackArrow({ href }: { href: string }) {
  const onBack = useSmartBack(href);
  return (
    <Link href={href} onClick={onBack}
      className="w-9 h-9 flex items-center justify-center rounded-full transition-colors"
      style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        style={{ color: "var(--text-sec)" }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

function TeamDatePageContent() {
  const slug = useSlug();

  const [today] = useState(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; });
  const [selectedDate, setSelectedDate] = useState<string>(() => formatDate(new Date()));
  const [horizonDays, setHorizonDays] = useState(30);
  const [page, setPage] = useState(0);
  const [animDir, setAnimDir] = useState<"next" | "prev" | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [slots, setSlots] = useState<TeamSlot[]>([]);
  const [loading, setLoading] = useState(true);

  // Business horizon (team browses up to the longest barber horizon → biz default).
  useEffect(() => {
    fetch(apiWithSlug("/api/business", slug))
      .then(r => r.ok ? r.json() : null)
      .then((biz: { bookingHorizonDays?: number } | null) => {
        setHorizonDays(biz?.bookingHorizonDays || 30);
      })
      .catch(() => {});
  }, [slug]);

  // ── Calendar window (2 weeks, Sun→Sat) ──
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

  const goNext = () => { if (!canNext) return; setAnimDir("next"); setPage(p => p + 1); };
  const goPrev = () => { if (!canPrev) return; setAnimDir("prev"); setPage(p => Math.max(0, p - 1)); };

  // Swipe between weeks (RTL): swipe left→right = forward
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
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) goNext();
    else goPrev();
  };

  // Calendar dots — team-wide availability for the visible window.
  useEffect(() => {
    const from = formatDate(windowStart);
    const to = formatDate(windowEnd);
    fetch(apiWithSlug(`/api/slots/team-by-date?from=${from}&to=${to}`, slug))
      .then(r => r.ok ? r.json() : { days: {} })
      .then((data: { days?: Record<string, boolean> }) => {
        setAvailability(prev => ({ ...prev, ...(data.days || {}) }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, slug, horizonDays]);

  // Available times on the selected date (each assigned to a varied quick-pool barber).
  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    fetch(apiWithSlug(`/api/slots/team-by-date?date=${selectedDate}`, slug))
      .then(r => r.ok ? r.json() : { slots: [] })
      .then((data: { slots?: TeamSlot[] }) => {
        setSlots(data.slots || []);
        setAvailability(prev => ({ ...prev, [selectedDate]: (data.slots || []).length > 0 }));
        setLoading(false);
      })
      .catch(() => { setSlots([]); setLoading(false); });
  }, [selectedDate, slug]);

  const selDateObj = selectedDate ? new Date(selectedDate + "T00:00:00") : null;
  const currentLabel = selDateObj ? getDateLabel(selDateObj, today) : "";

  return (
    <div className="min-h-screen pb-24" dir="rtl" style={{ background: "var(--bg)" }}>
      <style>{`
        @keyframes calSlideNext { from { transform: translateX(-40px); opacity: 0.25; } to { transform: translateX(0); opacity: 1; } }
        @keyframes calSlidePrev { from { transform: translateX(40px);  opacity: 0.25; } to { transform: translateX(0); opacity: 1; } }
        .cal-anim-next { animation: calSlideNext .28s cubic-bezier(0.22,0.61,0.36,1); }
        .cal-anim-prev { animation: calSlidePrev .28s cubic-bezier(0.22,0.61,0.36,1); }
        @media (prefers-reduced-motion: reduce) { .cal-anim-next, .cal-anim-prev { animation: none; } }
      `}</style>

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 px-4 py-3"
        style={{ background: "var(--header-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center justify-between">
          <BackArrow href={publicHref(slug, "/book/team-upcoming")} />
          <h1 className="text-[13px] font-semibold tracking-[0.12em]" style={{ color: "var(--text-pri)" }}>
            בחירת תאריך
          </h1>
          <div className="w-9" />
        </div>
      </div>

      {/* ── Weekly calendar (Sun→Sat), 2 weeks, pageable ── */}
      <div className="px-4 pt-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] tracking-[0.3em] uppercase font-semibold" style={{ color: "var(--brand)" }}>תאריך</p>
          <div className="flex items-center gap-3">
            <button onClick={goPrev} disabled={!canPrev}
              className="w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-90 disabled:opacity-30"
              style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }} aria-label="שבועיים אחורה">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} style={{ color: "var(--text-sec)" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <span className="text-xs font-semibold min-w-[88px] text-center" style={{ color: "var(--text-pri)" }}>{calLabel}</span>
            <button onClick={goNext} disabled={!canNext}
              className="w-8 h-8 flex items-center justify-center rounded-full transition-all active:scale-90 disabled:opacity-30"
              style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }} aria-label="שבועיים קדימה">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} style={{ color: "var(--text-sec)" }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>

        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ touchAction: "pan-y" }}>
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {["א", "ב", "ג", "ד", "ה", "ו", "ש"].map((d, i) => (
              <div key={i} className="text-center text-[10px] font-semibold py-0.5" style={{ color: "var(--text-muted)" }}>{d}</div>
            ))}
          </div>

          <div key={page} className={`grid grid-cols-7 gap-1.5 ${animDir === "next" ? "cal-anim-next" : animDir === "prev" ? "cal-anim-prev" : ""}`}>
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
                  {inRange && open && (
                    <span className="absolute bottom-[5px] w-1.5 h-1.5 rounded-full"
                      style={{ background: isActive ? "rgba(255,255,255,0.9)" : "#22c55e" }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-2.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#22c55e" }} />
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>יש ספרים פנויים</span>
        </div>
      </div>

      {/* ── Available times on the selected date (each → a varied quick-pool barber) ── */}
      <div className="px-4 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <p className="text-[10px] tracking-[0.3em] uppercase font-semibold" style={{ color: "var(--brand)" }}>
            {currentLabel}
          </p>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>· בחר/י שעה פנויה</span>
        </div>

        {loading ? (
          <div className="flex flex-col gap-2.5">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />
            ))}
          </div>
        ) : slots.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {slots.map(s => (
              <Link key={`${s.time}-${s.staffId}`}
                href={publicHref(slug, `/book/confirm?staffId=${s.staffId}&serviceId=${s.serviceId}&date=${selectedDate}&time=${s.time}`)}
                className="flex items-center justify-between rounded-2xl px-4 py-3 transition-all active:scale-[0.98]"
                style={{ background: "var(--card)", border: "1.5px solid var(--divider)" }}>
                <span dir="ltr" className="text-[17px] font-bold tracking-widest" style={{ color: "var(--brand)" }}>
                  {s.time}
                </span>
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="text-left min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: "var(--text-pri)" }}>{s.staffName}</p>
                    <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{s.serviceName}</p>
                  </div>
                  <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0"
                    style={{ border: "1px solid var(--divider)" }}>
                    {s.staffAvatar ? (
                      <img src={s.staffAvatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ background: "var(--brand)" }}>
                        {s.staffName[0]}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="py-16 flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
              style={{ background: "var(--card)", border: "1px solid var(--divider)" }}>📅</div>
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: "var(--text-pri)" }}>אין תורים פנויים ביום זה</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>נסה לבחור תאריך אחר ביומן</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TeamDatePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
          <div className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "var(--text-muted)" }}>טוען...</div>
        </div>
      }
    >
      <TeamDatePageContent />
    </Suspense>
  );
}
