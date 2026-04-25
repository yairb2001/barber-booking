"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

type StaffInfo = { id: string; name: string };
type ServiceInfo = {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  customPrice: number | null;
  customDuration: number | null;
};

// ── Waitlist card shown after a successful booking ─────────────────────────────
function WaitlistCard({ phone, name, staffId, serviceId, date }: {
  phone: string; name: string; staffId: string; serviceId: string; date: string;
}) {
  const [timeOfDay, setTimeOfDay]   = useState<"morning" | "afternoon" | "any">("morning");
  const [isFlexible, setIsFlexible] = useState(true);
  const [joining, setJoining]       = useState(false);
  const [joined, setJoined]         = useState(false);
  const [error, setError]           = useState("");

  async function join() {
    setJoining(true);
    setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name, staffId, serviceId, date, isFlexible, preferredTimeOfDay: timeOfDay }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "שגיאה");
      } else {
        setJoined(true);
      }
    } catch {
      setError("שגיאת חיבור");
    }
    setJoining(false);
  }

  if (joined) {
    return (
      <div className="bg-[var(--brand)/8] rounded-2xl border border-[var(--brand)/30] p-5 text-center shadow-sm">
        <div className="text-2xl text-[var(--brand)] mb-2">🔔</div>
        <p className="text-xs tracking-[0.15em] uppercase text-[var(--brand)] font-light">הצטרפת לרשימת המתנה</p>
        <p className="text-neutral-400 text-xs mt-2 leading-relaxed">נעדכן אותך ב-WhatsApp אם יתפנה מקום מוקדם יותר.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-100 p-5 shadow-sm">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-[var(--brand)] text-lg flex-shrink-0">🔔</span>
        <div>
          <p className="text-xs tracking-[0.1em] uppercase font-light text-neutral-900">רוצה להגיע מוקדם יותר?</p>
          <p className="text-neutral-400 text-xs mt-1 leading-relaxed">
            הצטרף לרשימת המתנה — נשלח לך הודעה ב-WhatsApp אם יתפנה מקום.
          </p>
        </div>
      </div>

      {/* Time of day */}
      <p className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase mb-2">שעה מועדפת</p>
      <div className="flex gap-2 mb-4">
        {([
          ["morning",   "בוקר",    "09:00–12:00"],
          ["afternoon", "צהריים",  "12:00–17:00"],
          ["any",       "כל שעה",  ""],
        ] as const).map(([val, label, hint]) => (
          <button
            key={val}
            onClick={() => setTimeOfDay(val)}
            className={`flex-1 border rounded-xl py-2 px-1 text-center transition-colors ${
              timeOfDay === val
                ? "border-[var(--brand)] bg-[var(--brand)/8] text-[var(--brand)]"
                : "border-neutral-200 text-neutral-500 hover:border-[var(--brand)/30] bg-stone-50"
            }`}
          >
            <div className="text-[11px] tracking-wider font-light">{label}</div>
            {hint && <div className="text-[9px] text-neutral-400 mt-0.5" dir="ltr">{hint}</div>}
          </button>
        ))}
      </div>

      {/* Flexibility */}
      <label className="flex items-center gap-3 mb-5 cursor-pointer">
        <input
          type="checkbox"
          checked={isFlexible}
          onChange={(e) => setIsFlexible(e.target.checked)}
          className="accent-[var(--brand)] w-4 h-4 rounded"
        />
        <span className="text-xs text-neutral-500 leading-relaxed">גמיש עם התאריך — כמה שיותר מוקדם</span>
      </label>

      {error && (
        <p className="text-xs text-red-500 mb-3 tracking-wide">{error}</p>
      )}

      <button
        onClick={join}
        disabled={joining}
        className="w-full border border-[var(--brand)] text-[var(--brand)] text-xs tracking-[0.15em] uppercase py-3 rounded-full hover:bg-[var(--brand)] hover:text-white hover:border-[var(--brand)] transition-colors disabled:opacity-40"
      >
        {joining ? "מצרף..." : "הצטרף לרשימת המתנה"}
      </button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
function ConfirmPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const staffId   = searchParams.get("staffId")   || "";
  const serviceId = searchParams.get("serviceId") || "";
  const date      = searchParams.get("date")      || "";
  const time      = searchParams.get("time")      || "";

  const [staffInfo, setStaffInfo]     = useState<StaffInfo | null>(null);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [phone, setPhone]             = useState("");
  const [name, setName]               = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [referrerPhone, setReferrerPhone]   = useState("");
  const [referralOptions, setReferralOptions] = useState<string[]>([]);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState("");

  useEffect(() => {
    fetch("/api/referral-sources").then((r) => r.json()).then(setReferralOptions).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/staff")
      .then((r) => r.json())
      .then((data: StaffInfo[]) => {
        const found = data.find((s) => s.id === staffId);
        if (found) setStaffInfo(found);
      });

    if (staffId) {
      fetch(`/api/services?staffId=${staffId}`)
        .then((r) => r.json())
        .then((data: ServiceInfo[]) => {
          const found = data.find((s) => s.id === serviceId);
          if (found) setServiceInfo(found);
        });
    }
  }, [staffId, serviceId]);

  const dateObj   = date ? new Date(date + "T00:00:00") : null;
  const dateLabel = dateObj
    ? dateObj.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })
    : "";
  const price    = serviceInfo ? serviceInfo.customPrice ?? serviceInfo.price : 0;
  const duration = serviceInfo ? serviceInfo.customDuration ?? serviceInfo.durationMinutes : 0;

  const handleSubmit = async () => {
    if (!phone || !name) { setError("נא למלא טלפון ושם"); return; }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId, serviceId, date, startTime: time,
          customerPhone: phone, customerName: name,
          referralSource: referralSource || undefined,
          referrerPhone: (referralSource === "חבר הביא חבר" && referrerPhone) ? referrerPhone : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "שגיאה בקביעת התור");
        setSubmitting(false);
        return;
      }
      const appointment = await res.json();
      router.push(
        `/book/confirm?success=true&appointmentId=${appointment.id}` +
        `&staffId=${staffId}&serviceId=${serviceId}` +
        `&staffName=${encodeURIComponent(appointment.staff.name)}` +
        `&serviceName=${encodeURIComponent(appointment.service.name)}` +
        `&date=${date}&time=${time}&price=${price}` +
        `&phone=${encodeURIComponent(phone)}&customerName=${encodeURIComponent(name)}`
      );
    } catch {
      setError("שגיאה בחיבור לשרת");
      setSubmitting(false);
    }
  };

  // ── Success screen ──────────────────────────────────────────────────────────
  const isSuccess = searchParams.get("success") === "true";
  if (isSuccess) {
    const successDate     = searchParams.get("date")         || "";
    const successTime     = searchParams.get("time")         || "";
    const successPrice    = searchParams.get("price")        || "";
    const successStaffId  = searchParams.get("staffId")      || "";
    const successSvcId    = searchParams.get("serviceId")    || "";
    const successPhone    = searchParams.get("phone")        || "";
    const successName     = searchParams.get("customerName") || "";

    const successDateObj   = successDate ? new Date(successDate + "T00:00:00") : null;
    const successDateLabel = successDateObj
      ? successDateObj.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })
      : "";

    return (
      <div className="min-h-screen bg-[#faf9f7] flex flex-col items-center justify-center px-5 py-12" dir="rtl">
        <div className="w-full max-w-sm space-y-6">
          {/* Header */}
          <div className="text-center space-y-4">
            {/* Check mark */}
            <div className="w-16 h-16 border-2 border-[var(--brand)] rounded-full flex items-center justify-center mx-auto bg-[var(--brand)/8] shadow-md">
              <svg className="w-7 h-7 text-[var(--brand)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>

            <div>
              <h1 className="text-2xl font-light tracking-[0.2em] uppercase text-neutral-900 mb-2">
                התור נקבע
              </h1>
              <p className="text-[10px] tracking-[0.25em] text-neutral-400 uppercase">
                נשלחה הודעת אישור ב-WhatsApp
              </p>
            </div>

            <div className="w-8 h-px bg-[var(--brand)] mx-auto" />
          </div>

          {/* Summary card */}
          <div className="bg-white rounded-2xl border border-neutral-100 shadow-md overflow-hidden">
            <div className="divide-y divide-neutral-50">
              <div className="flex justify-between items-center px-5 py-3.5">
                <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase">ספר</span>
                <span className="text-sm font-light text-neutral-900">{searchParams.get("staffName")}</span>
              </div>
              <div className="flex justify-between items-center px-5 py-3.5">
                <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase">שירות</span>
                <span className="text-sm font-light text-neutral-900">{searchParams.get("serviceName")}</span>
              </div>
              <div className="flex justify-between items-center px-5 py-3.5">
                <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase">תאריך</span>
                <span className="text-sm font-light text-neutral-900">{successDateLabel}</span>
              </div>
              <div className="flex justify-between items-center px-5 py-3.5">
                <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase">שעה</span>
                <span className="text-sm font-light text-neutral-900" dir="ltr">{successTime}</span>
              </div>
              <div className="flex justify-between items-center px-5 py-4">
                <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase">מחיר</span>
                <span className="text-xl text-[var(--brand)] font-light">₪{successPrice}</span>
              </div>
            </div>
          </div>

          {/* Waitlist card */}
          {successPhone && successStaffId && successSvcId && successDate && (
            <WaitlistCard
              phone={successPhone}
              name={successName}
              staffId={successStaffId}
              serviceId={successSvcId}
              date={successDate}
            />
          )}

          {/* Home button */}
          <Link
            href="/"
            className="block text-center bg-[var(--brand)] text-white font-semibold text-sm tracking-[0.15em] uppercase py-4 rounded-full hover:bg-[var(--brand)] transition-colors shadow-md"
          >
            חזרה לדף הבית
          </Link>
        </div>
      </div>
    );
  }

  // ── Booking form ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#faf9f7]" dir="rtl">
      {/* ===== Sticky Header ===== */}
      <div className="sticky top-0 z-20 bg-[#faf9f7]/95 backdrop-blur-md border-b border-neutral-100 px-5 py-4">
        <div className="flex items-center justify-between">
          <Link
            href={`/book/time?staffId=${staffId}&serviceId=${serviceId}`}
            className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-[11px] tracking-[0.25em] font-light uppercase text-neutral-600">
            אישור תור
          </h1>
          <div className="w-8" />
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* ===== Appointment Summary ===== */}
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-2">
            <p className="text-[10px] tracking-[0.25em] text-neutral-400 uppercase">סיכום</p>
          </div>
          <div className="divide-y divide-neutral-50">
            <div className="flex justify-between items-center px-5 py-3.5">
              <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase">ספר</span>
              <span className="text-sm font-light text-neutral-800">{staffInfo?.name || "..."}</span>
            </div>
            <div className="flex justify-between items-center px-5 py-3.5">
              <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase">שירות</span>
              <span className="text-sm font-light text-neutral-800">{serviceInfo?.name || "..."}</span>
            </div>
            <div className="flex justify-between items-center px-5 py-3.5">
              <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase">תאריך</span>
              <span className="text-sm font-light text-neutral-800">{dateLabel}</span>
            </div>
            <div className="flex justify-between items-center px-5 py-3.5">
              <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase">שעה</span>
              <span className="text-sm font-light text-neutral-800" dir="ltr">{time}</span>
            </div>
            <div className="flex justify-between items-center px-5 py-3.5">
              <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase">משך</span>
              <span className="text-sm font-light text-neutral-800">{duration} דקות</span>
            </div>
            <div className="flex justify-between items-center px-5 py-4">
              <span className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase">מחיר</span>
              <span className="text-xl text-[var(--brand)] font-light">₪{price}</span>
            </div>
          </div>
        </div>

        {/* ===== Customer Details ===== */}
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5">
          <p className="text-[10px] tracking-[0.25em] text-neutral-400 uppercase mb-5">פרטים</p>
          <div className="space-y-4">
            <div>
              <label className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase block mb-2">
                טלפון
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="050-0000000"
                dir="ltr"
                className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 focus:border-[var(--brand)] transition-colors"
              />
            </div>
            <div>
              <label className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase block mb-2">
                שם
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="השם שלך"
                className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 focus:border-[var(--brand)] transition-colors"
              />
            </div>
          </div>
        </div>

        {/* ===== Referral Source ===== */}
        <div className="bg-white rounded-2xl border border-neutral-100 shadow-sm p-5">
          <p className="text-[10px] tracking-[0.25em] text-neutral-400 uppercase mb-5">מאיפה הכרת אותנו?</p>
          <select
            value={referralSource}
            onChange={(e) => { setReferralSource(e.target.value); setReferrerPhone(""); }}
            className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-3 text-sm text-neutral-700 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 focus:border-[var(--brand)] transition-colors appearance-none"
            style={{ WebkitAppearance: "none" }}
          >
            <option value="" className="text-neutral-400">בחר (אופציונלי)</option>
            {referralOptions.map((src) => (
              <option key={src} value={src} className="text-neutral-900">{src}</option>
            ))}
          </select>

          {/* Referrer phone */}
          {referralSource === "חבר הביא חבר" && (
            <div className="mt-4">
              <label className="text-[10px] tracking-[0.2em] text-neutral-400 uppercase block mb-2">
                טלפון החבר שהמליץ
              </label>
              <input
                type="tel"
                value={referrerPhone}
                onChange={(e) => setReferrerPhone(e.target.value)}
                placeholder="050-0000000"
                dir="ltr"
                className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40 focus:border-[var(--brand)] transition-colors"
              />
              <p className="text-[10px] text-neutral-400 mt-2 leading-relaxed">
                כל 2 חברים שתביא — מוצר במתנה | 3 חברים — תספורת חינם
              </p>
            </div>
          )}
        </div>

        {/* ===== Error ===== */}
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-red-500 text-xs tracking-wide text-center">{error}</p>
          </div>
        )}

        {/* ===== Submit button ===== */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !phone || !name}
          className="w-full bg-[var(--brand)] text-white font-semibold text-sm tracking-[0.2em] uppercase py-5 rounded-full hover:bg-[var(--brand)] disabled:bg-neutral-200 disabled:text-neutral-400 transition-colors shadow-md hover:shadow-lg"
        >
          {submitting ? "קובע תור..." : "קביעת תור!"}
        </button>
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center">
          <div className="text-[10px] tracking-[0.3em] text-neutral-400 uppercase">טוען...</div>
        </div>
      }
    >
      <ConfirmPageContent />
    </Suspense>
  );
}
