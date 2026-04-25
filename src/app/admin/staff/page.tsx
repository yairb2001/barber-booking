"use client";

import { useEffect, useState } from "react";

type Staff = {
  id: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  isAvailable: boolean;
  inQuickPool: boolean;
  sortOrder: number;
  schedules: {
    dayOfWeek: number;
    isWorking: boolean;
    slots: string;
    breaks: string | null;
  }[];
};

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const emptySchedule = () =>
  Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    isWorking: i >= 0 && i <= 5,
    start: "09:00",
    end: "20:00",
    breakStart: "",
    breakEnd: "",
  }));

export default function AdminStaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<string | null>(null);
  const [schedule, setSchedule] = useState(emptySchedule());
  const [newStaff, setNewStaff] = useState({ name: "", phone: "", avatarUrl: "", inQuickPool: true });
  const [saving, setSaving] = useState(false);
  const [setPasswordFor, setSetPasswordFor] = useState<Staff | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [editingAvatarId, setEditingAvatarId] = useState<string | null>(null);
  const [avatarUrlDraft, setAvatarUrlDraft] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  async function load() {
    const data = await fetch("/api/admin/staff").then((r) => r.json());
    setStaff(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addStaff() {
    if (!newStaff.name.trim()) return;
    setSaving(true);
    await fetch("/api/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newStaff),
    });
    setNewStaff({ name: "", phone: "", avatarUrl: "", inQuickPool: true });
    setShowAdd(false);
    setSaving(false);
    load();
  }

  async function toggleAvailable(id: string, current: boolean) {
    await fetch(`/api/admin/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAvailable: !current }),
    });
    load();
  }

  async function toggleQuickPool(id: string, current: boolean) {
    await fetch(`/api/admin/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inQuickPool: !current }),
    });
    load();
  }

  async function setStaffPassword(id: string) {
    if (!newPassword || newPassword.length < 4) { alert("סיסמה חייבת להיות לפחות 4 תווים"); return; }
    setSaving(true);
    const res = await fetch(`/api/admin/staff/${id}/set-password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
    setSaving(false);
    if (res.ok) { setSetPasswordFor(null); setNewPassword(""); alert("סיסמה הוגדרה בהצלחה ✓"); }
    else { const d = await res.json(); alert(d.error || "שגיאה"); }
  }

  async function uploadAvatarFile(id: string, file: File) {
    setUploadingAvatar(true);
    const { compressImage } = await import("@/lib/image-compress");
    const compressed = await compressImage(file, "avatar");
    const fd = new FormData();
    fd.append("file", compressed);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = await res.json();
    setUploadingAvatar(false);
    if (data.url) {
      setAvatarUrlDraft(data.url);
    } else {
      alert(data.error || "שגיאה בהעלאת תמונה");
    }
  }

  async function saveAvatar(id: string) {
    setSaving(true);
    await fetch(`/api/admin/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: avatarUrlDraft.trim() || null }),
    });
    setSaving(false);
    setEditingAvatarId(null);
    setAvatarUrlDraft("");
    load();
  }

  async function deleteStaff(id: string, name: string) {
    if (!confirm(`למחוק את ${name}?\n\nפעולה זו תמחק גם את לוח השעות, השירותים והגלריה שלו.`)) return;
    const res = await fetch(`/api/admin/staff/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "שגיאה במחיקה");
      return;
    }
    load();
  }

  function openSchedule(s: Staff) {
    setEditingSchedule(s.id);
    const sched = emptySchedule();
    for (const d of s.schedules) {
      const slots = JSON.parse(d.slots);
      const breaks = d.breaks ? JSON.parse(d.breaks) : [];
      sched[d.dayOfWeek] = {
        dayOfWeek: d.dayOfWeek,
        isWorking: d.isWorking,
        start: slots[0]?.start || "09:00",
        end: slots[0]?.end || "20:00",
        breakStart: breaks[0]?.start || "",
        breakEnd: breaks[0]?.end || "",
      };
    }
    setSchedule(sched);
  }

  async function saveSchedule() {
    if (!editingSchedule) return;
    setSaving(true);
    await fetch(`/api/admin/staff/${editingSchedule}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schedule),
    });
    setSaving(false);
    setEditingSchedule(null);
    load();
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">ספרים</h1>
          <p className="text-neutral-500 text-sm mt-1">{staff.length} ספרים רשומים</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-amber-500 text-neutral-950 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-amber-400 transition"
        >
          + ספר חדש
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-400">טוען...</div>
      ) : (
        <div className="space-y-3">
          {staff.map((s) => (
            <div
              key={s.id}
              className={`bg-white rounded-2xl border ${s.isAvailable ? "border-neutral-200" : "border-neutral-100 opacity-60"} p-5`}
            >
              <div className="flex items-center gap-4">
                {s.avatarUrl ? (
                  <img src={s.avatarUrl} alt={s.name} className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-lg">
                    {s.name[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-neutral-900">{s.name}</div>
                  {s.phone && <div className="text-sm text-neutral-500" dir="ltr">{s.phone}</div>}
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {/* Photo edit button */}
                  <button
                    onClick={() => {
                      setEditingAvatarId(s.id);
                      setAvatarUrlDraft(s.avatarUrl || "");
                    }}
                    className="text-xs px-3 py-1.5 rounded-full border border-amber-200 text-amber-700 hover:bg-amber-50 transition"
                  >
                    ✏️ תמונה
                  </button>
                  <button
                    onClick={() => toggleQuickPool(s.id, s.inQuickPool)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
                      s.inQuickPool
                        ? "bg-amber-50 border-amber-300 text-amber-700"
                        : "border-neutral-200 text-neutral-400"
                    }`}
                  >
                    {s.inQuickPool ? "✓ תורים מהירים" : "תורים מהירים"}
                  </button>
                  <button
                    onClick={() => { setSetPasswordFor(s); setNewPassword(""); }}
                    className="text-xs px-3 py-1.5 rounded-full border border-violet-200 text-violet-600 hover:bg-violet-50 transition"
                  >
                    🔑 סיסמה
                  </button>
                  <button
                    onClick={() => openSchedule(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition"
                  >
                    לוח שנה
                  </button>
                  <button
                    onClick={() => toggleAvailable(s.id, s.isAvailable)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
                      s.isAvailable
                        ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                        : "border-neutral-200 text-neutral-400"
                    }`}
                  >
                    {s.isAvailable ? "פעיל" : "לא פעיל"}
                  </button>
                  <button
                    onClick={() => deleteStaff(s.id, s.name)}
                    className="text-xs px-3 py-1.5 rounded-full border border-red-100 text-red-400 hover:bg-red-50 transition"
                  >
                    מחק
                  </button>
                </div>
              </div>

              {/* Inline avatar editor — file upload or URL */}
              {editingAvatarId === s.id && (
                <div className="mt-4 p-4 bg-amber-50 rounded-xl border border-amber-100 space-y-3">
                  {/* File upload */}
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1.5">העלאה מהמכשיר</label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed text-sm font-medium transition
                        ${uploadingAvatar ? "border-amber-300 text-amber-400 bg-white" : "border-amber-400 text-amber-700 bg-white hover:bg-amber-50"}`}>
                        {uploadingAvatar ? "⏳ מעלה..." : "📷 בחר תמונה מהמכשיר"}
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingAvatar}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatarFile(s.id, f); }}
                      />
                    </label>
                  </div>

                  {/* OR URL */}
                  <div>
                    <label className="text-xs text-neutral-500 block mb-1.5">או הכנס קישור (URL)</label>
                    <input
                      value={avatarUrlDraft}
                      onChange={(e) => setAvatarUrlDraft(e.target.value)}
                      placeholder="https://..."
                      dir="ltr"
                      className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  {/* Preview */}
                  {avatarUrlDraft && (
                    <div className="flex items-center gap-3">
                      <img src={avatarUrlDraft} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-amber-300" />
                      <span className="text-xs text-neutral-500">תצוגה מקדימה</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveAvatar(s.id)}
                      disabled={saving || uploadingAvatar || !avatarUrlDraft}
                      className="flex-1 bg-amber-500 text-neutral-950 py-2 rounded-xl text-sm font-semibold hover:bg-amber-400 disabled:opacity-50 transition"
                    >
                      {saving ? "שומר..." : "שמור תמונה"}
                    </button>
                    <button
                      onClick={() => { setEditingAvatarId(null); setAvatarUrlDraft(""); }}
                      className="px-4 bg-neutral-100 text-neutral-600 py-2 rounded-xl text-sm transition hover:bg-neutral-200"
                    >
                      ביטול
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Staff Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-neutral-900 mb-5 text-lg">ספר חדש</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">שם *</label>
                <input
                  value={newStaff.name}
                  onChange={(e) => setNewStaff((p) => ({ ...p, name: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="שם הספר"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">טלפון</label>
                <input
                  value={newStaff.phone}
                  onChange={(e) => setNewStaff((p) => ({ ...p, phone: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">קישור לתמונה (URL)</label>
                <input
                  value={newStaff.avatarUrl}
                  onChange={(e) => setNewStaff((p) => ({ ...p, avatarUrl: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  dir="ltr"
                  placeholder="https://..."
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newStaff.inQuickPool}
                  onChange={(e) => setNewStaff((p) => ({ ...p, inQuickPool: e.target.checked }))}
                  className="accent-amber-500"
                />
                <span className="text-sm text-neutral-700">הוסף לתורים המהירים בדף הבית</span>
              </label>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={addStaff}
                disabled={saving || !newStaff.name.trim()}
                className="flex-1 bg-amber-500 text-neutral-950 py-2 rounded-xl text-sm font-semibold hover:bg-amber-400 disabled:opacity-50"
              >
                {saving ? "שומר..." : "הוסף"}
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 bg-neutral-100 text-neutral-700 py-2 rounded-xl text-sm font-medium"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set Password Modal */}
      {setPasswordFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setSetPasswordFor(null)}>
          <div className="bg-white rounded-2xl p-6 w-80 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-neutral-900 mb-1 text-lg">הגדרת סיסמה</h3>
            <p className="text-sm text-neutral-500 mb-4">
              {setPasswordFor.name} יוכל להיכנס עם הטלפון שלו
              {setPasswordFor.phone ? ` (${setPasswordFor.phone})` : ""} והסיסמה הזו
            </p>
            {!setPasswordFor.phone && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                ⚠️ לא הוגדר טלפון לספר זה — הוסף טלפון קודם
              </p>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">סיסמה חדשה (מינ׳ 4 תווים)</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoFocus
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  dir="ltr"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setStaffPassword(setPasswordFor.id)}
                disabled={saving || newPassword.length < 4 || !setPasswordFor.phone}
                className="flex-1 bg-violet-500 text-white py-2 rounded-xl text-sm font-semibold hover:bg-violet-400 disabled:opacity-50"
              >
                {saving ? "שומר..." : "שמור סיסמה"}
              </button>
              <button onClick={() => setSetPasswordFor(null)} className="flex-1 bg-neutral-100 text-neutral-700 py-2 rounded-xl text-sm">
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {editingSchedule && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditingSchedule(null)}>
          <div className="bg-white rounded-2xl p-6 w-[520px] shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-neutral-900 mb-5 text-lg">
              לוח שנה – {staff.find((s) => s.id === editingSchedule)?.name}
            </h3>
            <div className="space-y-3">
              {schedule.map((day, i) => (
                <div key={i} className={`rounded-xl border p-3 ${day.isWorking ? "border-neutral-200" : "border-neutral-100 bg-neutral-50"}`}>
                  <div className="flex items-center gap-3 mb-2">
                    <button
                      onClick={() => {
                        const s = [...schedule];
                        s[i] = { ...s[i], isWorking: !s[i].isWorking };
                        setSchedule(s);
                      }}
                      className={`w-10 h-5 rounded-full transition ${day.isWorking ? "bg-emerald-500" : "bg-neutral-300"}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full shadow transition mx-0.5 ${day.isWorking ? "translate-x-5" : ""}`} />
                    </button>
                    <span className="font-medium text-sm text-neutral-800">יום {DAY_NAMES[i]}</span>
                  </div>
                  {day.isWorking && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div>
                        <label className="text-[11px] text-neutral-400 block mb-0.5">התחלה</label>
                        <input
                          type="time"
                          value={day.start}
                          onChange={(e) => {
                            const s = [...schedule];
                            s[i] = { ...s[i], start: e.target.value };
                            setSchedule(s);
                          }}
                          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-neutral-400 block mb-0.5">סיום</label>
                        <input
                          type="time"
                          value={day.end}
                          onChange={(e) => {
                            const s = [...schedule];
                            s[i] = { ...s[i], end: e.target.value };
                            setSchedule(s);
                          }}
                          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-neutral-400 block mb-0.5">הפסקה מ</label>
                        <input
                          type="time"
                          value={day.breakStart}
                          onChange={(e) => {
                            const s = [...schedule];
                            s[i] = { ...s[i], breakStart: e.target.value };
                            setSchedule(s);
                          }}
                          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-neutral-400 block mb-0.5">הפסקה עד</label>
                        <input
                          type="time"
                          value={day.breakEnd}
                          onChange={(e) => {
                            const s = [...schedule];
                            s[i] = { ...s[i], breakEnd: e.target.value };
                            setSchedule(s);
                          }}
                          className="w-full border border-neutral-200 rounded-lg px-2 py-1.5 text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={saveSchedule}
                disabled={saving}
                className="flex-1 bg-amber-500 text-neutral-950 py-2 rounded-xl text-sm font-semibold hover:bg-amber-400 disabled:opacity-50"
              >
                {saving ? "שומר..." : "שמור לוח שנה"}
              </button>
              <button
                onClick={() => setEditingSchedule(null)}
                className="flex-1 bg-neutral-100 text-neutral-700 py-2 rounded-xl text-sm font-medium"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
