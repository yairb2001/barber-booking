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

const REFERRAL_SOURCES = [
  { value: "instagram", label: "אינסטגרם" },
  { value: "facebook", label: "פייסבוק" },
  { value: "tiktok", label: "טיקטוק" },
  { value: "google", label: "גוגל" },
  { value: "friend", label: "חבר הביא חבר" },
  { value: "walk_in", label: "הגעתי מהרחוב" },
  { value: "other", label: "אחר" },
];

function ConfirmPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const staffId = searchParams.get("staffId") || "";
  const serviceId = searchParams.get("serviceId") || "";
  const date = searchParams.get("date") || "";
  const time = searchParams.get("time") || "";

  const [staffInfo, setStaffInfo] = useState<StaffInfo | null>(null);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Fetch staff info
    fetch("/api/staff")
      .then((res) => res.json())
      .then((data) => {
        const found = data.find((s: StaffInfo) => s.id === staffId);
        if (found) setStaffInfo(found);
      });

    // Fetch service info
    if (staffId) {
      fetch(`/api/services?staffId=${staffId}`)
        .then((res) => res.json())
        .then((data) => {
          const found = data.find((s: ServiceInfo) => s.id === serviceId);
          if (found) setServiceInfo(found);
        });
    }
  }, [staffId, serviceId]);

  const dateObj = date ? new Date(date + "T00:00:00") : null;
  const dateLabel = dateObj
    ? dateObj.toLocaleDateString("he-IL", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : "";

  const price = serviceInfo
    ? serviceInfo.customPrice ?? serviceInfo.price
    : 0;
  const duration = serviceInfo
    ? serviceInfo.customDuration ?? serviceInfo.durationMinutes
    : 0;

  const handleSubmit = async () => {
    if (!phone || !name) {
      setError("נא למלא טלפון ושם");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId,
          serviceId,
          date,
          startTime: time,
          customerPhone: phone,
          customerName: name,
          referralSource: referralSource || undefined,
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
        `/book/confirm?success=true&appointmentId=${appointment.id}&staffName=${encodeURIComponent(appointment.staff.name)}&serviceName=${encodeURIComponent(appointment.service.name)}&date=${date}&time=${time}&price=${price}`
      );
    } catch {
      setError("שגיאה בחיבור לשרת");
      setSubmitting(false);
    }
  };

  // Success screen
  const isSuccess = searchParams.get("success") === "true";
  if (isSuccess) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center">
          <div className="text-6xl mb-4">✂️</div>
          <h1 className="text-2xl font-bold text-amber-400 mb-2">
            התור נקבע בהצלחה!
          </h1>
          <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800 mt-4 text-right">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-400">ספר</span>
                <span>{searchParams.get("staffName")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">שירות</span>
                <span>{searchParams.get("serviceName")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">תאריך</span>
                <span>{dateLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">שעה</span>
                <span>{time}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">מחיר</span>
                <span className="text-amber-400 font-bold">
                  ₪{searchParams.get("price")}
                </span>
              </div>
            </div>
          </div>

          <Link
            href="/"
            className="block mt-6 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold py-3 px-8 rounded-xl transition"
          >
            חזרה לדף הבית
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-neutral-950/90 backdrop-blur border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/book/time?staffId=${staffId}&serviceId=${serviceId}`}
            className="text-neutral-400 hover:text-white text-xl"
          >
            ←
          </Link>
          <h1 className="text-lg font-semibold">אישור תור</h1>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Appointment Summary */}
        <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
          <h2 className="text-amber-400 font-semibold mb-3">סיכום התור</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-neutral-400">ספר</span>
              <span>{staffInfo?.name || "..."}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">שירות</span>
              <span>{serviceInfo?.name || "..."}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">תאריך</span>
              <span>{dateLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">שעה</span>
              <span>{time}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">משך</span>
              <span>{duration} דקות</span>
            </div>
            <div className="flex justify-between border-t border-neutral-800 pt-2 mt-2">
              <span className="text-neutral-400">מחיר</span>
              <span className="text-amber-400 font-bold text-lg">₪{price}</span>
            </div>
          </div>
        </div>

        {/* Customer Details */}
        <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
          <h2 className="text-amber-400 font-semibold mb-3">פרטים שלך</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-neutral-400 block mb-1">
                טלפון
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="050-0000000"
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-amber-500"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-sm text-neutral-400 block mb-1">שם</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="השם שלך"
                className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
        </div>

        {/* Referral Source */}
        <div className="bg-neutral-900 rounded-xl p-4 border border-neutral-800">
          <h2 className="text-amber-400 font-semibold mb-3">
            מאיפה הכרת אותנו?
          </h2>
          <select
            value={referralSource}
            onChange={(e) => setReferralSource(e.target.value)}
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-amber-500"
          >
            <option value="">בחר (אופציונלי)</option>
            {REFERRAL_SOURCES.map((src) => (
              <option key={src.value} value={src.value}>
                {src.label}
              </option>
            ))}
          </select>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={submitting || !phone || !name}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-neutral-700 disabled:text-neutral-500 text-neutral-950 font-bold py-4 rounded-xl text-lg transition"
        >
          {submitting ? "קובע תור..." : "קביעת תור!"}
        </button>
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-neutral-400">טוען...</div>}>
      <ConfirmPageContent />
    </Suspense>
  );
}
