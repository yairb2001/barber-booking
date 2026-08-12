"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Story = {
  id: string;
  mediaUrl: string;
  caption: string | null;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  staff: { id: string; name: string } | null;
};

export default function BarberStoriesPage() {
  const [myId, setMyId] = useState<string | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newStoryUrl, setNewStoryUrl] = useState("");
  const [newCaption, setNewCaption] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [storyUploading, setStoryUploading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  async function loadStories() {
    const data = await fetch("/api/admin/stories").then(r => r.json());
    setStories(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/admin/me").then(r => (r.ok ? r.json() : null));
      if (me?.staffId) setMyId(me.staffId);
      await loadStories();
      setLoading(false);
    })();
  }, []);

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
    setNewStoryUrl(""); setNewCaption(""); setNewExpiry(""); setShowAdd(false);
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

  const mine = stories.filter(s => s.staff?.id === myId);

  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <Link href="/admin/barber-settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות שלי</Link>
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">📸 סטוריז</h1>
          <p className="text-neutral-500 text-sm mt-1">תמונות זמניות שמוצגות ללקוחות בדף הבית</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-teal-700 transition shrink-0">
          + הוסף סטורי
        </button>
      </div>

      <div className="max-w-2xl">
        {loading ? (
          <div className="text-center py-16 text-neutral-400">טוען...</div>
        ) : mine.length === 0 ? (
          <div className="text-sm text-neutral-400 text-center py-12 bg-white rounded-2xl border border-neutral-100">אין סטוריז עדיין</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {mine.map(story => (
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
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-lg space-y-3" onClick={e => e.stopPropagation()} dir="rtl">
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
              <button onClick={() => setShowAdd(false)} className="flex-1 bg-neutral-100 text-neutral-600 py-2.5 rounded-xl text-sm">ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
