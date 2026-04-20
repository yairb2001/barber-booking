"use client";

import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
type Business = {
  name: string; phone: string; address: string; about: string;
  logoUrl: string; coverImageUrl: string; brandColor: string;
  socialLinks: { whatsapp?: string; instagram?: string; facebook?: string; waze?: string };
};
type Schedule = { dayOfWeek: number; isWorking: boolean; slots: string; breaks: string | null };
type StaffMember = { id: string; name: string; schedules: Schedule[] };

type DayConfig = { isWorking: boolean; start: string; end: string; hasBreak: boolean; breakStart: string; breakEnd: string };

// ── Defaults ───────────────────────────────────────────────────────────────────
const emptyBusiness: Business = {
  name: "", phone: "", address: "", about: "", logoUrl: "", coverImageUrl: "", brandColor: "#D4AF37", socialLinks: {},
};
const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function defaultDay(dow: number): DayConfig {
  const isFriday = dow === 5; const isSaturday = dow === 6;
  return { isWorking: !isSaturday, start: isFriday ? "08:00" : "09:00", end: isFriday ? "14:00" : "20:00", hasBreak: false, breakStart: "13:00", breakEnd: "14:00" };
}

function parseSchedule(schedules: Schedule[]): DayConfig[] {
  return Array.from({ length: 7 }, (_, dow) => {
    const s = schedules.find(x => x.dayOfWeek === dow);
    if (!s) return defaultDay(dow);
    let start = "09:00", end = "20:00";
    try { const sl = JSON.parse(s.slots); if (sl[0]) { start = sl[0].start; end = sl[0].end; } } catch { /* ignore */ }
    let hasBreak = false, breakStart = "13:00", breakEnd = "14:00";
    if (s.breaks) { try { const br = JSON.parse(s.breaks); if (br[0]) { hasBreak = true; breakStart = br[0].start; breakEnd = br[0].end; } } catch { /* ignore */ } }
    return { isWorking: s.isWorking, start, end, hasBreak, breakStart, breakEnd };
  });
}

