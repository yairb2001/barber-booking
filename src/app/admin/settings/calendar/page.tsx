"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Mirrors formatCancellationPolicyMessage in src/lib/cancellation-policy.ts (kept
// separate — that module imports prisma and can't be pulled into a client bundle).
function formatCancellationPolicyPreview(hours: number): string {
  if (hours <= 0) return "";
  return `מינימום לביטול: ${hours} שעות מראש. ביטול בפחות מהזמן הזה יחויב במחיר המלא.`;
}

export default function CalendarBookingPage() {
  const [loading, setLoading] = useState(true);

  const [bookingHorizonDays, setBookingHorizonDays] = useState(30);
  const [minBookingLeadMinutes, setMinBookingLeadMinutes] = useState(0);
  const [firstApptLeadMinutes, setFirstApptLeadMinutes] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [calStartHour, setCalStartHour] = useState(8);
  const [calEndHour, setCalEndHour] = useState(21);
  const [calHoursSaving, setCalHoursSaving] = useState(false);
  const [calHoursSaved, setCalHoursSaved] = useState(false);

  // Cancellation policy — lives here (not under permissions) because it's a
  // booking-calendar rule the owner reasons about alongside lead times.
  const [cancellationPolicyMode, setCancellationPolicyMode] = useState<"owner" | "staff">("owner");
  const [minCancellationHours, setMinCancellationHours] = useState(0);
  const [cancellationPolicyText, setCancellationPolicyText] = useState("");
  const [policySaving, setPolicySaving] = useState(false);
  const [policySaved, setPolicySaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(data => {
      if (data) {
        setBookingHorizonDays(data.bookingHorizonDays ?? 30);
        setMinBookingLeadMinutes(data.minBookingLeadMinutes ?? 0);
        setFirstApptLeadMinutes(data.firstApptLeadMinutes ?? 0);
        setCancellationPolicyMode(data.cancellationPolicyMode === "staff" ? "staff" : "owner");
        setMinCancellationHours(data.minCancellationHours ?? 0);
        setCancellationPolicyText(data.cancellationPolicyText || "");
        const s = data.settings || {};
        if (typeof s.calendarStartHour === "number") setCalStartHour(s.calendarStartHour);
        if (typeof s.calendarEndHour === "number") setCalEndHour(s.calendarEndHour);
      }
      setLoading(false);
    });
  }, []);

  async function savePolicy() {
    setPolicySaving(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancellationPolicyMode, minCancellationHours, cancellationPolicyText }),
    });
    setPolicySaving(false);
    setPolicySaved(true);
    setTimeout(() => setPolicySaved(false), 2500);
  }

  async function save() {
    setSaving(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingHorizonDays, minBookingLeadMinutes, firstApptLeadMinutes }),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  async function saveCalendarHours() {
    setCalHoursSaving(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settingsPatch: { calendarStartHour: calStartHour, calendarEndHour: calEndHour } }),
    });
    setCalHoursSaving(false);
    setCalHoursSaved(true);
    setTimeout(() => setCalHoursSaved(false), 2000);
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">📅 יומן ותורים</h1>
        <p className="text-neutral-500 text-sm mt-1">טווח הזמנה, זמן מינימום מראש, שעות תצוגה ומדיניות ביטולים</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-5 max-w-xl">
          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <h2 className="font-semibold text-neutral-800 mb-4">יומן ותורים</h2>
            <div className="space-y-5">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">כמה ימים קדימה היומן פתוח</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min={1} max={365}
                    value={bookingHorizonDays}
                    onChange={e => setBookingHorizonDays(Number(e.target.value))}
                    className="w-24 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                  <span className="text-sm text-neutral-500">ימים</span>
                </div>
                <p className="text-xs text-neutral-400 mt-1">
                  לקוחות יכולים לקבוע תור עד {bookingHorizonDays} ימים מהיום (ברירת מחדל: 30)
                </p>
              </div>

              <div>
                <label className="text-xs text-neutral-500 block mb-1">זמן מינימלי מעכשיו לקביעת תור</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min={0} max={1440}
                    value={minBookingLeadMinutes}
                    onChange={e => setMinBookingLeadMinutes(Number(e.target.value))}
                    className="w-24 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                  <span className="text-sm text-neutral-500">דקות</span>
                </div>
                <p className="text-xs text-neutral-400 mt-1">
                  {minBookingLeadMinutes === 0
                    ? "לקוחות יכולים לקבוע תור ״מעכשיו לעכשיו״"
                    : `לקוחות לא יוכלו לקבוע תור פחות מ-${minBookingLeadMinutes} דקות מעכשיו`}
                </p>
              </div>

              <div>
                <label className="text-xs text-neutral-500 block mb-1">זמן מינימלי לתור ראשון של אותו היום</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min={0} max={1440}
                    value={firstApptLeadMinutes}
                    onChange={e => setFirstApptLeadMinutes(Number(e.target.value))}
                    className="w-24 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                  <span className="text-sm text-neutral-500">דקות</span>
                </div>
                <p className="text-xs text-neutral-400 mt-1">
                  {firstApptLeadMinutes === 0
                    ? "אין הגבלה מיוחדת לתור הראשון של היום"
                    : `כשאין עדיין תורים באותו יום, לא ניתן לקבוע את התור הראשון פחות מ-${firstApptLeadMinutes} דקות מעכשיו`}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold text-neutral-800">שעות תצוגת יומן</h2>
                <p className="text-xs text-neutral-400 mt-0.5">טווח השעות המוצג ביומן הניהול</p>
              </div>
              <button onClick={saveCalendarHours} disabled={calHoursSaving || calStartHour >= calEndHour}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${calHoursSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
                {calHoursSaving ? "שומר..." : calHoursSaved ? "✓ נשמר" : "שמור"}
              </button>
            </div>
            <div className="flex items-center gap-4 flex-wrap" dir="ltr">
              <div>
                <label className="text-xs text-neutral-500 block mb-1 text-right">שעת התחלה</label>
                <select value={calStartHour} onChange={e => setCalStartHour(Number(e.target.value))}
                  className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400">
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{String(i).padStart(2,"0")}:00</option>
                  ))}
                </select>
              </div>
              <span className="text-neutral-400 text-lg mt-4">→</span>
              <div>
                <label className="text-xs text-neutral-500 block mb-1 text-right">שעת סיום</label>
                <select value={calEndHour} onChange={e => setCalEndHour(Number(e.target.value))}
                  className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400">
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i} disabled={i <= calStartHour}>{String(i).padStart(2,"0")}:00</option>
                  ))}
                </select>
              </div>
            </div>
            {calStartHour >= calEndHour && (
              <p className="text-xs text-red-500 mt-2">⚠️ שעת הסיום חייבת להיות אחרי שעת ההתחלה</p>
            )}
          </div>

          <button onClick={save} disabled={saving}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition ${saved ? "bg-emerald-500 text-white" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
            {saving ? "שומר..." : saved ? "✓ נשמר!" : "שמור שינויים"}
          </button>

          {/* Cancellation policy */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-neutral-800">מדיניות ביטולים</h2>
              <button onClick={savePolicy} disabled={policySaving}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${policySaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
                {policySaving ? "שומר..." : policySaved ? "✓ נשמר" : "שמור"}
              </button>
            </div>
            <p className="text-xs text-neutral-400 mb-4">מינימום שעות מראש שבהן לקוח עדיין יכול לבטל/להזיז תור — גם בוואטסאפ וגם באתר. מתחת לסף, הביטול/ההזזה חסומים לגמרי.</p>

            <div className="flex items-start gap-3 mb-4">
              <button
                onClick={() => setCancellationPolicyMode(m => m === "staff" ? "owner" : "staff")}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${cancellationPolicyMode === "staff" ? "bg-teal-500" : "bg-neutral-200"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${cancellationPolicyMode === "staff" ? "right-0.5" : "left-0.5"}`} />
              </button>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-800">כל ספר קובע את הסף שלו</p>
                <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                  {cancellationPolicyMode === "staff"
                    ? "כל ספר קובע בהגדרות שלו כמה שעות מראש נדרשות. מי שלא הגדיר — הערך הכללי למטה חל עליו."
                    : "אתה כמנהל ראשי קובע ערך אחד שחל על כל הצוות. הספרים לא יכולים לשנות אותו."}
                </p>
              </div>
            </div>

            <label className="text-xs text-neutral-500 block mb-1">
              {cancellationPolicyMode === "staff" ? "ערך כללי (ברירת מחדל למי שלא הגדיר לעצמו)" : "מספר שעות מראש"}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number" min={0} max={720}
                value={minCancellationHours}
                onChange={e => setMinCancellationHours(Number(e.target.value))}
                className="w-24 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              <span className="text-sm text-neutral-500">שעות</span>
            </div>
            <p className="text-xs text-neutral-400 mt-1">
              {minCancellationHours === 0
                ? "אין הגבלה — לקוחות יכולים לבטל/להזיז עד רגע לפני."
                : `לקוחות לא יוכלו לבטל/להזיז תור בפחות מ-${minCancellationHours} שעות מראש.`}
            </p>
            {minCancellationHours > 0 && (
              <p className="text-xs text-neutral-400 mt-1">
                חריג: אם לקוח קבע תור כשכבר היו פחות מ-{minCancellationHours} שעות עד המועד (הזמנה של רגע אחרון) — הוא עדיין יוכל לבטל אותו, כי לא הייתה לו אפשרות לתת התראה מראש.
              </p>
            )}

            <div className="mt-5 pt-5 border-t border-neutral-100">
              <label className="text-xs text-neutral-500 block mb-1">הודעה ללקוח (מוצגת במסך &quot;התורים שלי&quot; ובמסך אישור הקביעה)</label>
              <textarea
                value={cancellationPolicyText}
                onChange={e => setCancellationPolicyText(e.target.value)}
                placeholder={formatCancellationPolicyPreview(minCancellationHours)}
                rows={2}
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
              <p className="text-xs text-neutral-400 mt-1">
                ריק = הודעה אוטומטית: {formatCancellationPolicyPreview(minCancellationHours) || "(לא מוצג — אין הגבלה)"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
