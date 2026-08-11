"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Schedule = { dayOfWeek: number; isWorking: boolean; slots: string; breaks: string | null };
type StaffMember = { id: string; name: string; settings: string | null; schedules: Schedule[] };
type StaffBookingSettings = { bookingHorizonDays?: number; minBookingLeadMinutes?: number };

type BreakRange = { start: string; end: string };
type DayConfig = { isWorking: boolean; start: string; end: string; breaks: BreakRange[] };

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function defaultDay(dow: number): DayConfig {
  const isFriday = dow === 5; const isSaturday = dow === 6;
  return { isWorking: !isSaturday, start: isFriday ? "08:00" : "09:00", end: isFriday ? "14:00" : "20:00", breaks: [] };
}

function parseSchedule(schedules: Schedule[]): DayConfig[] {
  return Array.from({ length: 7 }, (_, dow) => {
    const s = schedules.find(x => x.dayOfWeek === dow);
    if (!s) return defaultDay(dow);
    let start = "09:00", end = "20:00";
    try { const sl = JSON.parse(s.slots); if (sl[0]) { start = sl[0].start; end = sl[0].end; } } catch { /* ignore */ }
    let breaks: BreakRange[] = [];
    if (s.breaks) { try { const br = JSON.parse(s.breaks); if (Array.isArray(br)) breaks = br; } catch { /* ignore */ } }
    return { isWorking: s.isWorking, start, end, breaks };
  });
}

