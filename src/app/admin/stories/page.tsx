"use client";

import { useEffect, useState } from "react";

type Story = {
  id: string;
  mediaUrl: string;
  caption: string | null;
  isActive: boolean;
  sortOrder: number;
  expiresAt: string | null;
  createdAt: string;
};

export default function AdminStoriesPage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // New story form
  const [newUrl, setNewUrl] = useState("");
  const [newCaption, setNewCaption] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
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
    const data = await fetch("/api/admin/stories").then((r) => r.json());
    setStories(data);
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
      }),
    });
    setNewUrl("");
    setNewCaption("");
    setNewExpiry("");
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
    if (!confirm("למחוק סטורי זה?")) return;
    await fetch(`/api/admin/stories/${id}`, { method: "DELETE" });
    load();
  }

  async function reorder(id: string, direction: -1 | 1) {
    const idx = stories.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= stories.length) return;

    const reordered = [...stories];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];

    // Update sortOrder for both
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
    <div className="p-8 overflow-auto h-full" dir="rtl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">סטוריז</h1>
          <p className="text-neutral-500 text-sm mt-1">{stories.length} סטוריז</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-amber-500 text-neutral-950 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-amber-400 transition"
        >
          + סטורי חדש
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-neutral-400">טוען...</div>
      ) : stories.length === 0 ? (
        <div className="text-center py-16 text-neutral-400">
          <p className="text-4xl mb-4">📸</p>
          <p>אין סטוריז עדיין — הוסף את הראשון!</p>
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
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                {story.caption && (
                  <p className="text-sm font-medium text-neutral-800 truncate">{story.caption}</p>
                )}
                <p className="text-xs text-neutral-400 truncate" dir="ltr">{story.mediaUrl}</p>
                {story.expiresAt && (
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    פג תוקף: {new Date(story.expiresAt).toLocaleDateString("he-IL")}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Up/down reorder */}
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => reorder(story.id, -1)}
                    disabled={idx === 0}
                    className="text-neutral-400 hover:text-neutral-700 disabled:opacity-20 text-xs px-1.5 py-0.5 rounded hover:bg-neutral-100 transition"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => reorder(story.id, 1)}
                    disabled={idx === stories.length - 1}
                    className="text-neutral-400 hover:text-neutral-700 disabled:opacity-20 text-xs px-1.5 py-0.5 rounded hover:bg-neutral-100 transition"
                  >
                    ▼
                  </button>
                </div>

                {/* Toggle active */}
                <button
                  onClick={() => toggleActive(story.id, story.isActive)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition ${
                    story.isActive
                      ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                      : "border-neutral-200 text-neutral-400"
                  }`}
                >
                  {story.isActive ? "פעיל" : "כבוי"}
                </button>

                {/* Delete */}
                <button
                  onClick={() => deleteStory(story.id)}
                  className="text-xs px-3 py-1.5 rounded-full border border-red-100 text-red-400 hover:bg-red-50 transition"
                >
                  מחק
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Story Modal */}
      {showAdd && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-96 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            <h3 className="font-bold text-neutral-900 mb-5 text-lg">סטורי חדש</h3>
            <div className="space-y-3">
              {/* File upload */}
              <div>
                <label className="text-xs text-neutral-500 block mb-1.5">העלאה מהמכשיר</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed text-sm font-medium w-full justify-center transition
                    ${uploading ? "border-amber-300 text-amber-400 bg-amber-50" : "border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100"}`}>
                    {uploading ? "⏳ מעלה תמונה..." : "📷 בחר תמונה מהמכשיר"}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
                  />
                </label>
              </div>

              {/* OR URL */}
              <div>
                <label className="text-xs text-neutral-500 block mb-1">או קישור (URL)</label>
                <input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  dir="ltr"
                  placeholder="https://..."
                />
              </div>

              {/* Preview */}
              {newUrl && (
                <div className="w-full h-40 rounded-xl overflow-hidden bg-stone-100">
                  <img
                    src={newUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              )}
              <div>
                <label className="text-xs text-neutral-500 block mb-1">כיתוב (אופציונלי)</label>
                <input
                  value={newCaption}
                  onChange={(e) => setNewCaption(e.target.value)}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="כיתוב לסטורי..."
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">תאריך פקיעה (אופציונלי)</label>
                <input
                  type="datetime-local"
                  value={newExpiry}
                  onChange={(e) => setNewExpiry(e.target.value)}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  dir="ltr"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={addStory}
                disabled={saving || uploading || !newUrl.trim()}
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
    </div>
  );
}
