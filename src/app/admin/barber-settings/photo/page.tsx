"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function BarberPhotoPage() {
  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState("");
  const [avatarDraft, setAvatarDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/admin/me").then(r => (r.ok ? r.json() : null));
      if (!me?.staffId) { setLoading(false); return; }
      setMyId(me.staffId);
      setMyName(me.staff?.name || "");
      const data = await fetch(`/api/admin/staff/${me.staffId}`).then(r => r.json());
      if (data) setAvatarDraft(data.avatarUrl || "");
      setLoading(false);
    })();
  }, []);

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
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="p-6 sm:p-8 overflow-auto h-full">
      <Link href="/admin/barber-settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות שלי</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🖼️ תמונת פרופיל</h1>
        <p className="text-neutral-500 text-sm mt-1">התמונה שלקוחות רואים בדף הבית</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-4 max-w-xl">
          {saved && <div className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">✓ תמונה עודכנה</div>}

          <div className="flex items-center gap-4 bg-white border border-neutral-200 rounded-2xl p-4">
            {avatarDraft
              ? <img src={avatarDraft} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-teal-200" />
              : <div className="w-20 h-20 rounded-full bg-teal-100 flex items-center justify-center font-bold text-teal-700 text-3xl">{myName[0] || "?"}</div>}
            <div>
              <p className="text-sm font-medium text-neutral-700">{myName}</p>
              <p className="text-xs text-neutral-400 mt-0.5">כך זה ייראה ללקוחות</p>
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
    </div>
  );
}
