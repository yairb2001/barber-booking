"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { THEMES, type ThemeId, DEFAULT_THEME } from "@/lib/themes";

type BizCore = {
  name: string; phone: string; address: string; about: string;
  logoUrl: string; coverImageUrl: string;
};
const emptyCore: BizCore = { name: "", phone: "", address: "", about: "", logoUrl: "", coverImageUrl: "" };

export default function BusinessInfoPage() {
  const [form, setForm] = useState<BizCore>(emptyCore);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [heroVideoUrl, setHeroVideoUrl] = useState("");
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME);
  const [themeSaving, setThemeSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(data => {
      if (!data) return;
      setForm({
        name: data.name || "", phone: data.phone || "", address: data.address || "", about: data.about || "",
        logoUrl: data.logoUrl || "", coverImageUrl: data.coverImageUrl || "",
      });
      const s = data.settings || {};
      if (typeof s.heroVideoUrl === "string") setHeroVideoUrl(s.heroVideoUrl);
      let resolvedTheme: ThemeId = DEFAULT_THEME;
      if (s.themePreset && s.themePreset in THEMES) resolvedTheme = s.themePreset as ThemeId;
      else if (s.theme === "dark") resolvedTheme = "onyx";
      else if (s.theme === "light") resolvedTheme = "vintage";
      setThemeId(resolvedTheme);
      setLoading(false);
    });
  }, []);

  function setField<K extends keyof BizCore>(key: K, value: BizCore[K]) { setForm(p => ({ ...p, [key]: value })); }

  async function uploadImage(file: File, field: "logoUrl" | "coverImageUrl") {
    const setter = field === "logoUrl" ? setUploadingLogo : setUploadingCover;
    setter(true);
    try {
      const { compressImage } = await import("@/lib/image-compress");
      const compressed = await compressImage(file, field === "logoUrl" ? "logo" : "cover");
      const fd = new FormData();
      fd.append("file", compressed);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) setField(field, data.url);
      else alert("שגיאה בהעלאת תמונה: " + (data.error || "שגיאה לא ידועה"));
    } catch {
      alert("שגיאה בהעלאת תמונה — בדוק חיבור לאינטרנט");
    } finally {
      setter(false);
    }
  }

  async function save() {
    setSaving(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, settingsPatch: { heroVideoUrl } }),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  async function saveTheme(t: ThemeId) {
    setThemeSaving(true);
    setThemeId(t);
    const palette = THEMES[t];
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settingsPatch: { themePreset: t },
        brandColor: palette.brand,
        bgColor: palette.bg,
        textColor: palette.textPri,
      }),
    });
    setThemeSaving(false);
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🏢 פרטי עסק</h1>
        <p className="text-neutral-500 text-sm mt-1">שם, פרטי קשר, תמונות וערכת עיצוב</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-5 max-w-xl">
          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <h2 className="font-semibold text-neutral-800 mb-4">פרטי עסק</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">שם העסק</label>
                <input value={form.name} onChange={e => setField("name", e.target.value)}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">טלפון</label>
                <input value={form.phone} onChange={e => setField("phone", e.target.value)} dir="ltr"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-neutral-500 block mb-1">כתובת</label>
                <input value={form.address} onChange={e => setField("address", e.target.value)}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-neutral-500 block mb-1">אודות</label>
                <textarea value={form.about} onChange={e => setField("about", e.target.value)} rows={3}
                  className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <h2 className="font-semibold text-neutral-800 mb-4">תמונות</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-neutral-500 block mb-2">לוגו העסק</label>
                <div className="flex gap-3 items-center">
                  {form.logoUrl ? (
                    <div className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.logoUrl} alt="logo" className="w-16 h-16 rounded-full object-cover border-2 border-neutral-200" />
                      <button onClick={() => setField("logoUrl", "")}
                        className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition">×</button>
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-full border-2 border-dashed border-neutral-300 flex items-center justify-center text-neutral-300 text-2xl">🖼️</div>
                  )}
                  <div className="flex-1 space-y-1.5">
                    <label className="cursor-pointer">
                      <span className={`inline-block px-3 py-1.5 rounded-lg text-xs font-medium border transition ${uploadingLogo ? "bg-neutral-100 text-neutral-400" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"}`}>
                        {uploadingLogo ? "מעלה..." : "📁 בחר תמונה"}
                      </span>
                      <input type="file" accept="image/*" className="hidden" disabled={uploadingLogo}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f, "logoUrl"); e.target.value = ""; }} />
                    </label>
                    <input value={form.logoUrl} onChange={e => setField("logoUrl", e.target.value)} dir="ltr"
                      placeholder="או הדבק קישור..."
                      className="w-full border border-neutral-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-neutral-500 block mb-2">תמונת רקע (Hero)</label>
                <div className="space-y-2">
                  {form.coverImageUrl && (
                    <div className="relative group w-full h-28 rounded-xl overflow-hidden border border-neutral-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={form.coverImageUrl} alt="cover" className="w-full h-full object-cover" />
                      <button onClick={() => setField("coverImageUrl", "")}
                        className="absolute top-2 left-2 px-2 py-1 bg-red-500 text-white rounded-lg text-xs opacity-0 group-hover:opacity-100 transition">הסר</button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <label className="cursor-pointer">
                      <span className={`inline-block px-3 py-1.5 rounded-lg text-xs font-medium border transition ${uploadingCover ? "bg-neutral-100 text-neutral-400" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"}`}>
                        {uploadingCover ? "מעלה..." : "📁 בחר תמונה"}
                      </span>
                      <input type="file" accept="image/*" className="hidden" disabled={uploadingCover}
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f, "coverImageUrl"); e.target.value = ""; }} />
                    </label>
                    <input value={form.coverImageUrl} onChange={e => setField("coverImageUrl", e.target.value)} dir="ltr"
                      placeholder="או הדבק קישור..."
                      className="flex-1 border border-neutral-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                  <p className="text-[11px] text-neutral-400">מומלץ: תמונה רחבה, לפחות 1200×800px</p>
                </div>
              </div>

              <div>
                <label className="text-xs text-neutral-500 block mb-2">סרטון Hero (רקע דף הבית)</label>
                <input
                  value={heroVideoUrl}
                  onChange={e => setHeroVideoUrl(e.target.value)}
                  dir="ltr"
                  placeholder="https://example.com/video.mp4"
                  className="w-full border border-neutral-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                <p className="text-[11px] text-neutral-400 mt-1">קובץ mp4/webm שיישמע בשקט ויירוץ בלופ מאחורי הלוגו. אם ריק — תוצג תמונת הכיסוי.</p>
                {heroVideoUrl && (
                  <button onClick={() => setHeroVideoUrl("")} className="mt-1 text-[11px] text-red-400 hover:text-red-600">הסר סרטון</button>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <label className="text-sm text-neutral-700 font-semibold">חבילת עיצוב</label>
                <p className="text-[11px] text-neutral-500 mt-0.5">בחר חבילה — צבעים, פונט וניגודיות באים יחד.</p>
              </div>
              {themeSaving && <span className="text-[11px] text-slate-800">שומר...</span>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(Object.values(THEMES)).map(opt => {
                const selected = themeId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => saveTheme(opt.id)}
                    className={`relative rounded-xl overflow-hidden border-2 transition-all text-right ${
                      selected ? "border-teal-600 shadow-md" : "border-neutral-200 hover:border-neutral-300"
                    }`}
                  >
                    <div className="p-3" style={{ background: opt.bg }}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="h-1.5 rounded" style={{ background: opt.textPri, width: 32, opacity: 0.7 }} />
                        <div className="h-3 px-2 rounded-full text-[7px] font-bold flex items-center"
                          style={{ background: opt.brand, color: opt.bg }}>CTA</div>
                      </div>
                      <div className="flex gap-1 mb-2">
                        {[1, 2, 3].map(i => (
                          <div key={i} className="flex-1 rounded p-1" style={{ height: 32, background: opt.card, border: `1px solid ${opt.divider}` }}>
                            <div className="h-1 rounded mb-1" style={{ background: opt.brand, width: "30%" }} />
                            <div className="h-1 rounded" style={{ background: opt.textSec, width: "70%", opacity: 0.5 }} />
                          </div>
                        ))}
                      </div>
                      <p className="text-[9px] leading-tight" style={{ color: opt.textPri, opacity: 0.85, fontFamily: opt.fontDisplay }}>
                        {opt.name.toUpperCase()}
                      </p>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between bg-white border-t border-neutral-100">
                      <span className="text-xs font-bold text-neutral-800">{opt.name}</span>
                      <span className="text-[10px] text-neutral-500">{opt.description}</span>
                    </div>
                    {selected && (
                      <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-teal-600 flex items-center justify-center">
                        <span className="text-white text-[10px]">✓</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={save} disabled={saving}
            className={`w-full py-3 rounded-xl text-sm font-semibold transition ${saved ? "bg-emerald-500 text-white" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
            {saving ? "שומר..." : saved ? "✓ נשמר!" : "שמור שינויים"}
          </button>
        </div>
      )}
    </div>
  );
}
