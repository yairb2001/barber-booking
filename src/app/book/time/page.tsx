"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getDayName(date: Date): string {
  const days = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  return days[date.getDay()];
}

function getDateLabel(date: Date, today: Date): string {
  const diff = Math.floor(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  return `יום ${getDayName(date)}`;
}

// Progress dots component
function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-300 ${
            i === step
              ? "w-4 h-2 bg-[var(--brand)]"
              : i < step
              ? "w-2 h-2 bg-[var(--brand)/60]"
              : "w-2 h-2 bg-neutral-200"
          }`}
        />
      ))}
    </div>
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
  const [name, setName]       = useState("");
  const [phone, setPhone]     = useState("");
  const [pref, setPref]       = useState<"morning" | "afternoon" | "evening" | "any">("any");
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState<string | null>(null);

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
    const r = await fetch("/api/waitlist", {
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
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl border-t border-neutral-100 p-6 space-y-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="w-10 h-1 bg-neutral-200 mx-auto rounded-full" />

        <div>
          <h2 className="text-base tracking-[0.15em] font-light uppercase text-neutral-900">
            רשימת המתנה
            <span className="text-[var(--brand)] mr-2">🔔</span>
          </h2>
          <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
            {dateLabel} — נודיע לך ב-WhatsApp כשיתפנה מקום
          </p>
        </div>

        {/* Preferred time */}
        <div>
          <p className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase mb-3">שעה מועדפת</p>
          <div className="grid grid-cols-2 gap-2">
            {prefs.map((p) => (
              <button
                key={p.v}
                onClick={() => setPref(p.v)}
                className={`py-3 px-3 rounded-xl text-sm text-right border transition-colors ${
                  pref === p.v
                    ? "bg-[var(--brand)] text-white border-[var(--brand)] font-semibold"
                    : "bg-stone-50 border-neutral-200 text-neutral-600 hover:border-[var(--brand)/30]"
                }`}
              >
                <div className="text-xs tracking-[0.1em]">{p.l}</div>
                {p.s && <div className="text-[10px] opacity-60 mt-0.5 font-light" dir="ltr">{p.s}</div>}
              </button>
            ))}
          </div>
        </div>

        {/* Name + phone */}
        <div className="space-y-3">
          <div>
            <label className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase block mb-2">שם מלא</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ישראל ישראלי"
              className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 focus:border-[var(--brand)] transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase block mb-2">טלפון</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="050-0000000"
              type="tel"
              dir="ltr"
              className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 focus:border-[var(--brand)] transition-colors"
            />
          </div>
        </div>

        {err && <p className="text-xs text-red-500 tracking-wide">{err}</p>}

        <button
          onClick={submit}
          disabled={saving}
          className="w-full bg-[var(--brand)] text-white font-semibold py-4 text-sm tracking-[0.15em] uppercase rounded-full hover:bg-[var(--brand)] disabled:opacity-40 transition-all active:scale-[0.99] shadow-md"
        >
          {saving ? "שומר..." : "הצטרף להמתנה"}
        </button>
      </div>
    </div>
  );
}

// ── Success screen ─────────────────────────────────────────────────────────────
function WaitlistSuccess({ dateLabel, onClose }: { dateLabel: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl border-t border-neutral-100 p-6 text-center space-y-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-neutral-200 mx-auto rounded-full" />

        <div className="text-3xl text-[var(--brand)]">🔔</div>

        <div>
          <h2 className="text-base tracking-[0.2em] font-light uppercase text-neutral-900 mb-2">
            נרשמת בהצלחה
          </h2>
          <p className="text-xs text-neutral-400 leading-relaxed">
            ברגע שיתפנה תור ב{dateLabel} — נשלח לך הודעה ב-WhatsApp
          </p>
        </div>

        <button
          onClick={onClose}
          className="w-full bg-[var(--brand)] text-white font-semibold py-4 text-sm tracking-[0.15em] uppercase rounded-full hover:bg-[var(--brand)] transition-colors shadow-md"
        >
          סגור
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
function ChooseTimePageContent() {
  const searchParams = useSearchParams();
  const staffId = searchParams.get("staffId") || "";
  const serviceId = searchParams.get("serviceId") || "";

  const [selectedDate, setSelectedDate] = useState<string>("");
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [dates, setDates] = useState<{ date: string; label: string; dayName: string; dayNum: number }[]>([]);

  const [waitlistOpen, setWaitlistOpen]       = useState(false);
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);

  // Generate dates based on bookingHorizonDays
  useEffect(() => {
    Promise.all([
      fetch("/api/business").then((r) => r.json()).catch(() => null),
      staffId ? fetch("/api/staff").then((r) => r.json()).catch(() => []) : Promise.resolve([]),
    ]).then(([biz, staffList]) => {
      const bizHorizon: number = biz?.bookingHorizonDays || 30;
      const staffRecord = Array.isArray(staffList)
        ? staffList.find((s: { id: string }) => s.id === staffId)
        : null;
      const horizonDays: number = staffRecord?.bookingHorizonDays ?? bizHorizon;
      buildDates(horizonDays);
    }).catch(() => buildDates(30));

    function buildDates(horizonDays: number) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const nextDates = [];
      for (let i = 0; i < horizonDays; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        nextDates.push({
          date: formatDate(d),
          label: getDateLabel(d, today),
          dayName: getDayName(d),
          dayNum: d.getDate(),
        });
      }
      setDates(nextDates);
      setSelectedDate(formatDate(today));
    }
  }, []);

  // Fetch slots when date changes
  useEffect(() => {
    if (!staffId || !serviceId || !selectedDate) return;
    setLoading(true);
    setWaitlistSuccess(false);
    fetch(`/api/slots?staffId=${staffId}&serviceId=${serviceId}&date=${selectedDate}`)
      .then((res) => res.json())
      .then((data) => { setSlots(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [staffId, serviceId, selectedDate]);

  const currentDateObj = dates.find((d) => d.date === selectedDate);
  const dateLabel = currentDateObj
    ? `${currentDateObj.label} ${currentDateObj.dayNum}`
    : selectedDate;

  return (
    <div className="min-h-screen bg-[#faf9f7] pb-10" dir="rtl">
      {/* ===== Sticky Header ===== */}
      <div className="sticky top-0 z-20 bg-[#faf9f7]/95 backdrop-blur-md border-b border-neutral-100 px-5 py-4">
        <div className="flex items-center justify-between">
          <Link
            href={`/book/service?staffId=${staffId}`}
            className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>

          <h1 className="text-[11px] tracking-[0.25em] font-light uppercase text-neutral-600">
            בחר תאריך ושעה
          </h1>

          {/* Step 3 — all 3 dots amber */}
          <ProgressDots step={3} />
        </div>
      </div>

      {/* ===== Date Selector ===== */}
      <div className="px-5 pt-6">
        <p className="text-[10px] tracking-[0.25em] text-neutral-400 uppercase mb-4">תאריך</p>
        <div
          className="flex gap-2 overflow-x-auto pb-2"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <style jsx>{`div::-webkit-scrollbar { display: none; }`}</style>
          {dates.map((d) => (
            <button
              key={d.date}
              onClick={() => setSelectedDate(d.date)}
              className={`flex-shrink-0 min-w-[60px] py-3 px-2 text-center rounded-full border transition-all ${
                selectedDate === d.date
                  ? "bg-[var(--brand)] border-[var(--brand)] text-white shadow-md"
                  : "bg-white border-neutral-200 text-neutral-500 hover:border-[var(--brand)/30] hover:bg-[var(--brand)/8] shadow-sm"
              }`}
            >
              <div className="text-[9px] tracking-wider uppercase mb-1">
                {d.label.length <= 4 ? d.label : d.dayName}
              </div>
              <div className={`text-lg font-light ${selectedDate === d.date ? "text-white" : "text-neutral-800"}`}>
                {d.dayNum}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ===== Time Slots ===== */}
      <div className="px-5 pt-6">
        <p className="text-[10px] tracking-[0.25em] text-neutral-400 uppercase mb-4">
          {currentDateObj?.label || ""}
        </p>

        {loading ? (
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
              <div key={i} className="h-12 bg-neutral-100 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : slots.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {slots.map((time) => (
              <Link
                key={time}
                href={`/book/confirm?staffId=${staffId}&serviceId=${serviceId}&date=${selectedDate}&time=${time}`}
                className="bg-white hover:bg-[var(--brand)] hover:text-white border border-neutral-200 hover:border-[var(--brand)] transition-all text-center py-3.5 rounded-xl font-light text-sm tracking-widest text-neutral-700 hover:font-semibold shadow-sm hover:shadow-md"
                dir="ltr"
              >
                {time}
              </Link>
            ))}
          </div>
        ) : (
          <div className="py-16 text-center">
            <div className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-6">
              <div className="w-4 h-px bg-neutral-300" />
            </div>
            <p className="text-sm tracking-[0.2em] font-light text-neutral-400 uppercase">אין זמינות</p>
            <p className="text-xs text-neutral-300 mt-2 tracking-wider">נסה תאריך אחר</p>
          </div>
        )}

        {/* ===== Waitlist CTA ===== */}
        {!loading && selectedDate && (
          <div className="mt-10 rounded-2xl border border-[var(--brand)/30] bg-[var(--brand)/8] p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="text-[var(--brand)] text-base mt-0.5">🔔</span>
              <div className="flex-1">
                <p className="text-sm font-light text-neutral-900 tracking-wide">
                  אין את השעה שחיפשת?
                </p>
                <p className="text-xs text-neutral-500 mt-1 mb-4 leading-relaxed">
                  הצטרף לרשימת ההמתנה — נשלח לך הודעה ב-WhatsApp ברגע שיתפנה תור
                </p>
                <button
                  onClick={() => { setWaitlistOpen(true); setWaitlistSuccess(false); }}
                  className="border border-[var(--brand)] text-[var(--brand)] text-xs tracking-[0.15em] uppercase px-5 py-2.5 rounded-full hover:bg-[var(--brand)] hover:text-white hover:border-[var(--brand)] transition-colors"
                >
                  הצטרף לרשימת ההמתנה
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Waitlist bottom sheet */}
      {waitlistOpen && !waitlistSuccess && (
        <WaitlistSheet
          staffId={staffId}
          serviceId={serviceId}
          date={selectedDate}
          dateLabel={dateLabel}
          onClose={() => setWaitlistOpen(false)}
          onSuccess={() => { setWaitlistOpen(false); setWaitlistSuccess(true); }}
        />
      )}

      {/* Success overlay */}
      {waitlistSuccess && (
        <WaitlistSuccess
          dateLabel={dateLabel}
          onClose={() => setWaitlistSuccess(false)}
        />
      )}
    </div>
  );
}

export default function ChooseTimePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center">
          <div className="text-[10px] tracking-[0.3em] text-neutral-400 uppercase">טוען...</div>
        </div>
      }
    >
      <ChooseTimePageContent />
    </Suspense>
  );
}
