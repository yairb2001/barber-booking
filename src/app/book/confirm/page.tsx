"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

type StaffInfo = { id: string; name: string };
type ServiceInfo = {
  id: string; name: string; price: number; durationMinutes: number;
  showDuration: boolean; customPrice: number | null; customDuration: number | null;
};

// ── Waitlist card ──────────────────────────────────────────────────────────────
function WaitlistCard({ phone, name, staffId, serviceId, date }: {
  phone: string; name: string; staffId: string; serviceId: string; date: string;
}) {
  const [timeOfDay, setTimeOfDay]   = useState<"morning" | "afternoon" | "any">("morning");
  const [isFlexible, setIsFlexible] = useState(true);
  const [joining, setJoining]       = useState(false);
  const [joined, setJoined]         = useState(false);
  const [error, setError]           = useState("");

  async function join() {
    setJoining(true); setError("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name, staffId, serviceId, date, isFlexible, preferredTimeOfDay: timeOfDay }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || "שגיאה"); }
      else setJoined(true);
    } catch { setError("שגיאת חיבור"); }
    setJoining(false);
  }

  if (joined) {
    return (
      <div className="bg-green-50 rounded-2xl border border-green-200 p-5 text-center">
        <div className="text-2xl mb-2">🔔</div>
        <p className="text-sm font-semibold text-green-700">הצטרפת לרשימת המתנה</p>
        <p className="text-xs text-green-600 mt-1 leading-relaxed">נעדכן אותך ב-WhatsApp אם יתפנה מקום מוקדם יותר.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-xl flex-shrink-0">🔔</span>
        <div>
          <p className="text-[13px] font-semibold text-slate-900">רוצה להגיע מוקדם יותר?</p>
          <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">הצטרף לרשימת המתנה — נשלח לך הודעה ב-WhatsApp אם יתפנה מקום.</p>
        </div>
      </div>
      <p className="text-[10px] font-semibold tracking-[0.2em] text-slate-400 uppercase mb-2">שעה מועדפת</p>
      <div className="flex gap-2 mb-4">
        {([["morning","בוקר","09:00–12:00"],["afternoon","צהריים","12:00–17:00"],["any","כל שעה",""]] as const).map(([val, label, hint]) => (
          <button key={val} onClick={() => setTimeOfDay(val)}
            className="flex-1 border rounded-xl py-2 px-1 text-center transition-colors text-[11px]"
            style={{
              background: timeOfDay === val ? "var(--brand)" : "#F8FAFC",
              border: `1.5px solid ${timeOfDay === val ? "var(--brand)" : "#E2E8F0"}`,
              color: timeOfDay === val ? "#fff" : "#475569",
              fontWeight: timeOfDay === val ? 700 : 500,
            }}>
            {label}
            {hint && <div className="text-[9px] opacity-70 mt-0.5" dir="ltr">{hint}</div>}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 mb-4 cursor-pointer">
        <input type="checkbox" checked={isFlexible} onChange={e => setIsFlexible(e.target.checked)}
          className="w-4 h-4 rounded accent-slate-700" />
        <span className="text-[12px] text-slate-500">גמיש עם התאריך — כמה שיותר מוקדם</span>
      </label>
      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
      <button onClick={join} disabled={joining}
        className="w-full text-[12px] font-bold tracking-[0.12em] uppercase py-3 rounded-full border-2 transition-all disabled:opacity-40"
        style={{ border: `2px solid var(--brand)`, color: "var(--brand)", background: "transparent" }}>
        {joining ? "מצרף..." : "הצטרף לרשימת המתנה"}
      </button>
    </div>
  );
}

// ── App download banner ────────────────────────────────────────────────────────
function AppDownloadBanner({ appStoreUrl, playStoreUrl }: { appStoreUrl?: string; playStoreUrl?: string }) {
  if (!appStoreUrl && !playStoreUrl) return null;
  return (
    <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)" }}>
      <p className="text-[11px] font-semibold tracking-[0.15em] uppercase text-slate-400 mb-1">חבר מביא חבר 📱</p>
      <p className="text-[13px] text-slate-200 leading-relaxed mb-4">
        הורד את האפליקציה שלנו ותיהנה מתוכנית חבר מביא חבר — כל 2 חברים שתביא מוצר במתנה!
      </p>
      <div className="flex gap-2">
        {appStoreUrl && (
          <a href={appStoreUrl} target="_blank" rel="noopener noreferrer"
            className="flex-1 bg-white text-slate-900 text-[12px] font-bold tracking-wide text-center py-2.5 rounded-xl">
            🍎 App Store
          </a>
        )}
        {playStoreUrl && (
          <a href={playStoreUrl} target="_blank" rel="noopener noreferrer"
            className="flex-1 bg-white text-slate-900 text-[12px] font-bold tracking-wide text-center py-2.5 rounded-xl">
            🤖 Google Play
          </a>
        )}
      </div>
    </div>
  );
}

// ── Row helper ─────────────────────────────────────────────────────────────────
function SummaryRow({ label, value, large }: { label: string; value: React.ReactNode; large?: boolean }) {
  return (
    <div className="flex justify-between items-center px-5 py-3.5 border-b border-slate-100 last:border-0">
      <span className="text-[11px] font-semibold tracking-[0.15em] text-slate-400 uppercase">{label}</span>
      <span className={large ? "text-xl font-bold" : "text-[14px] font-medium text-slate-800"}
        style={large ? { color: "var(--brand)" } : {}}>{value}</span>
    </div>
  );
}

// ── Main page content ──────────────────────────────────────────────────────────
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

  const [otpSent,      setOtpSent]      = useState(false);
  const [otpCode,      setOtpCode]      = useState("");
  const [otpVerified,  setOtpVerified]  = useState(false);
  const [otpToken,     setOtpToken]     = useState("");
  const [otpSending,   setOtpSending]   = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError,     setOtpError]     = useState("");

  const [businessId,   setBusinessId]   = useState("");
  const [appStoreUrl,  setAppStoreUrl]  = useState("");
  const [playStoreUrl, setPlayStoreUrl] = useState("");

  useEffect(() => {
    fetch("/api/referral-sources").then(r => r.json()).then(setReferralOptions).catch(() => {});
    fetch("/api/business").then(r => r.json()).then(biz => {
      if (biz?.id) setBusinessId(biz.id);
      try {
        const s = typeof biz?.settings === "string" ? JSON.parse(biz.settings) : (biz?.settings || {});
        if (s.appStoreUrl)  setAppStoreUrl(s.appStoreUrl);
        if (s.playStoreUrl) setPlayStoreUrl(s.playStoreUrl);
      } catch { /* ignore */ }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/staff").then(r => r.json()).then((data: StaffInfo[]) => {
      const found = data.find(s => s.id === staffId);
      if (found) setStaffInfo(found);
    });
    if (staffId) {
      fetch(`/api/services?staffId=${staffId}`).then(r => r.json()).then((data: ServiceInfo[]) => {
        const found = data.find(s => s.id === serviceId);
        if (found) setServiceInfo(found);
      });
    }
  }, [staffId, serviceId]);

  useEffect(() => {
    setOtpSent(false); setOtpCode(""); setOtpVerified(false); setOtpToken(""); setOtpError("");
  }, [phone]);

  const dateObj   = date ? new Date(date + "T00:00:00") : null;
  const dateLabel = dateObj ? dateObj.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" }) : "";
  const price    = serviceInfo ? (serviceInfo.customPrice ?? serviceInfo.price) : 0;
  const duration = serviceInfo ? (serviceInfo.customDuration ?? serviceInfo.durationMinutes) : 0;

  async function sendOtp() {
    if (!phone) { setOtpError("הזן מספר טלפון תחילה"); return; }
    setOtpSending(true); setOtpError("");
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, businessId: businessId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) setOtpError(data.error || "שגיאה בשליחת קוד");
      else setOtpSent(true);
    } catch { setOtpError("שגיאת חיבור — נסה שוב"); }
    setOtpSending(false);
  }

  async function verifyOtp() {
    if (!otpCode) { setOtpError("הזן את הקוד שקיבלת"); return; }
    setOtpVerifying(true); setOtpError("");
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: otpCode, businessId: businessId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) setOtpError(data.error || "קוד שגוי");
      else { setOtpVerified(true); setOtpToken(data.token); setOtpError(""); }
    } catch { setOtpError("שגיאת חיבור — נסה שוב"); }
    setOtpVerifying(false);
  }

  async function handleSubmit() {
    if (!phone || !name) { setError("נא למלא טלפון ושם"); return; }
    if (!otpVerified) { setError("נדרש אימות טלפון — שלח קוד אימות"); return; }
    setSubmitting(true); setError("");
    try {
      const res = await fetch("/api/appointments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId, serviceId, date, startTime: time,
          customerPhone: phone, customerName: name,
          referralSource: referralSource || undefined,
          referrerPhone: (referralSource === "חבר הביא חבר" && referrerPhone) ? referrerPhone : undefined,
          otpToken,
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
  }

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
    const successDateLabel = successDate
      ? new Date(successDate + "T00:00:00").toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })
      : "";

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-5 py-12" dir="rtl">
        <div className="w-full max-w-sm space-y-4">
          {/* Success icon */}
          <div className="text-center space-y-3 mb-2">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto shadow-md"
              style={{ background: "var(--brand)" }}>
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">התור נקבע! 🎉</h1>
              <p className="text-[12px] text-slate-500 mt-1">נשלחה הודעת אישור ב-WhatsApp</p>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <SummaryRow label="ספר" value={searchParams.get("staffName")} />
            <SummaryRow label="שירות" value={searchParams.get("serviceName")} />
            <SummaryRow label="תאריך" value={successDateLabel} />
            <SummaryRow label="שעה" value={<span dir="ltr">{successTime}</span>} />
            <SummaryRow label="מחיר" value={`₪${successPrice}`} large />
          </div>

          <AppDownloadBanner appStoreUrl={appStoreUrl} playStoreUrl={playStoreUrl} />

          {successPhone && successStaffId && successSvcId && successDate && (
            <WaitlistCard phone={successPhone} name={successName}
              staffId={successStaffId} serviceId={successSvcId} date={successDate} />
          )}

          <Link href="/"
            className="block text-center text-[13px] font-bold tracking-[0.15em] uppercase py-4 rounded-full text-white shadow-md"
            style={{ background: "var(--brand)" }}>
            חזרה לדף הבית
          </Link>
        </div>
      </div>
    );
  }

  // ── Booking form ────────────────────────────────────────────────────────────
  const inputClass = "w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-[14px] text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:border-transparent transition-all";

  return (
    <div className="min-h-screen bg-slate-50 pb-24" dir="rtl">

      {/* Header */}
      <div className="sticky top-0 z-20 bg-white/97 backdrop-blur-md border-b border-slate-200 px-4 py-3"
        style={{ background: "rgba(255,255,255,0.97)" }}>
        <div className="flex items-center gap-3">
          <Link href={`/book/time?staffId=${staffId}&serviceId=${serviceId}`}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 border border-slate-200 flex-shrink-0">
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-[14px] font-bold text-slate-900">אישור תור</h1>
            <p className="text-[11px] text-slate-400">{staffInfo?.name} · {time}</p>
          </div>
          <div className="mr-auto flex items-center gap-1.5">
            {[1,2,3].map(i => (
              <div key={i} className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={{ background: i <= 3 ? "var(--brand)" : "#E2E8F0", color: i <= 3 ? "#fff" : "#94A3B8" }}>
                {i < 3 ? "✓" : "4"}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 pt-5 space-y-3">

        {/* Summary card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 pt-4 pb-2">
            <p className="text-[10px] font-bold tracking-[0.25em] text-slate-400 uppercase">סיכום התור</p>
          </div>
          <SummaryRow label="ספר" value={staffInfo?.name || "..."} />
          <SummaryRow label="שירות" value={serviceInfo?.name || "..."} />
          <SummaryRow label="תאריך" value={dateLabel} />
          <SummaryRow label="שעה" value={<span dir="ltr">{time}</span>} />
          {serviceInfo?.showDuration !== false && (
            <SummaryRow label="משך" value={`${duration} דקות`} />
          )}
          <SummaryRow label="מחיר" value={`₪${price}`} large />
        </div>

        {/* Customer details */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <p className="text-[10px] font-bold tracking-[0.25em] text-slate-400 uppercase mb-4">פרטים אישיים</p>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 block mb-1.5">טלפון</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                disabled={otpVerified} placeholder="050-0000000" dir="ltr"
                className={inputClass + (otpVerified ? " bg-green-50 border-green-300 text-green-700" : "")}
                style={{ "--tw-ring-color": "var(--brand)" } as React.CSSProperties} />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 block mb-1.5">שם מלא</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="השם שלך" className={inputClass}
                style={{ "--tw-ring-color": "var(--brand)" } as React.CSSProperties} />
            </div>
          </div>

          {/* OTP section */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            {!otpVerified ? (
              <>
                {!otpSent ? (
                  <div className="space-y-2">
                    {otpError && <p className="text-[12px] text-red-500">{otpError}</p>}
                    <button onClick={sendOtp} disabled={otpSending || !phone}
                      className="w-full text-[13px] font-bold tracking-[0.1em] py-3 rounded-full border-2 transition-all disabled:opacity-40"
                      style={{ border: `2px solid var(--brand)`, color: "var(--brand)", background: "transparent" }}>
                      {otpSending ? "שולח..." : "📲 שלח קוד אימות ב-WhatsApp"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[12px] text-slate-500 text-center">
                      נשלח קוד ל-<span dir="ltr" className="font-mono font-bold">{phone}</span>
                    </p>
                    {otpError && <p className="text-[12px] text-red-500 text-center">{otpError}</p>}
                    <input type="text" inputMode="numeric" maxLength={6}
                      value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                      placeholder="הזן קוד 6 ספרות" dir="ltr"
                      className={inputClass + " text-center font-mono tracking-[0.3em] text-xl"} />
                    <div className="flex gap-2">
                      <button onClick={verifyOtp} disabled={otpVerifying || otpCode.length < 6}
                        className="flex-1 text-[13px] font-bold tracking-[0.1em] py-3 rounded-full text-white transition-all disabled:opacity-40"
                        style={{ background: "var(--brand)" }}>
                        {otpVerifying ? "מאמת..." : "אמת קוד"}
                      </button>
                      <button onClick={() => { setOtpSent(false); setOtpCode(""); setOtpError(""); }}
                        className="px-4 text-[12px] text-slate-400 hover:text-slate-600 transition">
                        שנה
                      </button>
                    </div>
                    <button onClick={sendOtp} disabled={otpSending}
                      className="w-full text-[11px] text-slate-400 hover:text-slate-600 transition">
                      לא קיבלת? שלח שוב
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 text-green-600">
                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <span className="text-[13px] font-semibold">הטלפון אומת בהצלחה</span>
              </div>
            )}
          </div>
        </div>

        {/* Referral source */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <p className="text-[10px] font-bold tracking-[0.25em] text-slate-400 uppercase mb-3">מאיפה הכרת אותנו?</p>
          <select value={referralSource} onChange={e => { setReferralSource(e.target.value); setReferrerPhone(""); }}
            className={inputClass + " appearance-none"} style={{ WebkitAppearance: "none" }}>
            <option value="">בחר (אופציונלי)</option>
            {referralOptions.map(src => <option key={src} value={src}>{src}</option>)}
          </select>
          {referralSource === "חבר הביא חבר" && (
            <div className="mt-3">
              <label className="text-[11px] font-semibold text-slate-500 block mb-1.5">טלפון החבר שהמליץ</label>
              <input type="tel" value={referrerPhone} onChange={e => setReferrerPhone(e.target.value)}
                placeholder="050-0000000" dir="ltr" className={inputClass} />
              <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                כל 2 חברים שתביא — מוצר במתנה | 3 חברים — תספורת חינם
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-center">
            <p className="text-[13px] text-red-600 font-medium">{error}</p>
          </div>
        )}

        {/* Submit */}
        <button onClick={handleSubmit}
          disabled={submitting || !phone || !name || !otpVerified}
          className="w-full text-[14px] font-bold tracking-[0.15em] uppercase py-4 rounded-full text-white shadow-md transition-all active:scale-[0.99] disabled:opacity-40"
          style={{ background: "var(--brand)" }}>
          {submitting ? "קובע תור..." : "קביעת תור! ✓"}
        </button>

        {!otpVerified && phone && name && (
          <p className="text-center text-[11px] text-slate-400">נדרש אימות טלפון לפני קביעת התור</p>
        )}
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-[10px] tracking-[0.3em] uppercase text-slate-400">טוען...</div>
      </div>
    }>
      <ConfirmPageContent />
    </Suspense>
  );
}