// ── Staff Schedule Editor ──────────────────────────────────────────────────────
function StaffScheduleEditor({ staff }: { staff: StaffMember }) {
  const [days, setDays] = useState<DayConfig[]>(() => parseSchedule(staff.schedules));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function updateDay(dow: number, patch: Partial<DayConfig>) {
    setDays(prev => prev.map((d, i) => i === dow ? { ...d, ...patch } : d));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    const payload = days.map((d, dow) => ({
      dayOfWeek: dow, isWorking: d.isWorking, start: d.start, end: d.end,
      ...(d.hasBreak && d.breakStart && d.breakEnd ? { breakStart: d.breakStart, breakEnd: d.breakEnd } : {}),
    }));
    await fetch(`/api/admin/staff/${staff.id}/schedule`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center font-bold text-amber-700">{staff.name[0]}</div>
          <span className="font-semibold text-neutral-900">{staff.name}</span>
        </div>
        <button onClick={save} disabled={saving}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${saved ? "bg-emerald-100 text-emerald-700" : "bg-amber-500 text-neutral-950 hover:bg-amber-400"} disabled:opacity-50`}>
          {saving ? "שומר..." : saved ? "✓ נשמר" : "שמור"}
        </button>
      </div>

      <div className="divide-y divide-neutral-50">
        {days.map((day, dow) => (
          <div key={dow} className={`px-5 py-3 ${!day.isWorking ? "bg-neutral-50/60" : ""}`}>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Toggle */}
              <button onClick={() => updateDay(dow, { isWorking: !day.isWorking })}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${day.isWorking ? "bg-amber-500" : "bg-neutral-200"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${day.isWorking ? "right-0.5" : "left-0.5"}`} />
              </button>

              <span className={`text-sm font-medium w-16 shrink-0 ${day.isWorking ? "text-neutral-800" : "text-neutral-400"}`}>{DAY_NAMES[dow]}</span>

              {day.isWorking ? (
                <>
                  {/* Work hours */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-400">מ</span>
                    <input type="time" value={day.start} onChange={e => updateDay(dow, { start: e.target.value })}
                      className="border border-neutral-200 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-amber-300" />
                    <span className="text-xs text-neutral-400">עד</span>
                    <input type="time" value={day.end} onChange={e => updateDay(dow, { end: e.target.value })}
                      className="border border-neutral-200 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-amber-300" />
                  </div>

                  {/* Break */}
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateDay(dow, { hasBreak: !day.hasBreak })}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition ${day.hasBreak ? "bg-orange-50 border-orange-200 text-orange-700" : "bg-neutral-50 border-neutral-200 text-neutral-400"}`}>
                      הפסקה
                    </button>
                    {day.hasBreak && (
                      <div className="flex items-center gap-2">
                        <input type="time" value={day.breakStart} onChange={e => updateDay(dow, { breakStart: e.target.value })}
                          className="border border-neutral-200 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-amber-300" />
                        <span className="text-xs text-neutral-400">–</span>
                        <input type="time" value={day.breakEnd} onChange={e => updateDay(dow, { breakEnd: e.target.value })}
                          className="border border-neutral-200 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-amber-300" />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <span className="text-xs text-neutral-400">לא עובד</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AdminSettingsPage() {
  const [tab, setTab] = useState<"business" | "hours">("business");
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [form, setForm] = useState<Business>(emptyBusiness);
  const [bizLoading, setBizLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(data => {
      if (data) setForm({ name: data.name || "", phone: data.phone || "", address: data.address || "", about: data.about || "", logoUrl: data.logoUrl || "", coverImageUrl: data.coverImageUrl || "", brandColor: data.brandColor || "#D4AF37", socialLinks: data.socialLinks || {} });
      setBizLoading(false);
    });
    fetch("/api/admin/staff").then(r => r.json()).then(data => { setStaffList(data); setStaffLoading(false); });
  }, []);

  async function saveBiz() {
    setSaving(true);
    await fetch("/api/admin/business", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  function setField<K extends keyof Business>(key: K, value: Business[K]) { setForm(p => ({ ...p, [key]: value })); }
  function setSocial(key: string, value: string) { setForm(p => ({ ...p, socialLinks: { ...p.socialLinks, [key]: value } })); }

  return (
    <div className="p-8 overflow-auto h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">הגדרות</h1>
        <p className="text-neutral-500 text-sm mt-1">ניהול פרטי עסק ושעות עבודה</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-neutral-100 rounded-xl p-1 mb-6 w-fit">
        {[{ key: "business", label: "פרטי עסק" }, { key: "hours", label: "שעות עבודה" }].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key as "business" | "hours")}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === key ? "bg-white shadow text-neutral-900" : "text-neutral-500"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Business tab ── */}
      {tab === "business" && (
        bizLoading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
          <div className="space-y-5 max-w-xl">
            {/* General */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <h2 className="font-semibold text-neutral-800 mb-4">פרטי עסק</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">שם העסק</label>
                  <input value={form.name} onChange={e => setField("name", e.target.value)}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">טלפון</label>
                  <input value={form.phone} onChange={e => setField("phone", e.target.value)} dir="ltr"
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-neutral-500 block mb-1">כתובת</label>
                  <input value={form.address} onChange={e => setField("address", e.target.value)}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-neutral-500 block mb-1">אודות</label>
                  <textarea value={form.about} onChange={e => setField("about", e.target.value)} rows={3}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
                </div>
              </div>
            </div>

            {/* Images */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <h2 className="font-semibold text-neutral-800 mb-4">תמונות ועיצוב</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">קישור לוגו</label>
                  <div className="flex gap-3 items-center">
                    <input value={form.logoUrl} onChange={e => setField("logoUrl", e.target.value)} dir="ltr" placeholder="https://..."
                      className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    {form.logoUrl && <img src={form.logoUrl} alt="logo" className="w-10 h-10 rounded-full object-cover" />}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">קישור תמונת רקע</label>
                  <div className="flex gap-3 items-center">
                    <input value={form.coverImageUrl} onChange={e => setField("coverImageUrl", e.target.value)} dir="ltr" placeholder="https://..."
                      className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    {form.coverImageUrl && <img src={form.coverImageUrl} alt="cover" className="w-16 h-10 rounded-lg object-cover" />}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">צבע מותג</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={form.brandColor} onChange={e => setField("brandColor", e.target.value)}
                      className="w-10 h-10 rounded-lg border border-neutral-200 cursor-pointer" />
                    <span className="text-sm text-neutral-600 font-mono">{form.brandColor}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Social */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <h2 className="font-semibold text-neutral-800 mb-4">רשתות חברתיות</h2>
              <div className="space-y-3">
                {[
                  { key: "whatsapp", label: "WhatsApp", placeholder: "972501234567", icon: "📱" },
                  { key: "instagram", label: "Instagram", placeholder: "dominant_barbershop", icon: "📸" },
                  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/...", icon: "👍" },
                  { key: "waze", label: "Waze", placeholder: "https://waze.com/...", icon: "🗺️" },
                ].map(({ key, label, placeholder, icon }) => (
                  <div key={key}>
                    <label className="text-xs text-neutral-500 block mb-1">{icon} {label}</label>
                    <input value={(form.socialLinks as Record<string, string>)[key] || ""} onChange={e => setSocial(key, e.target.value)} dir="ltr" placeholder={placeholder}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                ))}
              </div>
            </div>

            <button onClick={saveBiz} disabled={saving}
              className={`w-full py-3 rounded-xl text-sm font-semibold transition ${saved ? "bg-emerald-500 text-white" : "bg-amber-500 text-neutral-950 hover:bg-amber-400"} disabled:opacity-50`}>
              {saving ? "שומר..." : saved ? "✓ נשמר!" : "שמור שינויים"}
            </button>
          </div>
        )
      )}

      {/* ── Hours tab ── */}
      {tab === "hours" && (
        staffLoading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
          <div className="space-y-4 max-w-3xl">
            <p className="text-sm text-neutral-500 mb-2">
              הגדר שעות עבודה קבועות לכל ספר. לשינויים חד-פעמיים — לחץ על כותרת היום ביומן.
            </p>
            {staffList.map(staff => (
              <StaffScheduleEditor key={staff.id} staff={staff} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
