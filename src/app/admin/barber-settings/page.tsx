"use client";

import { useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────
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
};

type BreakRange = { start: string; end: string };
type ScheduleDay = {
  dayOfWeek: number;
  isWorking: boolean;
  start: string;
  end: string;
  breaks: BreakRange[];
};

type Story = {
  id: string;
  mediaUrl: string;
  caption: string | null;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  staff: { id: string; name: string } | null;
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

type Tab = "services" | "schedule" | "stories" | "password" | "photo";

// ── Component ─────────────────────────────────────────────────────────────────
export default function BarberSettingsPage() {
  const [myId, setMyId]       = useState<string | null>(null);
  const [myName, setMyName]   = useState("");
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("services");

  // ── Services ──
  const [services, setServices]     = useState<ServiceRow[]>([]);
  const [editingSvc, setEditingSvc] = useState<string | null>(null);
  const [customPrice, setCustomPrice]       = useState("");
  const [customDuration, setCustomDuration] = useState("");
  const [svcSaved, setSvcSaved] = useState(false);
  // Own services (the barber's private services)
  const [canManageOwn, setCanManageOwn] = useState(false);
  const [ownForm, setOwnForm] = useState<{ id: string | null; name: string; description: string; price: string; durationMinutes: string } | null>(null);

  // ── Schedule ──
  const [schedule, setSchedule] = useState(emptySchedule());
  const [schedSaved, setSchedSaved] = useState(false);

  // ── Booking settings (merged into schedule tab) ──
  const [horizonDays, setHorizonDays] = useState("");
  const [leadMins,    setLeadMins]    = useState("");
  const [bookSaved, setBookSaved]     = useState(false);

  // ── Password ──
  const [oldPass, setOldPass]       = useState("");
  const [newPass, setNewPass]       = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [passError, setPassError]   = useState("");
  const [passSaved, setPassSaved]   = useState(false);

  // ── Photo ──
  const [avatarDraft, setAvatarDraft]   = useState("");
  const [uploading, setUploading]       = useState(false);
  const [photoSaved, setPhotoSaved]     = useState(false);

  // ── Stories ──
  const [stories, setStories]         = useState<Story[]>([]);
  const [newStoryUrl, setNewStoryUrl] = useState("");
  const [newCaption, setNewCaption]   = useState("");
  const [newExpiry, setNewExpiry]     = useState("");
  const [storyUploading, setStoryUploading] = useState(false);
  const [showAddStory, setShowAddStory]     = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────────
  async function loadMe() {
    const me = await fetch("/api/admin/me").then(r => r.ok ? r.json() : null);
    if (!me?.staffId) return;
    setMyId(me.staffId);
    setMyName(me.staff?.name || "");
    return me.staffId as string;
  }

  async function loadServices(id: string) {
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
    if (!myId || !ownForm) return;
    if (!ownForm.name.trim() || !ownForm.price || !ownForm.durationMinutes) return;
    setSaving(true);
    await fetch(`/api/admin/staff/${myId}/services`, {
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
    await loadServices(myId);
    setSaving(false);
    setSvcSaved(true);
    setTimeout(() => setSvcSaved(false), 2000);
  }

  async function deleteOwnService(serviceId: string) {
    if (!myId) return;
    if (!confirm("למחוק שירות זה?")) return;
    setSaving(true);
    const res = await fetch(`/api/admin/staff/${myId}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete-own", serviceId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "מחיקה נכשלה");
    }
    await loadServices(myId);
    setSaving(false);
  }

  async function loadStaff(id: string) {
    const data = await fetch(`/api/admin/staff/${id}`).then(r => r.json());
    if (!data) return;
    setMyAvatar(data.avatarUrl || null);
    setAvatarDraft(data.avatarUrl || "");
    // Schedule
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
    // Booking settings
    try {
      const s = data.settings ? JSON.parse(data.settings) : {};
      if (s.bookingHorizonDays !== undefined) setHorizonDays(String(s.bookingHorizonDays));
      if (s.minBookingLeadMinutes !== undefined) setLeadMins(String(s.minBookingLeadMinutes));
    } catch { /* ignore */ }
  }

  async function loadStories() {
    const data = await fetch("/api/admin/stories").then(r => r.json());
    setStories(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    (async () => {
      const id = await loadMe();
      if (!id) { setLoading(false); return; }
      await Promise.all([
        loadServices(id),
        loadStaff(id),
        loadStories(),
      ]);
      setLoading(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Services ──────────────────────────────────────────────────────────────────
  async function toggleService(serviceId: string, enabled: boolean) {
    if (!myId) return;
    setSaving(true);
    await fetch(`/api/admin/staff/${myId}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId, enabled }),
    });
    await loadServices(myId);
    setSaving(false);
  }

  async function saveCustom(serviceId: string) {
    if (!myId) return;
    setSaving(true);
    await fetch(`/api/admin/staff/${myId}/services`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId,
        enabled: true,
        customPrice: customPrice ? Number(customPrice) : null,
        customDuration: customDuration ? Number(customDuration) : null,
      }),
    });
    setEditingSvc(null);
    await loadServices(myId);
    setSaving(false);
    setSvcSaved(true);
    setTimeout(() => setSvcSaved(false), 2000);
  }

  // ── Schedule ──────────────────────────────────────────────────────────────────
  async function saveSchedule() {
    if (!myId) return;
    setSaving(true);
    await fetch(`/api/admin/staff/${myId}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schedule),
    });
    setSaving(false);
    setSchedSaved(true);
    setTimeout(() => setSchedSaved(false), 2500);
  }

  // ── Booking ───────────────────────────────────────────────────────────────────
  async function saveBooking() {
    if (!myId) return;
    setSaving(true);
    const staffData = await fetch(`/api/admin/staff/${myId}`).then(r => r.json());
    const existing: Record<string, unknown> = (() => {
      try { return staffData.settings ? JSON.parse(staffData.settings) : {}; } catch { return {}; }
    })();
    const patch: Record<string, number> = {};
    if (horizonDays !== "") patch.bookingHorizonDays = Number(horizonDays);
    if (leadMins    !== "") patch.minBookingLeadMinutes = Number(leadMins);
    await fetch(`/api/admin/staff/${myId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { ...existing, ...patch } }),
    });
    setSaving(false);
    setBookSaved(true);
    setTimeout(() => setBookSaved(false), 2500);
  }

  // ── Password ──────────────────────────────────────────────────────────────────
  async function savePassword() {
    setPassError("");
    if (newPass.length < 6) { setPassError("הסיסמה החדשה חייבת להיות לפחות 6 תווים"); return; }
    if (newPass !== confirmPass) { setPassError("הסיסמאות לא תואמות"); return; }
    setSaving(true);
    const res = await fetch("/api/admin/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass, confirmPassword: confirmPass }),
    });
    setSaving(false);
    if (!res.ok) { const d = await res.json(); setPassError(d.error || "שגיאה"); return; }
    setPassSaved(true); setOldPass(""); setNewPass(""); setConfirmPass("");
    setTimeout(() => setPassSaved(false), 2500);
  }

  // ── Photo ─────────────────────────────────────────────────────────────────────
  async function uploadPhoto(file: File) {
    setUploading(true);
    const { compressImage } = await import("@/lib/image-compress");
    const compressed = await compressImage(file, "avatar");
    const fd = new FormData();
    fd.append("file", compressed);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = await res.json();
    setUploading(false);
    if (data.url) setAvatarDraft(data.url);
    else alert(data.error || "שגיאה בהעלאת תמונה");
  }

  async function savePhoto() {
    if (!myId) return;
    setSaving(true);
    await fetch(`/api/admin/staff/${myId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: avatarDraft || null }),
    });
    setMyAvatar(avatarDraft || null);
    setSaving(false);
    setPhotoSaved(true);
    setTimeout(() => setPhotoSaved(false), 2000);
  }

  // ── Stories ───────────────────────────────────────────────────────────────────
  async function uploadStoryFile(file: File) {
    setStoryUploading(true);
    const { compressImage } = await import("@/lib/image-compress");
    const compressed = await compressImage(file, "story");
    const fd = new FormData();
    fd.append("file", compressed);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = await res.json();
    setStoryUploading(false);
    if (data.url) setNewStoryUrl(data.url);
    else alert(data.error || "שגיאה");
  }

  async function addStory() {
    if (!newStoryUrl) return;
    setSaving(true);
    await fetch("/api/admin/stories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaUrl: newStoryUrl,
        caption: newCaption || null,
        expiresAt: newExpiry || null,
        sortOrder: stories.length,
      }),
    });
    setNewStoryUrl(""); setNewCaption(""); setNewExpiry(""); setShowAddStory(false);
    await loadStories();
    setSaving(false);
  }

  async function toggleStory(id: string, isActive: boolean) {
    await fetch(`/api/admin/stories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    await loadStories();
  }

  async function deleteStory(id: string) {
    if (!confirm("למחוק את הסטורי הזה?")) return;
    await fetch(`/api/admin/stories/${id}`, { method: "DELETE" });
    await loadStories();
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) return <div className="p-8 text-neutral-400 text-center">טוען...</div>;

  const tabs: [Tab, string][] = [
    ["services", "🛠️ שירותים"],
    ["schedule", "📅 שעות ויומן"],
    ["photo",    "🖼️ תמונה"],
    ["stories",  "📸 סטוריז"],
    ["password", "🔒 סיסמה"],
  ];

  return (
    <div className="p-4 md:p-8 overflow-auto h-full max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {myAvatar
          ? <img src={myAvatar} alt={myName} className="w-12 h-12 rounded-full object-cover" />
          : <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center font-bold text-teal-700 text-xl">{myName[0]}</div>
        }
        <div>
          <h1 className="text-xl font-bold text-neutral-900">הגדרות שלי</h1>
          <p className="text-sm text-neutral-500">{myName}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-neutral-100 rounded-xl p-1 overflow-x-auto">
        {tabs.map(([t, label]) => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
              activeTab === t ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500 hover:text-neutral-700"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab: Services ── */}
      {activeTab === "services" && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-400 mb-3">בחר אילו שירותים אתה מציע. ניתן לקבוע מחיר ומשך מותאמים.</p>
          {svcSaved && <div className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ נשמר</div>}
          {services.length === 0 && (
            <div className="text-sm text-neutral-400 text-center py-10 bg-white rounded-2xl border border-neutral-100">
              אין שירותים זמינים
            </div>
          )}
          {services.filter(s => !s.owned).map(svc => (
            <div key={svc.id} className={`bg-white rounded-2xl border p-4 ${svc.enabled ? "border-teal-200" : "border-neutral-100"}`}>
              <div className="flex items-center gap-3">
                <button onClick={() => toggleService(svc.id, !svc.enabled)} disabled={saving}
                  className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${svc.enabled ? "bg-teal-600" : "bg-neutral-300"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${svc.enabled ? "right-0.5" : "left-0.5"}`} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-neutral-900 text-sm">{svc.name}</div>
                  <div className="text-xs text-neutral-400">
                    {svc.customPrice != null ? `₪${svc.customPrice}` : `₪${svc.price}`}
                    {" · "}
                    {svc.customDuration != null ? `${svc.customDuration} דק'` : `${svc.durationMinutes} דק'`}
                    {(svc.customPrice != null || svc.customDuration != null) && <span className="text-teal-600"> (מותאם)</span>}
                  </div>
                </div>
                {svc.enabled && (
                  <button onClick={() => {
                    setEditingSvc(svc.id);
                    setCustomPrice(svc.customPrice != null ? String(svc.customPrice) : "");
                    setCustomDuration(svc.customDuration != null ? String(svc.customDuration) : "");
                  }}
                    className="text-xs text-neutral-500 hover:text-teal-700 px-2 py-1 rounded-lg border border-neutral-200 hover:border-teal-300 transition">
                    ✏️ התאם
                  </button>
                )}
              </div>
              {editingSvc === svc.id && (
                <div className="mt-3 pt-3 border-t border-neutral-100 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">מחיר מותאם (₪)</label>
                      <input type="number" min={0} value={customPrice} onChange={e => setCustomPrice(e.target.value)}
                        placeholder={`${svc.price} (ברירת מחדל)`}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                    </div>
                    <div>
                      <label className="text-xs text-neutral-500 block mb-1">משך מותאם (דקות)</label>
                      <input type="number" min={5} step={5} value={customDuration} onChange={e => setCustomDuration(e.target.value)}
                        placeholder={`${svc.durationMinutes} (ברירת מחדל)`}
                        className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveCustom(svc.id)} disabled={saving}
                      className="flex-1 bg-teal-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                      {saving ? "שומר..." : "שמור"}
                    </button>
                    <button onClick={() => setEditingSvc(null)}
                      className="px-4 bg-neutral-100 text-neutral-600 py-2 rounded-xl text-sm">ביטול</button>
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
                  <p className="text-sm font-semibold text-neutral-800">השירותים שלי</p>
                  <p className="text-xs text-neutral-400 mt-0.5">שירותים אישיים שלך, ללא תלות בשירותי המנהל</p>
                </div>
                {canManageOwn && (
                  <button
                    onClick={() => setOwnForm({ id: null, name: "", description: "", price: "", durationMinutes: "30" })}
                    className="bg-teal-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-teal-700 transition shrink-0">
                    + שירות חדש
                  </button>
                )}
              </div>

              {!canManageOwn && (
                <p className="text-xs text-neutral-400 bg-neutral-50 border border-neutral-100 rounded-lg px-3 py-2 mb-3">
                  ניהול שירותים אישי מושבת. ניתן להפעיל אותו דרך המנהל הראשי.
                </p>
              )}

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
                {services.filter(s => s.owned).length === 0 && canManageOwn && (
                  <p className="text-xs text-neutral-300 text-center py-4">עדיין לא הוספת שירותים אישיים</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Schedule + Booking (merged) ── */}
      {activeTab === "schedule" && (
        <div className="space-y-6">
          {/* ── Working hours section ── */}
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
                      {/* Working hours */}
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

                      {/* Recurring breaks */}
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

          {/* ── Divider ── */}
          <div className="border-t border-neutral-100" />

          {/* ── Booking settings section ── */}
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
            </div>
            <button onClick={saveBooking} disabled={saving}
              className={`w-full py-2.5 rounded-xl text-sm font-semibold transition mt-4 ${bookSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
              {saving ? "שומר..." : bookSaved ? "✓ נשמר" : "שמור הגדרות יומן"}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Photo ── */}
      {activeTab === "photo" && (
        <div className="space-y-4">
          {photoSaved && <div className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ תמונה עודכנה</div>}
          <div className="flex items-center gap-4 bg-white border border-neutral-200 rounded-2xl p-4">
            {avatarDraft
              ? <img src={avatarDraft} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-teal-200" />
              : <div className="w-20 h-20 rounded-full bg-teal-100 flex items-center justify-center font-bold text-teal-700 text-3xl">{myName[0]}</div>
            }
            <div>
              <p className="text-sm font-medium text-neutral-700">תמונת פרופיל</p>
              <p className="text-xs text-neutral-400 mt-0.5">מוצגת ללקוחות בדף הבית</p>
            </div>
          </div>
          <div className="bg-white border border-neutral-200 rounded-2xl p-4 space-y-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1.5">העלאת תמונה חדשה</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed text-sm font-medium transition
                  ${uploading ? "border-slate-300 text-slate-400" : "border-slate-700 text-slate-700 hover:bg-slate-50"}`}>
                  {uploading ? "⏳ מעלה..." : "📷 בחר תמונה מהמכשיר"}
                </div>
                <input type="file" accept="image/*" className="hidden" disabled={uploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); }} />
              </label>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">או הכנס קישור (URL)</label>
              <input value={avatarDraft} onChange={e => setAvatarDraft(e.target.value)}
                placeholder="https://..." dir="ltr"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
          </div>
          <button onClick={savePhoto} disabled={saving || uploading || !avatarDraft}
            className="w-full bg-teal-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition">
            {saving ? "שומר..." : "💾 שמור תמונה"}
          </button>
        </div>
      )}

      {/* ── Tab: Stories ── */}
      {activeTab === "stories" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-neutral-400">סטוריז מוצגים בדף הבית ללקוחות</p>
            <button onClick={() => setShowAddStory(true)}
              className="text-xs px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition">
              + הוסף סטורי
            </button>
          </div>

          {stories.filter(s => s.staff?.id === myId).length === 0
            ? <div className="text-sm text-neutral-400 text-center py-8 bg-white rounded-2xl border border-neutral-100">אין סטוריז עדיין</div>
            : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {stories.filter(s => s.staff?.id === myId).map(story => (
                  <div key={story.id} className={`relative rounded-xl overflow-hidden border ${story.isActive ? "border-teal-300" : "border-neutral-200 opacity-60"}`}>
                    <img src={story.mediaUrl} alt="" className="w-full aspect-square object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-black/50 p-2 flex gap-1.5">
                      <button onClick={() => toggleStory(story.id, story.isActive)}
                        className={`flex-1 text-[10px] py-1 rounded text-white ${story.isActive ? "bg-neutral-600" : "bg-teal-600"}`}>
                        {story.isActive ? "הסתר" : "הפעל"}
                      </button>
                      <button onClick={() => deleteStory(story.id)}
                        className="text-[10px] px-2 py-1 bg-red-500 text-white rounded">🗑</button>
                    </div>
                    {story.caption && (
                      <div className="absolute top-0 inset-x-0 bg-black/40 text-white text-[10px] px-2 py-1 truncate">{story.caption}</div>
                    )}
                  </div>
                ))}
              </div>
            )
          }

          {showAddStory && (
            <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50" onClick={() => setShowAddStory(false)}>
              <div className="bg-white rounded-t-2xl p-5 w-full max-w-lg space-y-3" onClick={e => e.stopPropagation()}>
                <h3 className="font-bold text-neutral-900">הוסף סטורי</h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed text-sm font-medium w-full
                    ${storyUploading ? "border-slate-300 text-slate-400" : "border-slate-700 text-slate-700 hover:bg-slate-50"}`}>
                    {storyUploading ? "⏳ מעלה..." : newStoryUrl ? "✓ תמונה הועלתה — ניתן להחליף" : "📷 בחר תמונה"}
                  </div>
                  <input type="file" accept="image/*" className="hidden" disabled={storyUploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadStoryFile(f); }} />
                </label>
                {newStoryUrl && <img src={newStoryUrl} alt="" className="w-full h-40 object-cover rounded-xl" />}
                <input value={newCaption} onChange={e => setNewCaption(e.target.value)}
                  placeholder="כיתוב (אופציונלי)"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">תפוגה (אופציונלי)</label>
                  <input type="date" value={newExpiry} onChange={e => setNewExpiry(e.target.value)}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={addStory} disabled={saving || !newStoryUrl}
                    className="flex-1 bg-teal-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                    {saving ? "שומר..." : "פרסם סטורי"}
                  </button>
                  <button onClick={() => setShowAddStory(false)} className="flex-1 bg-neutral-100 text-neutral-600 py-2.5 rounded-xl text-sm">ביטול</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Password ── */}
      {activeTab === "password" && (
        <div className="space-y-4">
          {passSaved && <div className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ סיסמה עודכנה בהצלחה</div>}
          {passError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{passError}</div>}
          <div className="bg-white border border-neutral-200 rounded-2xl p-4 space-y-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">סיסמה נוכחית</label>
              <input type="password" value={oldPass} onChange={e => setOldPass(e.target.value)}
                placeholder="סיסמה נוכחית" dir="ltr"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">סיסמה חדשה (מינ׳ 6 תווים)</label>
              <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
                placeholder="סיסמה חדשה" dir="ltr"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">אימות סיסמה</label>
              <input type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)}
                placeholder="הכנס שוב את הסיסמה החדשה" dir="ltr"
                className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
          </div>
          <button onClick={savePassword} disabled={saving || !oldPass || !newPass || !confirmPass}
            className="w-full bg-violet-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition">
            {saving ? "שומר..." : "🔒 שמור סיסמה"}
          </button>
        </div>
      )}
    </div>
  );
}
