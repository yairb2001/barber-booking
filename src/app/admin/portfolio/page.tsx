"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type PortfolioItem = {
  id: string;
  imageUrl: string;
  caption: string | null;
  sortOrder: number;
};

type StaffWithPortfolio = {
  id: string;
  name: string;
  avatarUrl: string | null;
  portfolio: PortfolioItem[];
};

export default function AdminPortfolioPage() {
  const [staff, setStaff] = useState<StaffWithPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null); // staffId being uploaded
  const [deleting, setDeleting] = useState<string | null>(null);   // itemId being deleted
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function load() {
    const data = await fetch("/api/admin/portfolio").then(r => r.json());
    setStaff(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>, staffId: string) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(staffId);

    // Upload via the existing upload API
    const fd = new FormData();
    fd.append("file", file);
    const uploadRes = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const uploadData = await uploadRes.json();

    if (!uploadData.url) {
      alert(uploadData.error || "שגיאה בהעלאת תמונה");
      setUploading(null);
      return;
    }

    // Save to portfolio
    await fetch("/api/admin/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId, imageUrl: uploadData.url }),
    });

    setUploading(null);
    // Reset input so same file can be re-uploaded
    if (fileRefs.current[staffId]) fileRefs.current[staffId]!.value = "";
    await load();
  }

  async function deleteItem(itemId: string) {
    setDeleting(itemId);
    await fetch(`/api/admin/portfolio/${itemId}`, { method: "DELETE" });
    setDeleting(null);
    await load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 rounded-full border-2 border-teal-600 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/settings" className="text-slate-400 hover:text-slate-600 transition text-sm">
          ← הגדרות
        </Link>
        <div className="w-px h-4 bg-slate-200" />
        <div>
          <h1 className="text-lg font-bold text-slate-900">גלריית עבודות</h1>
          <p className="text-xs text-slate-500">תמונות מוצגות בדף הבית תחת "העבודות שלנו"</p>
        </div>
      </div>

      {staff.length === 0 && (
        <div className="text-center py-16 text-slate-400 text-sm">
          אין ספרים פעילים. הוסף ספרים קודם בהגדרות.
        </div>
      )}

      <div className="space-y-6">
        {staff.map(member => (
          <div key={member.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Staff header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
              {member.avatarUrl ? (
                <img src={member.avatarUrl} alt={member.name}
                  className="w-9 h-9 rounded-full object-cover border border-slate-200" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm">
                  {member.name[0]}
                </div>
              )}
              <div className="flex-1">
                <p className="font-semibold text-sm text-slate-900">{member.name}</p>
                <p className="text-xs text-slate-400">{member.portfolio.length} תמונות</p>
              </div>

              {/* Upload button */}
              <label className="relative cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                  ref={el => { fileRefs.current[member.id] = el; }}
                  onChange={e => handleFileChange(e, member.id)}
                  disabled={uploading === member.id}
                />
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  uploading === member.id
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                    : "bg-teal-50 text-teal-700 hover:bg-teal-100 active:bg-teal-200"
                }`}>
                  {uploading === member.id ? (
                    <>
                      <div className="w-3 h-3 rounded-full border-2 border-teal-400 border-t-transparent animate-spin" />
                      מעלה…
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M12 5v14M5 12l7-7 7 7" />
                      </svg>
                      הוסף תמונה
                    </>
                  )}
                </div>
              </label>
            </div>

            {/* Portfolio grid */}
            {member.portfolio.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-400 text-sm">
                עדיין אין תמונות — לחץ "הוסף תמונה" להתחיל
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1 p-2">
                {member.portfolio.map(item => (
                  <div key={item.id} className="relative group" style={{ aspectRatio: "1/1" }}>
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="w-full h-full object-cover rounded-lg"
                      onError={e => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
                    />
                    {/* Delete overlay */}
                    <button
                      onClick={() => deleteItem(item.id)}
                      disabled={deleting === item.id}
                      className="absolute top-1 left-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 active:opacity-100 transition-opacity"
                      style={{ fontSize: 10 }}
                    >
                      {deleting === item.id ? (
                        <div className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      ) : "✕"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
