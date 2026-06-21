"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type StaffInfo = {
  id: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  settings: string | null;
  canViewAllCalendars: boolean;
  canViewAllChats: boolean;
  schedules: { dayOfWeek: number; isWorking: boolean; slots: string; breaks: string | null }[];
};

type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  enabled: boolean;
  owned: boolean;
  customPrice: number | null;
  customDuration: number | null;
  customName: string | null;
  customNote: string | null;
};

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

type BreakRange = { start: string; end: string };
type ScheduleDay = {
  dayOfWeek: number;
  isWorking: boolean;
  start: string;
  end: string;
  breaks: BreakRange[];
};

function emptySchedule(): ScheduleDay[] {
  return Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    isWorking: i >= 0 && i <= 5,
    start: "09:00",
    end: "20:00",
    breaks: [],
  }));
}

export default function StaffSettingsPage() {
  const { id } = useParams<{ id: string }>();

  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [activeTab, setActiveTab] = useState<"services" | "schedule" | "booking" | "permissions" | "password">("services");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Services
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [editingService, setEditingService] = useState<string | null>(null);
  const [customPrice, setCustomPrice] = useState("");
  const [customDuration, setCustomDuration] = useState("");
  const [customName, setCustomName] = useState("");
  const [customNote, setCustomNote] = useState("");
  // Own-service management (barber's private services)
  const [canManageOwn, setCanManageOwn] = useState(false);
  const [ownForm, setOwnForm] = useState<{ id: string | null; name: string; description: string; price: string; durationMinutes: string } | null>(null);

  // Schedule
  const [schedule, setSchedule] = useState(emptySchedule());
  const [scheduleSaved, setScheduleSaved] = useState(false);

  // Password change
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [passSaved, setPassSaved] = useState(false);
  const [passError, setPassError] = useState("");

  // Booking settings (per-staff)
  const [horizonDays, setHorizonDays] = useState("");
  const [leadMins, setLeadMins] = useState("");
  const [firstLeadMins, setFirstLeadMins] = useState("");
  const [bookingSaved, setBookingSaved] = useState(false);

  // Permissions
  const [canViewAllCalendars, setCanViewAllCalendars] = useState(false);
  const [canViewAllChats,     setCanViewAllChats]     = useState(false);
  const [permSaved, setPermSaved] = useState(false);

  async function loadStaff() {
    const data: StaffInfo = await fetch(`/api/admin/staff/${id}`).then(r => r.json());
    setStaff(data);
    // Parse schedule
    const sched = emptySchedule();
    for (const d of data.schedules) {
      const slots = JSON.parse(d.slots);
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
    // Parse booking settings
    try {
      const s = data.settings ? JSON.parse(data.settings) : {};
      if (s.bookingHorizonDays !== undefined) setHorizonDays(String(s.bookingHorizonDays));
      if (s.minBookingLeadMinutes !== undefined) setLeadMins(String(s.minBookingLeadMinutes));
      if (s.firstApptLeadMinutes !== undefined) setFirstLeadMins(String(s.firstApptLeadMinutes));
    } catch { /* ignore */ }
    setCanViewAllCalendars(!!data.canViewAllCalendars);
    setCanViewAllChats(!!data.canViewAllChats);
    setLoading(false);
  }

  async function loadServices() {
    const data = await fetch(`/api/admin/staff/${id}/services`).then(r => r.json());
    // New shape: { canManageOwn, services }. Backward-compat: plain array.
    if (Array.isArray(data)) {
      setServices(data);
    } else {
      setServices(Array.isArray(data.services) ? data.services : []);
      setCanManageOwn(!!data.canManageOwn);
    }
  }

  async function saveOwnService() {
    if (!ownForm) return;
    if (!ownForm.name.trim() || !ownForm.price || !ownForm.durationMinutes) return;
    setSaving(true);
    await fetch(`/api/admin/staff/${id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: ownForm.id ? "update-own" : "create-own",
        serviceId: ownForm.id ?? undefined,
        name: ownForm.name.trim(),
        description: ownForm.description.trim(),
        price: ownForm.price,
        durationMinutes: ownForm.durationMinutes,
      }),
    });
    setOwnForm(null);
    await loadServices();
    setSaving(false);
  }

  async function deleteOwnService(serviceId: string) {
    if (!confirm("למחוק שירות זה?")) return;
    setSaving(true);
    const res = await fetch(`/api/admin/staff/${id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete-own", serviceId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "מחיקה נכשלה");
    }
    await loadServices();
    setSaving(false);
  }

  useEffect(() => {
    loadStaff();
    loadServices();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleService(serviceId: string, enabled: boolean) {
    setSaving(true);
    await fetch(`/api/admin/staff/${id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId, enabled }),
    });
    await loadServices();
    setSaving(false);
  }

  async function saveCustomPriceDuration(serviceId: string) {
    setSaving(true);
    await fetch(`/api/admin/staff/${id}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId,
        enabled: true,
        customPrice: customPrice ? Number(customPrice) : null,
        customDuration: customDuration ? Number(customDuration) : null,
        customName: customName.trim() || null,
        customNote: customNote.trim() || null,
      }),
    });
    setEditingService(null);
    await loadServices();
    setSaving(false);
  }

  async function saveSchedule() {
    setSaving(true);
    await fetch(`/api/admin/staff/${id}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schedule),
    });
    setSaving(false);
    setScheduleSaved(true);
    setTimeout(() => setScheduleSaved(false), 2500);
  }

  async function savePassword() {
    if (newPass.length < 4) { setPassError("סיסמה חייבת להיות לפחות 4 תווים"); return; }
    if (newPass !== confirmPass) { setPassError("הסיסמאות אינן תואמות"); return; }
    setSaving(true); setPassError("");
    const res = await fetch(`/api/admin/staff/${id}/set-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPass }),
    });
    setSaving(false);
    if (!res.ok) { const d = await res.json(); setPassError(d.error || "שגיאה"); return; }
    setPassSaved(true); setNewPass(""); setConfirmPass("");
    setTimeout(() => setPassSaved(false), 2500);
  }

  async function savePermissions() {
    setSaving(true);
    await fetch(`/api/admin/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canViewAllCalendars, canViewAllChats }),
    });
    setSaving(false);
    setPermSaved(true);
    setTimeout(() => setPermSaved(false), 2500);
  }

  async function saveBookingSettings() {
    setSaving(true);
    const staffData = await fetch(`/api/admin/staff/${id}`).then(r => r.json());
    const existing: Record<string, unknown> = (() => {
      try { return staffData.settings ? JSON.parse(staffData.settings) : {}; } catch { return {}; }
    })();
    const patch: Record<string, number> = {};
    if (horizonDays   !== "") patch.bookingHorizonDays = Number(horizonDays);
    if (leadMins      !== "") patch.minBookingLeadMinutes = Number(leadMins);
    if (firstLeadMins !== "") patch.firstApptLeadMinutes = Number(firstLeadMins);
    await fetch(`/api/admin/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { ...existing, ...patch } }),
    });
    setSaving(false);
    setBookingSaved(true);
    setTimeout(() => setBookingSaved(false), 2500);
  }

  if (loading) return <div className="p-8 text-neutral-400">טוען...</div>;
  if (!staff) return <div className="p-8 text-red-500">ספר לא נמצא</div>;

  return (
    <div className="p-8 overflow-auto h-full max-w-3xl">
      {/* Back button */}
      <Link href="/admin/staff" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 mb-6 transition-colors">
        ← ספרים
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        {staff.avatarUrl
          ? <img src={staff.avatarUrl} alt={staff.name} className="w-14 h-14 rounded-full object-cover" />
          : <div className="w-14 h-14 rounded-full bg-teal-100 flex items-center justify-center font-bold text-teal-700 text-xl">{staff.name[0]}</div>
        }
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{staff.name}</h1>
          {staff.phone && <p className="text-sm text-neutral-500" dir="ltr">{staff.phone}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-neutral-100 rounded-xl p-1 flex-wrap">
        {([
          ["services",     "🛠️ שירותים"],
          ["schedule",     "📅 שעות עבודה"],
          ["booking",      "⚙️ הגדרות יומן"],
          ["permissions",  "🔐 הרשאות"],
          ["password",     "🔒 סיסמא"],
        ] as const).map(([t, label]) => (
          <button key={t} onClick={() => setActiveTab(t as typeof activeTab)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${activeTab === t ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500 hover:text-neutral-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab: Services ── */}
      {activeTab === "services" && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-400 mb-4">בחר אילו שירותים {staff.name} מציע. ניתן לקבוע מחיר/משך מותאמים.</p>

          {/* Shared (owner-managed) services — toggle on/off + custom price/duration */}
          {services.filter(s => !s.owned).map(svc => (
            <div key={svc.id} className={`bg-white rounded-2xl border p-4 ${svc.enabled ? "border-teal-200" : "border-neutral-100"}`}>
              <div className="flex items-center gap-3">
                {/* Toggle */}
                <button onClick={() => toggleService(svc.id, !svc.enabled)} disabled={saving}
                  className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${svc.enabled ? "bg-teal-600" : "bg-neutral-300"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${svc.enabled ? "right-0.5" : "left-0.5"}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-neutral-900 text-sm">
                    {svc.customName || svc.name}
                    {svc.customName && <span className="text-neutral-400 font-normal"> ({svc.name})</span>}
                  </div>
                  <div className="text-xs text-neutral-400">
                    {svc.customPrice != null ? `₪${svc.customPrice}` : `₪${svc.price}`}
                    {" · "}
                    {svc.customDuration != null ? `${svc.customDuration} דק'` : `${svc.durationMinutes} דק'`}
                    {(svc.customPrice != null || svc.customDuration != null || svc.customName || svc.customNote) && <span className="text-teal-600"> (מותאם)</span>}
                  </div>
                  {svc.customNote && <div className="text-xs text-neutral-400 mt-0.5 truncate">📝 {svc.customNote}</div>}
                </div>
                {svc.enabled && (
                  <button onClick={() => {
                    setEditingService(svc.id);
                    setCustomPrice(svc.customPrice != null ? String(svc.customPrice) : "");
                    setCustomDuration(svc.customDuration != null ? String(svc.customDuration) : "");
                    setCustomName(svc.customName ?? "");
                    setCustomNote(svc.customNote ?? "");
                  }}
                    className="text-xs text-neutral-500 hover:text-teal-700 px-2 py-1 rounded-lg border border-neutral-200 hover:border-teal-300 transition">
                    ✏️ התאם
                  </button>
                )}
              </div>

              {/* Inline editor for custom price/duration */}
              {editingService === svc.id && (
                <div className="mt-3 pt-3 border-t border-neutral-100 space-y-3">
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">שם מותאם</label>
                    <input type="text" value={customName}
                      onChange={e => setCustomName(e.target.value)}
                      placeholder={`${svc.name} (ברירת מחדל)`}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">הערה אישית</label>
                    <textarea value={customNote} rows={2}
                      onChange={e => setCustomNote(e.target.value)}
                      placeholder="הערה אישית שתוצג ללקוח (אופציונלי)"
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">מחיר מותאם (₪)</label>
                      <input type="number" min={0} value={customPrice}
                        onChange={e => setCustomPrice(e.target.value)}
                        placeholder={`${svc.price} (ברירת מחדל)`}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">משך מותאם (דקות)</label>
                      <input type="number" min={5} step={5} value={customDuration}
                        onChange={e => setCustomDuration(e.target.value)}
                        placeholder={`${svc.durationMinutes} (ברירת מחדל)`}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveCustomPriceDuration(svc.id)} disabled={saving}
                      className="flex-1 bg-teal-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition">
                      {saving ? "שומר..." : "שמור"}
                    </button>
                    <button onClick={() => setEditingService(null)}
                      className="px-4 bg-neutral-100 text-neutral-600 py-2 rounded-xl text-sm transition hover:bg-neutral-200">
                      ביטול
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Own services — the barber's private services (independent of the owner) */}
          {(canManageOwn || services.some(s => s.owned)) && (
            <div className="pt-4 mt-2 border-t border-neutral-100">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-neutral-800">השירותים של {staff.name}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">שירותים אישיים, ללא תלות בשירותי המנהל</p>
                </div>
                {canManageOwn && (
                  <button
                    onClick={() => setOwnForm({ id: null, name: "", description: "", price: "", durationMinutes: "30" })}
                    className="bg-teal-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-teal-700 transition shrink-0">
                    + שירות חדש
                  </button>
                )}
              </div>

              {/* Add/edit form */}
              {ownForm && (
                <div className="bg-white rounded-2xl border border-teal-200 p-4 mb-3 space-y-3">
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">שם השירות *</label>
                    <input value={ownForm.name}
                      onChange={e => setOwnForm(p => p && ({ ...p, name: e.target.value }))}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1">תיאור</label>
                    <input value={ownForm.description}
                      onChange={e => setOwnForm(p => p && ({ ...p, description: e.target.value }))}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">מחיר (₪) *</label>
                      <input type="number" min={0} value={ownForm.price} dir="ltr"
                        onChange={e => setOwnForm(p => p && ({ ...p, price: e.target.value }))}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">משך (דקות) *</label>
                      <input type="number" min={5} step={5} value={ownForm.durationMinutes} dir="ltr"
                        onChange={e => setOwnForm(p => p && ({ ...p, durationMinutes: e.target.value }))}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveOwnService} disabled={saving || !ownForm.name.trim() || !ownForm.price || !ownForm.durationMinutes}
                      className="flex-1 bg-teal-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition">
                      {saving ? "שומר..." : "שמור"}
                    </button>
                    <button onClick={() => setOwnForm(null)}
                      className="px-4 bg-neutral-100 text-neutral-600 py-2 rounded-xl text-sm transition hover:bg-neutral-200">
                      ביטול
                    </button>
                  </div>
                </div>
              )}

              {/* Own service cards */}
              <div className="space-y-3">
                {services.filter(s => s.owned).map(svc => (
                  <div key={svc.id} className="bg-white rounded-2xl border border-neutral-200 p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-900 text-sm">{svc.name}</span>
                        <span className="text-[10px] bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded-full font-medium">שלי</span>
                      </div>
                      {svc.description && <div className="text-xs text-neutral-400 mt-0.5 truncate">{svc.description}</div>}
                      <div className="text-xs text-neutral-400 mt-0.5">₪{svc.price} · {svc.durationMinutes} דק'</div>
                    </div>
                    {canManageOwn && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button onClick={() => setOwnForm({ id: svc.id, name: svc.name, description: svc.description ?? "", price: String(svc.price), durationMinutes: String(svc.durationMinutes) })}
                          className="text-xs text-neutral-500 hover:text-teal-700 px-2 py-1 rounded-lg border border-neutral-200 hover:border-teal-300 transition">
                          ✏️ ערוך
                        </button>
                        <button onClick={() => deleteOwnService(svc.id)}
                          className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-lg border border-neutral-200 hover:border-red-200 transition">
                          מחק
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {services.filter(s => s.owned).length === 0 && (
                  <p className="text-xs text-neutral-300 text-center py-4">אין עדיין שירותים אישיים</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Schedule ── */}
      {activeTab === "schedule" && (
        <div>
          <div className="space-y-3 mb-6">
            {schedule.map((day, i) => (
              <div key={i} className={`bg-white rounded-xl border p-3 ${day.isWorking ? "border-neutral-200" : "border-neutral-100 bg-neutral-50"}`}>
                <div className="flex items-center gap-3 mb-2">
                  <button onClick={() => {
                    const s = [...schedule];
                    s[i] = { ...s[i], isWorking: !s[i].isWorking };
                    setSchedule(s);
                  }}
                    className={`w-10 h-5 rounded-full transition ${day.isWorking ? "bg-emerald-500" : "bg-neutral-300"}`}>
                    <div className={`w-4 h-4 bg-white rounded-full shadow transition mx-0.5 ${day.isWorking ? "translate-x-5" : ""}`} />
                  </button>
                  <span className="font-medium text-sm text-neutral-800">יום {DAY_NAMES[i]}</span>
                </div>
                {day.isWorking && (
                  <div className="mt-2 space-y-3">
                    {/* Working hours */}
                    <div className="grid grid-cols-2 gap-2">
                      {[["start","התחלה"],["end","סיום"]].map(([field, label]) => (
                        <div key={field}>
                          <label className="text-[11px] text-neutral-400 block mb-0.5">{label}</label>
                          <input type="time" value={(day as unknown as Record<string,string>)[field] || ""}
                            onChange={e => {
                              const s = [...schedule];
                              s[i] = { ...s[i], [field]: e.target.value };
                              setSchedule(s);
                            }}
                            className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm" />
                        </div>
                      ))}
                    </div>

                    {/* Recurring breaks — multiple allowed */}
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
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition ${scheduleSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
            {saving ? "שומר..." : scheduleSaved ? "✓ נשמר" : "שמור לוח שנה"}
          </button>
        </div>
      )}

      {/* ── Tab: Booking settings ── */}
      {activeTab === "booking" && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-5">
          <p className="text-xs text-neutral-400">
            הגדרות אלה ידרסו את הגדרות ברירת המחדל של העסק עבור {staff.name} בלבד.
          </p>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">כמה ימים קדימה היומן פתוח</label>
            <div className="flex items-center gap-3">
              <input type="number" min={1} max={365} value={horizonDays}
                onChange={e => setHorizonDays(e.target.value)}
                placeholder="ברירת מחדל של העסק"
                className="w-28 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              <span className="text-sm text-neutral-500">ימים</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">זמן מינימלי מעכשיו לקביעת תור</label>
            <div className="flex items-center gap-3">
              <input type="number" min={0} max={1440} value={leadMins}
                onChange={e => setLeadMins(e.target.value)}
                placeholder="ברירת מחדל של העסק"
                className="w-28 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              <span className="text-sm text-neutral-500">דקות</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">זמן מינימלי לתור ראשון של אותו היום</label>
            <div className="flex items-center gap-3">
              <input type="number" min={0} max={1440} value={firstLeadMins}
                onChange={e => setFirstLeadMins(e.target.value)}
                placeholder="ברירת מחדל של העסק"
                className="w-28 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              <span className="text-sm text-neutral-500">דקות</span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">
              חל רק כשאין עדיין תורים באותו יום — מונע הזמנת התור הראשון של היום ברגע האחרון.
            </p>
          </div>
          <button onClick={saveBookingSettings} disabled={saving}
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition ${bookingSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
            {saving ? "שומר..." : bookingSaved ? "✓ נשמר" : "שמור הגדרות"}
          </button>
        </div>
      )}

      {/* ── Tab: Permissions ── */}
      {activeTab === "permissions" && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-5">
          <p className="text-xs text-neutral-400">
            הגדר מה {staff.name} רשאי לראות ולעשות במערכת.
          </p>

          {/* canViewAllCalendars toggle */}
          <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">📅 צפייה ביומנים של כל הספרים</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                כשמופעל — {staff.name} יכול לראות את כל העמודות ביומן, לא רק את שלו.
                מתאים לספר בכיר או מנהל שצריך לתאם בין כולם.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCanViewAllCalendars(v => !v)}
              className={`w-12 h-6 rounded-full transition-colors relative shrink-0 mt-0.5 ${canViewAllCalendars ? "bg-teal-500" : "bg-neutral-300"}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${canViewAllCalendars ? "right-1" : "right-6"}`} />
            </button>
          </div>

          {/* canViewAllChats toggle */}
          <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">💬 צפייה בכל השיחות</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                כשמופעל — {staff.name} יכול לראות את כל שיחות הוואטסאפ של העסק, לא רק של לקוחות שלו.
                מתאים לספר בכיר שמטפל בלקוחות של אחרים.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCanViewAllChats(v => !v)}
              className={`w-12 h-6 rounded-full transition-colors relative shrink-0 mt-0.5 ${canViewAllChats ? "bg-teal-500" : "bg-neutral-300"}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${canViewAllChats ? "right-1" : "right-6"}`} />
            </button>
          </div>

          <button onClick={savePermissions} disabled={saving}
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition ${permSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
            {saving ? "שומר..." : permSaved ? "✓ נשמר" : "שמור הרשאות"}
          </button>
        </div>
      )}

      {/* ── Tab: Password ── */}
      {activeTab === "password" && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-5">
          <p className="text-xs text-neutral-400">שנה את סיסמת הכניסה של {staff.name} למערכת.</p>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">סיסמה חדשה</label>
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
              placeholder="לפחות 4 תווים"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">אימות סיסמה</label>
            <input type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)}
              placeholder="הזן שוב"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
          {passError && <p className="text-xs text-red-500">{passError}</p>}
          <button onClick={savePassword} disabled={saving || !newPass || !confirmPass}
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition ${passSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
            {saving ? "שומר..." : passSaved ? "✓ סיסמה עודכנה" : "שמור סיסמה"}
          </button>
        </div>
      )}
    </div>
  );
}
