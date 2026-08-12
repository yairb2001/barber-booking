"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type BreakRange = { start: string; end: string };
type ScheduleDay = {
  dayOfWeek: number;
  isWorking: boolean;
  start: string;
  end: string;
  breaks: BreakRange[];
};

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function emptySchedule(): ScheduleDay[] {
  return Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    isWorking: i >= 0 && i <= 5,
    start: "09:00",
    end: "20:00",
    breaks: [],
  }));
}

export default function BarberHoursPage() {
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [schedule, setSchedule] = useState(emptySchedule());
  const [schedSaved, setSchedSaved] = useState(false);

  const [horizonDays, setHorizonDays] = useState("");
  const [leadMins, setLeadMins] = useState("");
  const [firstLeadMins, setFirstLeadMins] = useState("");
  const [bookSaved, setBookSaved] = useState(false);

  // Minimum-notice cancellation policy — editable only when the owner set the
  // business-wide switch to "staff" (each barber controls their own).
  const [cancelPolicyMode, setCancelPolicyMode] = useState<"owner" | "staff">("owner");
  const [globalCancelHours, setGlobalCancelHours] = useState(0);
  const [cancelHours, setCancelHours] = useState("");

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/admin/me").then(r => (r.ok ? r.json() : null));
      if (!me?.staffId) { setLoading(false); return; }
      setMyId(me.staffId);
      setCancelPolicyMode(me.cancellationPolicyMode === "staff" ? "staff" : "owner");
      setGlobalCancelHours(me.minCancellationHours ?? 0);

      const data = await fetch(`/api/admin/staff/${me.staffId}`).then(r => r.json());
      if (data) {
        const sched = emptySchedule();
        for (const d of (data.schedules || [])) {
          const slots = JSON.parse(d.slots || "[]");
          const breaks: BreakRange[] = d.breaks ? JSON.parse(d.breaks) : [];
          sched[d.dayOfWeek] = {
            dayOfWeek: d.dayOfWeek,
            isWorking: d.isWorking,
            start: slots[0]?.start || "09:00",
            end: slots[0]?.end || "20:00",
            breaks: Array.isArray(breaks) ? breaks : [],
          };
        }
        setSchedule(sched);
        try {
          const s = data.settings ? JSON.parse(data.settings) : {};
          if (s.bookingHorizonDays !== undefined) setHorizonDays(String(s.bookingHorizonDays));
          if (s.minBookingLeadMinutes !== undefined) setLeadMins(String(s.minBookingLeadMinutes));
          if (s.firstApptLeadMinutes !== undefined) setFirstLeadMins(String(s.firstApptLeadMinutes));
          if (s.minCancellationHours !== undefined) setCancelHours(String(s.minCancellationHours));
        } catch { /* ignore */ }
      }
      setLoading(false);
    })();
  }, []);

  async function saveSchedule() {
    if (!myId) return;
    setSaving(true);
    const res = await fetch(`/api/admin/staff/${myId}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schedule),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "השמירה נכשלה, נסה שוב");
      return;
    }
    setSchedSaved(true);
    setTimeout(() => setSchedSaved(false), 2500);
  }

  async function saveBooking() {
    if (!myId) return;
    setSaving(true);
    const patch: Record<string, number> = {};
    if (horizonDays !== "") patch.bookingHorizonDays = Number(horizonDays);
    if (leadMins !== "") patch.minBookingLeadMinutes = Number(leadMins);
    if (firstLeadMins !== "") patch.firstApptLeadMinutes = Number(firstLeadMins);
    if (cancelPolicyMode === "staff" && cancelHours !== "") patch.minCancellationHours = Number(cancelHours);
    // settingsPatch merges server-side against a fresh read, so a save here
    // can't clobber another setting written from a different screen.
    const res = await fetch(`/api/admin/staff/${myId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settingsPatch: patch }),
    });
    setSaving(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "השמירה נכשלה, נסה שוב");
      return;
    }
    setBookSaved(true);
    setTimeout(() => setBookSaved(false), 2500);
  }

  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <Link href="/admin/barber-settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות שלי</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">📅 שעות ויומן</h1>
        <p className="text-neutral-500 text-sm mt-1">שעות העבודה שלך, הפסקות וזמני הזמנה</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-6 max-w-2xl">
          {/* ── Working hours ── */}
          <div>
            <h2 className="text-sm font-semibold text-neutral-700 mb-3">שעות עבודה קבועות</h2>
            {schedSaved && <div className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">✓ שעות נשמרו</div>}
            <div className="space-y-3">
              {schedule.map((day, i) => (
                <div key={i} className={`bg-white rounded-xl border p-3 ${day.isWorking ? "border-neutral-200" : "border-neutral-100 bg-neutral-50"}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <button
                      onClick={() => { const s = [...schedule]; s[i] = { ...s[i], isWorking: !s[i].isWorking }; setSchedule(s); }}
                      className={`w-10 h-5 rounded-full transition ${day.isWorking ? "bg-emerald-500" : "bg-neutral-300"}`}>
                      <div className={`w-4 h-4 bg-white rounded-full shadow transition mx-0.5 ${day.isWorking ? "translate-x-5" : ""}`} />
                    </button>
                    <span className="font-medium text-sm text-neutral-800">יום {DAY_NAMES[i]}</span>
                  </div>
                  {day.isWorking && (
                    <div className="mt-2 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        {[["start", "התחלה"], ["end", "סיום"]].map(([field, label]) => (
                          <div key={field}>
                            <label className="text-[11px] text-neutral-400 block mb-0.5">{label}</label>
                            <input type="time" value={(day as unknown as Record<string, string>)[field] || ""}
                              onChange={e => {
                                const s = [...schedule];
                                s[i] = { ...s[i], [field]: e.target.value };
                                setSchedule(s);
                              }}
                              className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm" />
                          </div>
                        ))}
                      </div>

                      <div>
                        <label className="text-[11px] text-neutral-400 block mb-1">הפסקות קבועות</label>
                        <div className="space-y-2">
                          {day.breaks.map((br, bi) => (
                            <div key={bi} className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-lg px-2 py-1.5">
                              <input type="time" value={br.start}
                                onChange={e => {
                                  const s = [...schedule];
                                  const breaks = [...s[i].breaks];
                                  breaks[bi] = { ...breaks[bi], start: e.target.value };
                                  s[i] = { ...s[i], breaks };
                                  setSchedule(s);
                                }}
                                className="flex-1 border border-orange-200 rounded px-2 py-1 text-sm" />
                              <span className="text-orange-400 text-xs">–</span>
                              <input type="time" value={br.end}
                                onChange={e => {
                                  const s = [...schedule];
                                  const breaks = [...s[i].breaks];
                                  breaks[bi] = { ...breaks[bi], end: e.target.value };
                                  s[i] = { ...s[i], breaks };
                                  setSchedule(s);
                                }}
                                className="flex-1 border border-orange-200 rounded px-2 py-1 text-sm" />
                              <button onClick={() => {
                                const s = [...schedule];
                                s[i] = { ...s[i], breaks: s[i].breaks.filter((_, j) => j !== bi) };
                                setSchedule(s);
                              }}
                                className="text-red-400 hover:text-red-600 text-sm px-1">✕</button>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => {
                          const s = [...schedule];
                          s[i] = { ...s[i], breaks: [...s[i].breaks, { start: "13:00", end: "14:00" }] };
                          setSchedule(s);
                        }}
                          className="mt-2 w-full border-2 border-dashed border-neutral-200 text-neutral-400 py-1.5 rounded-lg text-xs hover:border-orange-300 hover:text-orange-600 transition">
                          + הוסף הפסקה
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button onClick={saveSchedule} disabled={saving}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold transition mt-4 ${schedSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
              {saving ? "שומר..." : schedSaved ? "✓ נשמר" : "שמור שעות עבודה"}
            </button>
          </div>

          <div className="border-t border-neutral-100" />

          {/* ── Booking settings ── */}
          <div>
            <h2 className="text-sm font-semibold text-neutral-700 mb-1">הגדרות יומן</h2>
            <p className="text-xs text-neutral-400 mb-4">הגדרות אלו מתעדפות על פני ברירות המחדל של העסק.</p>
            {bookSaved && <div className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">✓ הגדרות נשמרו</div>}
            <div className="bg-white border border-neutral-200 rounded-2xl p-4 space-y-4">
              <div>
                <label className="text-sm font-medium text-neutral-700 block mb-1">כמה ימים קדימה פתוח היומן?</label>
                <p className="text-xs text-neutral-400 mb-2">ריק = ברירת מחדל של העסק</p>
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={365} value={horizonDays}
                    onChange={e => setHorizonDays(e.target.value)}
                    placeholder="30"
                    className="w-24 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  <span className="text-sm text-neutral-500">ימים</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-neutral-700 block mb-1">זמן התראה מינימלי לפני תור</label>
                <p className="text-xs text-neutral-400 mb-2">לקוח לא יוכל לקבוע פחות מ-X דקות מעכשיו</p>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} step={15} value={leadMins}
                    onChange={e => setLeadMins(e.target.value)}
                    placeholder="60"
                    className="w-24 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  <span className="text-sm text-neutral-500">דקות</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-neutral-700 block mb-1">זמן מינימלי לתור ראשון של אותו היום</label>
                <p className="text-xs text-neutral-400 mb-2">חל רק כשאין עדיין תורים באותו יום — מונע הזמנת התור הראשון ברגע האחרון</p>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} step={15} value={firstLeadMins}
                    onChange={e => setFirstLeadMins(e.target.value)}
                    placeholder="ברירת מחדל"
                    className="w-24 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  <span className="text-sm text-neutral-500">דקות</span>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-neutral-700 block mb-1">מינימום שעות מראש לביטול/הזזת תור</label>
                {cancelPolicyMode === "staff" ? (
                  <>
                    <p className="text-xs text-neutral-400 mb-2">ריק = ברירת המחדל של העסק ({globalCancelHours} שעות)</p>
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} max={720} value={cancelHours}
                        onChange={e => setCancelHours(e.target.value)}
                        placeholder={String(globalCancelHours)}
                        className="w-24 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                      <span className="text-sm text-neutral-500">שעות</span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-neutral-400">
                    נקבע ע״י המנהל הראשי לכל הצוות: {globalCancelHours === 0 ? "אין הגבלה" : `${globalCancelHours} שעות מראש`}
                  </p>
                )}
              </div>
            </div>
            <button onClick={saveBooking} disabled={saving}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold transition mt-4 ${bookSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
              {saving ? "שומר..." : bookSaved ? "✓ נשמר" : "שמור הגדרות יומן"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
