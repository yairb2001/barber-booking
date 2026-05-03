"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type StaffOption = { id: string; name: string; avatarUrl: string | null };

type Story = {
  id: string;
  mediaUrl: string;
  caption: string | null;
  isActive: boolean;
  sortOrder: number;
  expiresAt: string | null;
  createdAt: string;
  staff: { id: string; name: string; avatarUrl: string | null } | null;
};

export default function AdminStoriesPage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isOwner, setIsOwner] = useState(true);
  const [myStaffId, setMyStaffId] = useState<string | null>(null);

  // New story form
  const [newUrl, setNewUrl] = useState("");
  const [newCaption, setNewCaption] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [newStaffId, setNewStaffId] = useState<string>("");
  const [showAdd, setShowAdd] = useState(false);

  async function uploadFile(file: File) {
    setUploading(true);
    const { compressImage } = await import("@/lib/image-compress");
    const compressed = await compressImage(file, "story");
    const fd = new FormData();
    fd.append("file", compressed);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = await res.json();
    setUploading(false);
    if (data.url) setNewUrl(data.url);
    else alert(data.error || "שגיאה בהעלאת תמונה");
  }

  async function load() {
    const [storiesData, meData, staffData] = await Promise.all([
      fetch("/api/admin/stories").then(r => r.json()),
      fetch("/api/admin/me").then(r => r.ok ? r.json() : null),
      fetch("/api/staff").then(r => r.json()).catch(() => []),
    ]);
    setStories(Array.isArray(storiesData) ? storiesData : []);
    if (meData) {
      setIsOwner(meData.isOwner ?? true);
      setMyStaffId(meData.staff?.id ?? null);
    }
    setStaffList(Array.isArray(staffData) ? staffData : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addStory() {
    if (!newUrl.trim()) return;
    setSaving(true);
    await fetch("/api/admin/stories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaUrl: newUrl.trim(),
        caption: newCaption.trim() || null,
        expiresAt: newExpiry || null,
        sortOrder: stories.length,
        // owner passes selected staff, barber passes own id
        staffId: isOwner ? (newStaffId || null) : myStaffId,
      }),
    });
    setNewUrl("");
    setNewCaption("");
    setNewExpiry("");
    setNewStaffId("");
    setShowAdd(false);
    setSaving(false);
    load();
  }

  async function toggleActive(id: string, current: boolean) {
    await fetch(`/api/admin/stories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    load();
  }

  async function deleteStory(id: string) {
    if (!confirm("למחוק תמונה זו מהגלריה?")) return;
    await fetch(`/api/admin/stories/${id}`, { method: "DELETE" });
    load();
  }

  async function reorder(id: string, direction: -1 | 1) {
    const idx = stories.findIndex(s => s.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= stories.length) return;

    const reordered = [...stories];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];

    await Promise.all([
      fetch(`/api/admin/stories/${reordered[idx].id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: idx }),
      }),
      fetch(`/api/admin/stories/${reordered[newIdx].id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: newIdx }),
      }),
    ]);
    load();
  }

  return (
    <div className="p-6 overflow-auto h-full" dir="rtl">
      <Link href="/admin/settings" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 mb-6 transition-colors">
        ← הגדרות עסק
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">עבודות נבחרות</h1>
          <p className="text-neutral-500 text-sm mt-1">מוצגות בדף הבית תחת "העבודות שלנו"</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 transition"
        >
          + הוסף תמונה
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-400">טוען...</div>
      ) : stories.length === 0 ? (
        <div className="text-center py-16 text-neutral-400">
          <p className="text-4xl mb-4">🖼️</p>
          <p>אין תמונות עדיין — הוסף את הראשונה!</p>
        </div>
      ) : (
        <div className="space-y-3 max-w-2xl">
          {stories.map((story, idx) => (
            <div
              key={story.id}
              className={`bg-white rounded-2xl border p-4 flex items-center gap-4 transition ${
                story.isActive ? "border-neutral-200" : "border-neutral-100 opacity-60"
              }`}
            >
              {/* Thumbnail */}
              <div className="w-16 h-16 rounded-xl overflow-hidden bg-stone-100 flex-shrink-0">
                <img
                  src={story.mediaUrl}
                  alt={story.caption || ""}
                  className="w-full h-full object-cover"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                {/* Staff attribution */}
                {story.staff ? (
                  <div className="flex items-center gap-1.5 mb-1">
                    {story.staff.avatarUrl ? (
                      <img src={story.staff.avatarUrl} className="w-5 h-5 rounded-full object-cover border border-slate-200" alt="" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-teal-100 flex items-center justify-center text-[9px] text-teal-700 font-bold">
                        {story.staff.name[0]}
                      </div>
                    )}
                    <span className="text-xs font-semibold text-slate-700">{story.staff.name}</span>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mb-1">ללא שיוך לספר</p>
                )}
                {story.caption && (
                  <p className="text-sm text-neutral-600 truncate">{story.caption}</p>
                )}
                {story.expiresAt && (
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    פג תוקף: {new Date(story.expiresAt).toLocaleDateString("he-IL")}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => reorder(story.id, -1)} disabled={idx === 0}
                    className="text-neutral-400 hover:text-neutral-700 disabled:opacity-20 text-xs px-1.5 py-0.5 rounded hover:bg-neutral-100 transition">▲</button>
                  <button onClick={() => reorder(story.id, 1)} disabled={idx === stories.length - 1}
                    className="text-neutral-400 hover:text-neutral-700 disabled:opacity-20 text-xs px-1.5 py-0.5 rounded hover:bg-neutral-100 transition">▼</button>
                </div>
                <button onClick={() => toggleActive(story.id, story.isActive)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    story.isActive ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "border-neutral-200 text-neutral-400"
                  }`}>
                  {story.isActive ? "מוצג" : "מוסתר"}
                </button>
                <button onClick={() => deleteStory(story.id)}
                  className="text-xs px-3 py-1.5 rounded-full border border-red-100 text-red-400 hover:bg-red-50 transition">
                  מחק
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-2xl p-6 w-96 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} dir="rtl">
            <h3 className="font-bold text-neutral-900 mb-5 text-lg">הוסף תמונה לגלריה</h3>
            <div className="space-y-3">

              {/* Staff picker — owner only */}
              {isOwner && staffList.length > 0 && (
                <div>
                  <label className="text-xs text-neutral-500 block mb-1.5">שייך לספר</label>
                  <select
                    value={newStaffId}
                    onChange={e => setNewStaffId(e.target.value)}
                    className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                  >
                    <option value="">ללא שיוך</option>
                    {staffList.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Barber — show their own name (auto-attributed) */}
              {!isOwner && myStaffId && (
                <div className="flex items-center gap-2 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                  <span className="text-xs text-teal-700 font-medium">📌 התמונה תשויך אוטומטית אליך</span>
                </div>
              )}

              {/* File upload */}
              <div>
                <label className="text-xs text-neutral-500 block mb-1.5">העלאה מהמכשיר</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed text-sm font-medium w-full justify-center transition
                    ${uploading ? "border-slate-300 text-slate-400 bg-slate-50" : "border-slate-300 text-slate-700 bg-slate-50 hover:bg-slate-100"}`}>
                    {uploading ? "⏳ מעלה תמונה..." : "📷 בחר תמונה מהמכשיר"}
                  </div>
                  <input type="file" accept="image/*" className="hidden" disabled={uploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
                </label>
              </div>

              {/* Preview */}
              {newUrl && (
                <div className="w-full h-40 rounded-xl overflow-hidden bg-stone-100">
                  <img src={newUrl} alt="" className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                </div>
              )}

              <div>
                <label className="text-xs text-neutral-500 block mb-1">כיתוב (אופציונלי)</label>
                <input value={newCaption} onChange={e => setNewCaption(e.target.value)}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  placeholder="תיאור קצר..." />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={addStory} disabled={saving || uploading || !newUrl.trim()}
                className="flex-1 bg-teal-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                {saving ? "שומר..." : "הוסף לגלריה"}
              </button>
              <button onClick={() => setShowAdd(false)}
                className="flex-1 bg-neutral-100 text-neutral-700 py-2 rounded-xl text-sm font-medium">
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
