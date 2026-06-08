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

// ── Add to calendar (Google + Apple/.ics) ─────────────────────────────────────
function AddToCalendar({
  title, staffName, serviceName, date, time, durationMin, location,
}: {
  title: string; staffName: string; serviceName: string;
  date: string; time: string; durationMin: number; location: string;
}) {
  // Build tz-safe wall-clock timestamps from the appointment strings (no Date()
  // parsing → no device-timezone drift). Times are Israel local; we tag the
  // event with TZID=Asia/Jerusalem so it lands correctly on any device.
  if (!date || !time) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const [y, mo, d] = date.split("-");
  const [hh, mm] = time.split(":").map(Number);
  const startMin = hh * 60 + mm;
  const endMin = startMin + (durationMin || 30);
  const startStr = `${y}${mo}${d}T${pad(hh)}${pad(mm)}00`;
  const endStr = `${y}${mo}${d}T${pad(Math.floor(endMin / 60) % 24)}${pad(endMin % 60)}00`;

  const detailParts = [
    serviceName && `שירות: ${serviceName}`,
    staffName && `ספר: ${staffName}`,
  ].filter(Boolean) as string[];
  const details = detailParts.join("\n");

  const googleUrl =
    `https://calendar.google.com/calendar/render?action=TEMPLATE` +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${startStr}/${endStr}` +
    `&details=${encodeURIComponent(details)}` +
    `&location=${encodeURIComponent(location || "")}` +
    `&ctz=Asia/Jerusalem`;

  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DOMINANT//Booking//HE",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${startStr}-${Math.random().toString(36).slice(2)}@dominant`,
    `DTSTAMP:${startStr}`,
    `DTSTART;TZID=Asia/Jerusalem:${startStr}`,
    `DTEND;TZID=Asia/Jerusalem:${endStr}`,
    `SUMMARY:${title.replace(/\n/g, " ")}`,
    `DESCRIPTION:${details.replace(/\n/g, "\\n")}`,
    `LOCATION:${(location || "").replace(/\n/g, " ")}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:תזכורת לתור",
    "END:VALARM", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const icsHref = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">📅</span>
        <p className="text-[13px] font-bold text-slate-800">הוסף את התור ליומן</p>
      </div>
      <div className="flex gap-2">
        <a href={googleUrl} target="_blank" rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-700 text-[12px] font-bold text-center py-2.5 rounded-xl active:bg-slate-100">
          <span>🟢</span> Google
        </a>
        <a href={icsHref} download="appointment.ics"
          className="flex-1 flex items-center justify-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-700 text-[12px] font-bold text-center py-2.5 rounded-xl active:bg-slate-100">
          <span>🍎</span> Apple / אחר
        </a>
      </div>
    </div>
  );
}

// ── App teaser — shown after booking only when store links exist ───────────────
function AppTeaser({ appStoreUrl, playStoreUrl }: { appStoreUrl?: string; playStoreUrl?: string }) {
  const hasLinks = !!(appStoreUrl || playStoreUrl);
  return (
    <div className="rounded-2xl p-5 text-white" style={{ background: "linear-gradient(135deg, #0d4f4a 0%, #0f766e 100%)" }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">📱</span>
        <p className="text-[14px] font-bold text-white">
          {hasLinks ? "הורד את האפליקציה שלנו" : "האפליקציה שלנו — בקרוב"}
        </p>
      </div>
      <p className="text-[12px] text-teal-100 leading-relaxed mb-1">
        ✓ לא תצטרך להזין קוד אימות בכל פעם
      </p>
      <p className="text-[12px] text-teal-100 leading-relaxed mb-1">
        ✓ ראה תורים עתידיים ועדכונים בזמן אמת
      </p>
      <p className="text-[12px] text-teal-100 leading-relaxed mb-4">
        ✓ תוכנית חבר מביא חבר — כל 3 חברים = תספורת חינם
      </p>
      {hasLinks ? (
        <div className="flex gap-2">
          {appStoreUrl && (
            <a href={appStoreUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 bg-white text-teal-800 text-[12px] font-bold tracking-wide text-center py-2.5 rounded-xl">
              🍎 App Store
            </a>
          )}
          {playStoreUrl && (
            <a href={playStoreUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 bg-white text-teal-800 text-[12px] font-bold tracking-wide text-center py-2.5 rounded-xl">
              🤖 Google Play
            </a>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2.5">
          <span className="text-teal-200 text-[12px]">🔔</span>
          <span className="text-teal-100 text-[12px]">נדעיל אותך כשהאפליקציה עולה לאוויר</span>
        </div>
      )}
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

// ── Returning-referrer thank-you + progress meter ──────────────────────────────
function ReferralThankYou({ status }: { status: { name: string; referralCount: number; goal: number; giftLabel: string } }) {
  const first = status.name.split(" ")[0];
  const reached = status.referralCount >= status.goal;
  const shown = Math.min(status.referralCount, status.goal);
  const pct = Math.min(100, Math.round((status.referralCount / Math.max(1, status.goal)) * 100));
  const remaining = Math.max(0, status.goal - status.referralCount);
  return (
    <div className="rounded-2xl p-5 text-white shadow-md" style={{ background: "linear-gradient(135deg, #0d4f4a 0%, #0f766e 100%)" }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xl">🙌</span>
        <p className="text-[15px] font-bold text-white">תודה {first}!</p>
      </div>
      <p className="text-[12px] text-teal-100 leading-relaxed mb-3">
        {reached
          ? `הבאת ${status.referralCount} חברים — מגיעה לך ${status.giftLabel}! 🎁`
          : `כבר הבאת לנו ${status.referralCount} ${status.referralCount === 1 ? "חבר" : "חברים"} — אנחנו מעריכים אותך מאוד 🤩`}
      </p>

      {/* Progress meter */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-teal-100">
          {reached ? "🎉 הגעת ליעד!" : `עוד ${remaining} ${remaining === 1 ? "חבר" : "חברים"} ל${status.giftLabel}`}
        </span>
        <span className="text-[13px] font-extrabold text-white" dir="ltr">{shown}/{status.goal}</span>
      </div>
      <div className="h-2.5 rounded-full bg-white/20 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: reached ? "#fbbf24" : "#5eead4" }} />
      </div>
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
  const [note, setNote]               = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [referrerPhone, setReferrerPhone]   = useState(""); // kept for legacy / manual entry
  const [referrerId, setReferrerId]         = useState(""); // customer ID from autocomplete
  const [referrerName, setReferrerName]     = useState(""); // display name once selected
  const [referrerQuery, setReferrerQuery]   = useState(""); // search input
  const [referrerSuggestions, setReferrerSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [referralOptions, setReferralOptions] = useState<string[]>([]);
  // Referral program config (owner can disable the whole thing).
  const [referralProgram, setReferralProgram] = useState<{ enabled: boolean; goal: number; giftLabel: string }>({ enabled: true, goal: 3, giftLabel: "תספורת חינם" });
  // Returning referrer: their thank-you + progress meter.
  const [referralStatus, setReferralStatus] = useState<{ name: string; referralCount: number; goal: number; giftLabel: string } | null>(null);
  // True once the system already knows how this returning customer found us →
  // we hide the "how did you hear about us?" question.
  const [referralKnown, setReferralKnown] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState("");

  const [otpSent,      setOtpSent]      = useState(false);
  const [otpCode,      setOtpCode]      = useState("");
  const [otpVerified,  setOtpVerified]  = useState(false);
  const [otpToken,     setOtpToken]     = useState("");
  const [otpSending,   setOtpSending]   = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError,     setOtpError]     = useState("");
  const [autoVerified, setAutoVerified] = useState(false); // true = session cookie did the work

  const [businessId,   setBusinessId]   = useState("");
  const [appStoreUrl,  setAppStoreUrl]  = useState("");
  const [playStoreUrl, setPlayStoreUrl] = useState("");
  const [businessName,    setBusinessName]    = useState("");
  const [businessAddress, setBusinessAddress] = useState("");

  // Autocomplete: search customers as user types referrer name
  useEffect(() => {
    if (referrerQuery.length < 2) { setReferrerSuggestions([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/customers/lookup?q=${encodeURIComponent(referrerQuery)}`)
        .then(r => r.json())
        .then(setReferrerSuggestions)
        .catch(() => setReferrerSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [referrerQuery]);

  useEffect(() => {
    fetch("/api/referral-sources").then(r => r.json()).then(setReferralOptions).catch(() => {});
    fetch("/api/business").then(r => r.json()).then(biz => {
      if (biz?.id) setBusinessId(biz.id);
      if (biz?.name) setBusinessName(biz.name);
      if (biz?.address) setBusinessAddress(biz.address);
      try {
        const s = typeof biz?.settings === "string" ? JSON.parse(biz.settings) : (biz?.settings || {});
        if (s.appStoreUrl)  setAppStoreUrl(s.appStoreUrl);
        if (s.playStoreUrl) setPlayStoreUrl(s.playStoreUrl);
        setReferralProgram({
          enabled: s.referralProgramEnabled !== false,
          goal: Number(s.referralGoal) > 0 ? Math.round(Number(s.referralGoal)) : 3,
          giftLabel: (typeof s.referralGiftLabel === "string" && s.referralGiftLabel.trim()) ? s.referralGiftLabel.trim() : "תספורת חינם",
        });
      } catch { /* ignore */ }
    }).catch(() => {});

    // Returning referrer — show a thank-you + progress meter (identity via cookie)
    fetch("/api/customers/referral-status")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.ok && data.referralCount > 0) {
          setReferralStatus({ name: data.name, referralCount: data.referralCount, goal: data.goal, giftLabel: data.giftLabel });
        }
      })
      .catch(() => {});

    // ── Returning customer: pre-fill name/phone + auto-skip OTP ─────────────
    try {
      const saved = JSON.parse(localStorage.getItem("bk_customer") || "null");
      if (saved?.name)  setName(saved.name);
      if (saved?.phone) setPhone(saved.phone);
    } catch { /* ignore parse errors */ }

    // Try to exchange the session cookie for a fresh OTP token (no SMS needed)
    fetch("/api/otp/auto-token", { method: "POST" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.ok && data.token) {
          setOtpVerified(true);
          setOtpToken(data.token);
          setAutoVerified(true);
          // Pre-fill phone from session if localStorage didn't have it
          if (data.phone) setPhone(prev => prev || data.phone);
          // Phone is the identity → always use the originally registered name,
          // overriding whatever may be in localStorage.
          if (data.name) {
            setName(data.name);
            try { localStorage.setItem("bk_customer", JSON.stringify({ name: data.name, phone: data.phone || "" })); } catch { /* ignore */ }
          }
          // We already know how this customer found us → skip the question
          if (data.referralSource) {
            setReferralSource(data.referralSource);
            setReferralKnown(true);
          }
        }
      })
      .catch(() => { /* no session — normal OTP flow */ });
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
      else {
        setOtpVerified(true);
        setOtpToken(data.token);
        setOtpError("");
        // Phone is the identity. If this customer already exists, keep the name
        // they first registered with (ignore a different name typed now).
        const finalName = data.customerName || name;
        if (data.customerName) setName(data.customerName);
        // Save for future visits — cookie is set server-side, name goes to localStorage
        try { localStorage.setItem("bk_customer", JSON.stringify({ name: finalName, phone })); } catch { /* ignore */ }
      }
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
          referrerId:    (referralSource === "חבר הביא חבר" && referrerId)    ? referrerId    : undefined,
          referrerPhone: (referralSource === "חבר הביא חבר" && !referrerId && referrerPhone) ? referrerPhone : undefined,
          note: note.trim() || undefined,
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
      // Persist customer details for future bookings
      try { localStorage.setItem("bk_customer", JSON.stringify({ name, phone })); } catch { /* ignore */ }
      router.push(
        `/book/confirm?success=true&appointmentId=${appointment.id}` +
        `&staffId=${staffId}&serviceId=${serviceId}` +
        `&staffName=${encodeURIComponent(appointment.staff.name)}` +
        `&serviceName=${encodeURIComponent(appointment.service.name)}` +
        `&date=${date}&time=${time}&price=${price}&duration=${duration}` +
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

          <AddToCalendar
            title={`תור${businessName ? ` ב${businessName}` : ""}`}
            staffName={searchParams.get("staffName") || ""}
            serviceName={searchParams.get("serviceName") || ""}
            date={successDate}
            time={successTime}
            durationMin={Number(searchParams.get("duration")) || 30}
            location={businessAddress}
          />

          {/* App download teaser — only when real store links are configured */}
          {(appStoreUrl || playStoreUrl) && (
            <AppTeaser appStoreUrl={appStoreUrl} playStoreUrl={playStoreUrl} />
          )}

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

        {/* Returning referrer — thank-you + progress meter */}
        {referralStatus && <ReferralThankYou status={referralStatus} />}

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
            <div>
              <label className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                הערה לתור <span className="text-slate-300 font-normal">(אופציונלי)</span>
              </label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                placeholder="משהו שכדאי שהספר ידע? (לדוגמה: תספורת לאירוע)"
                className={inputClass + " resize-none"}
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
                    <input type="text" inputMode="numeric" maxLength={4}
                      value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g,"").slice(0,4))}
                      placeholder="הזן קוד 4 ספרות" dir="ltr"
                      className={inputClass + " text-center font-mono tracking-[0.3em] text-xl"} />
                    <div className="flex gap-2">
                      <button onClick={verifyOtp} disabled={otpVerifying || otpCode.length < 4}
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-green-600">
                  <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <span className="text-[13px] font-semibold">
                    {autoVerified ? `ברוך הבא חזרה, ${name || ""}! ✨` : "הטלפון אומת בהצלחה"}
                  </span>
                </div>
                {autoVerified && (
                  <button
                    onClick={() => {
                      setOtpVerified(false); setOtpToken(""); setAutoVerified(false);
                      setPhone(""); setName(""); setOtpSent(false); setOtpCode("");
                      try { localStorage.removeItem("bk_customer"); } catch { /* ignore */ }
                      // Clear session cookie
                      fetch("/api/otp/clear-session", { method: "POST" }).catch(() => {});
                    }}
                    className="text-[11px] text-slate-400 hover:text-slate-600 underline transition">
                    לא אתה?
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Referral source — hidden once we already know how the customer found us */}
        {!referralKnown && (
        <div className="rounded-2xl border-2 border-teal-400 shadow-sm p-5"
          style={{ background: "linear-gradient(135deg, #f0fdfa 0%, #fff 100%)" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">🤝</span>
            <div>
              <p className="text-[13px] font-bold text-teal-800">מאיפה הכרת אותנו?</p>
              <p className="text-[11px] text-teal-600">עוזר לנו להתפתח — לוקח שנייה!</p>
            </div>
          </div>
          <select
            value={referralSource}
            onChange={e => {
              setReferralSource(e.target.value);
              setReferrerPhone(""); setReferrerId(""); setReferrerName(""); setReferrerQuery(""); setReferrerSuggestions([]);
            }}
            className={inputClass + " appearance-none border-teal-200 focus:ring-teal-400"}
            style={{ WebkitAppearance: "none" }}
          >
            <option value="">בחר...</option>
            {referralOptions.map(src => <option key={src} value={src}>{src}</option>)}
          </select>

          {referralSource === "חבר הביא חבר" && referralProgram.enabled && (
            <div className="mt-3 space-y-2">
              <label className="text-[12px] font-bold text-teal-800 block">
                מי זה החבר? <span className="font-medium text-teal-600">(אנחנו נדאג לפרגן לו 🎁)</span>
              </label>

              {referrerId ? (
                /* Selected referrer */
                <div className="flex items-center gap-2 bg-teal-50 border border-teal-300 rounded-xl px-4 py-2.5">
                  <span className="text-teal-600 text-sm flex-1 font-medium">{referrerName}</span>
                  <button
                    type="button"
                    onClick={() => { setReferrerId(""); setReferrerName(""); setReferrerQuery(""); }}
                    className="text-teal-400 hover:text-teal-600 text-xs"
                  >
                    ✕ שנה
                  </button>
                </div>
              ) : (
                /* Autocomplete search — names only, no phone numbers */
                <div className="relative">
                  <input
                    type="text"
                    value={referrerQuery}
                    onChange={e => setReferrerQuery(e.target.value)}
                    placeholder="הקלד את שם החבר..."
                    className={inputClass + " border-teal-200"}
                  />
                  {referrerSuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-teal-200 rounded-xl shadow-lg overflow-hidden">
                      {referrerSuggestions.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setReferrerId(s.id);
                            setReferrerName(s.name);
                            setReferrerQuery(s.name);
                            setReferrerSuggestions([]);
                          }}
                          className="w-full text-right px-4 py-2.5 hover:bg-teal-50 border-b border-slate-50 last:border-0 transition-colors"
                        >
                          <span className="text-[13px] font-medium text-slate-800">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {referrerQuery.length >= 2 && referrerSuggestions.length === 0 && (
                    <p className="text-[11px] text-slate-400 mt-1">לא נמצא — אפשר להשאיר ריק</p>
                  )}
                </div>
              )}

              <p className="text-[11px] text-teal-600 leading-relaxed font-medium">
                🎁 כל {referralProgram.goal} חברים שהוא מביא — {referralProgram.giftLabel} עליו!
              </p>
            </div>
          )}
        </div>
        )}

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