function StaffScheduleEditor({ staff, onSaved }: { staff: StaffMember; onSaved?: () => void }) {
  const [days, setDays] = useState<DayConfig[]>(() => parseSchedule(staff.schedules));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const initBooking: StaffBookingSettings = (() => {
    try { return staff.settings ? JSON.parse(staff.settings) : {}; } catch { return {}; }
  })();
  const [horizonDays,    setHorizonDays]    = useState<string>(initBooking.bookingHorizonDays    !== undefined ? String(initBooking.bookingHorizonDays)    : "");
  const [leadMins,       setLeadMins]       = useState<string>(initBooking.minBookingLeadMinutes !== undefined ? String(initBooking.minBookingLeadMinutes) : "");
  const [bookingSaving,  setBookingSaving]  = useState(false);
  const [bookingSaved,   setBookingSaved]   = useState(false);

  async function saveBookingSettings() {
    setBookingSaving(true);
    const patch: StaffBookingSettings = {};
    if (horizonDays !== "") patch.bookingHorizonDays    = Number(horizonDays);
    if (leadMins    !== "") patch.minBookingLeadMinutes = Number(leadMins);
    const res = await fetch(`/api/admin/staff/${staff.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settingsPatch: patch }),
    });
    setBookingSaving(false);
    if (!res.ok) { alert("שמירת הגדרות ההזמנה נכשלה. נסה שוב."); return; }
    setBookingSaved(true); setTimeout(() => setBookingSaved(false), 2500);
    onSaved?.();
  }

  function updateDay(dow: number, patch: Partial<DayConfig>) {
    setDays(prev => prev.map((d, i) => i === dow ? { ...d, ...patch } : d));
    setSaved(false);
  }

  function updateBreak(dow: number, bi: number, patch: Partial<BreakRange>) {
    setDays(prev => prev.map((d, i) => i !== dow ? d : {
      ...d, breaks: d.breaks.map((b, j) => j === bi ? { ...b, ...patch } : b),
    }));
    setSaved(false);
  }
  function addBreak(dow: number) {
    setDays(prev => prev.map((d, i) => i === dow ? { ...d, breaks: [...d.breaks, { start: "13:00", end: "14:00" }] } : d));
    setSaved(false);
  }
  function removeBreak(dow: number, bi: number) {
    setDays(prev => prev.map((d, i) => i !== dow ? d : { ...d, breaks: d.breaks.filter((_, j) => j !== bi) }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    const payload = days.map((d, dow) => ({
      dayOfWeek: dow, isWorking: d.isWorking, start: d.start, end: d.end,
      breaks: d.breaks.filter(b => b.start && b.end),
    }));
    const res = await fetch(`/api/admin/staff/${staff.id}/schedule`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) { alert("שמירת שעות העבודה נכשלה. נסה שוב."); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2500);
    onSaved?.();
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-700">{staff.name[0]}</div>
          <span className="font-semibold text-neutral-900">{staff.name}</span>
        </div>
        <button onClick={save} disabled={saving}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${saved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
          {saving ? "שומר..." : saved ? "✓ נשמר" : "שמור"}
        </button>
      </div>

      <div className="divide-y divide-neutral-50">
        {days.map((day, dow) => (
          <div key={dow} className={`px-5 py-3 ${!day.isWorking ? "bg-neutral-50/60" : ""}`}>
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => updateDay(dow, { isWorking: !day.isWorking })}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${day.isWorking ? "bg-teal-600" : "bg-neutral-200"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${day.isWorking ? "right-0.5" : "left-0.5"}`} />
              </button>

              <span className={`text-sm font-medium w-16 shrink-0 ${day.isWorking ? "text-neutral-800" : "text-neutral-400"}`}>{DAY_NAMES[dow]}</span>

              {day.isWorking ? (
                <>
                  <div className="flex items-center gap-2" dir="ltr">
                    <span className="text-xs text-neutral-400">מ</span>
                    <input type="time" dir="ltr" value={day.start} onChange={e => updateDay(dow, { start: e.target.value })}
                      className="border border-neutral-200 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                    <span className="text-xs text-neutral-400">—</span>
                    <input type="time" dir="ltr" value={day.end} onChange={e => updateDay(dow, { end: e.target.value })}
                      className="border border-neutral-200 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                    <span className="text-xs text-neutral-400">עד</span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {day.breaks.map((br, bi) => (
                      <div key={bi} className="flex items-center gap-1.5 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1" dir="ltr">
                        <input type="time" dir="ltr" value={br.start} onChange={e => updateBreak(dow, bi, { start: e.target.value })}
                          className="border border-orange-200 rounded px-1.5 py-0.5 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-orange-300 bg-white" />
                        <span className="text-orange-400 text-xs">—</span>
                        <input type="time" dir="ltr" value={br.end} onChange={e => updateBreak(dow, bi, { end: e.target.value })}
                          className="border border-orange-200 rounded px-1.5 py-0.5 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-orange-300 bg-white" />
                        <button onClick={() => removeBreak(dow, bi)} className="text-red-400 hover:text-red-600 text-xs px-0.5">✕</button>
                      </div>
                    ))}
                    <button onClick={() => addBreak(dow)}
                      className="text-xs px-2.5 py-1 rounded-lg border border-dashed border-neutral-200 text-neutral-400 hover:border-orange-300 hover:text-orange-600 transition">
                      + הפסקה
                    </button>
                  </div>
                </>
              ) : (
                <span className="text-xs text-neutral-400">לא עובד</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-neutral-100 px-5 py-4 bg-neutral-50/40">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-semibold text-neutral-700">📅 הגדרות יומן אישיות</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">ריק = ברירת מחדל של העסק</p>
          </div>
          <button onClick={saveBookingSettings} disabled={bookingSaving}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${bookingSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
            {bookingSaving ? "שומר..." : bookingSaved ? "✓ נשמר" : "שמור"}
          </button>
        </div>
        <div className="flex gap-4 flex-wrap">
          <div>
            <label className="text-[11px] text-neutral-500 block mb-1">ימים קדימה פתוח</label>
            <div className="flex items-center gap-1.5">
              <input type="number" min={1} max={365} value={horizonDays}
                onChange={e => setHorizonDays(e.target.value)}
                placeholder="גלובלי"
                className="w-20 border border-neutral-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-300" />
              <span className="text-xs text-neutral-400">ימים</span>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-neutral-500 block mb-1">מינימום לפני קביעה</label>
            <div className="flex items-center gap-1.5">
              <input type="number" min={0} max={1440} value={leadMins}
                onChange={e => setLeadMins(e.target.value)}
                placeholder="גלובלי"
                className="w-20 border border-neutral-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-300" />
              <span className="text-xs text-neutral-400">דקות</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkingHoursPage() {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);

  const reloadStaff = () =>
    fetch("/api/admin/staff").then(r => r.json()).then(data => { setStaffList(data); setStaffLoading(false); });

  useEffect(() => { reloadStaff(); }, []);

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🗓️ שעות עבודה</h1>
        <p className="text-neutral-500 text-sm mt-1">הגדר שעות עבודה קבועות לכל ספר. לשינויים חד-פעמיים — לחץ על כותרת היום ביומן.</p>
      </div>

      {staffLoading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-4 max-w-xl">
          {staffList.map(staff => (
            <StaffScheduleEditor key={staff.id} staff={staff} onSaved={reloadStaff} />
          ))}
        </div>
      )}
    </div>
  );
}
