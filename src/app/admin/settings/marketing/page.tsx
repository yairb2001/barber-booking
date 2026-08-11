"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function MarketingReferralsPage() {
  const [loading, setLoading] = useState(true);

  // Referral program ("חבר מביא חבר")
  const [referralEnabled, setReferralEnabled] = useState(true);
  const [referralGoal, setReferralGoal] = useState(3);
  const [referralGift, setReferralGift] = useState("תספורת חינם");
  const [savingProgram, setSavingProgram] = useState(false);
  const [savedProgram, setSavedProgram] = useState(false);

  // Referral sources
  const [referralSources, setReferralSources] = useState<string[]>([]);
  const [newSource, setNewSource] = useState("");
  const [savingReferral, setSavingReferral] = useState(false);
  const [savedReferral, setSavedReferral] = useState(false);
  const [referralFriendSource, setReferralFriendSource] = useState("");

  // Facebook / Meta Pixel
  const [facebookPixel, setFacebookPixel] = useState("");
  const [pixelSaving, setPixelSaving] = useState(false);
  const [pixelSaved, setPixelSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(data => {
      if (data) {
        setFacebookPixel(data.facebookPixel || "");
        const s = data.settings || {};
        setReferralEnabled(s.referralProgramEnabled !== false);
        if (Number(s.referralGoal) > 0) setReferralGoal(Math.round(Number(s.referralGoal)));
        if (typeof s.referralGiftLabel === "string" && s.referralGiftLabel.trim()) setReferralGift(s.referralGiftLabel.trim());
        if (typeof s.referralFriendSource === "string") setReferralFriendSource(s.referralFriendSource);
      }
      setLoading(false);
    });
    fetch("/api/admin/referral-sources").then(r => r.json()).then(setReferralSources);
  }, []);

  async function saveReferralProgram() {
    setSavingProgram(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settingsPatch: {
          referralProgramEnabled: referralEnabled,
          referralGoal: Math.max(1, Math.round(referralGoal) || 3),
          referralGiftLabel: referralGift.trim() || "תספורת חינם",
        },
      }),
    });
    setSavingProgram(false);
    setSavedProgram(true); setTimeout(() => setSavedProgram(false), 2000);
  }

  function editSource(idx: number, value: string) {
    setReferralSources(prev => {
      const next = [...prev];
      const old = next[idx];
      next[idx] = value;
      if (old && old === referralFriendSource) setReferralFriendSource(value);
      return next;
    });
  }
  function addSource() {
    const v = newSource.trim();
    if (!v || referralSources.includes(v)) return;
    setReferralSources(prev => [...prev, v]);
    setNewSource("");
  }
  function removeSource(idx: number) {
    setReferralSources(prev => {
      if (prev[idx] === referralFriendSource) setReferralFriendSource("");
      return prev.filter((_, i) => i !== idx);
    });
  }
  function moveSource(idx: number, dir: -1 | 1) {
    setReferralSources(prev => {
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return next;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  async function saveReferralSources() {
    setSavingReferral(true);
    const sources = referralSources.map(s => s.trim()).filter(Boolean);
    await fetch("/api/admin/referral-sources", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sources),
    });
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settingsPatch: {
          referralSources: sources,
          referralFriendSource: sources.includes(referralFriendSource) ? referralFriendSource : "",
        },
      }),
    });
    setSavingReferral(false);
    setSavedReferral(true); setTimeout(() => setSavedReferral(false), 2000);
  }

  async function savePixel() {
    setPixelSaving(true);
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facebookPixel }),
    });
    setPixelSaving(false);
    setPixelSaved(true); setTimeout(() => setPixelSaved(false), 2000);
  }

  return (
    <div className="p-8 overflow-auto h-full">
      <Link href="/admin/settings" className="text-sm text-neutral-400 hover:text-neutral-600 transition mb-1 inline-block">← חזרה להגדרות</Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">🎁 שיווק והפניות</h1>
        <p className="text-neutral-500 text-sm mt-1">חבר מביא חבר, מקורות הגעה ופיקסל פייסבוק</p>
      </div>

      {loading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
        <div className="space-y-5 max-w-xl">
          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-neutral-800">תוכנית חבר מביא חבר 🎁</h2>
              <button onClick={saveReferralProgram} disabled={savingProgram}
                className={`text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 ${savedProgram ? "bg-emerald-500 text-white" : "bg-neutral-900 text-white hover:bg-neutral-700"}`}>
                {savingProgram ? "שומר..." : savedProgram ? "✓ נשמר" : "שמור"}
              </button>
            </div>
            <p className="text-xs text-neutral-400 mb-4">
              כשלקוח חדש מציין מי המליץ עליו — אנחנו מודים לממליץ ומראים לו התקדמות למתנה.
            </p>

            <label className="flex items-center justify-between bg-neutral-50 rounded-xl px-4 py-3 cursor-pointer mb-3">
              <div>
                <span className="text-sm font-medium text-neutral-800">הפעל את התוכנית</span>
                <p className="text-[11px] text-neutral-400 mt-0.5">כיבוי מסתיר את בחירת החבר ומפסיק את הודעות התודה</p>
              </div>
              <input type="checkbox" checked={referralEnabled} onChange={e => setReferralEnabled(e.target.checked)}
                className="w-5 h-5 rounded accent-teal-600 flex-shrink-0" />
            </label>

            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 transition-opacity ${referralEnabled ? "" : "opacity-40 pointer-events-none"}`}>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">כמה חברים = מתנה?</label>
                <input type="number" min={1} value={referralGoal}
                  onChange={e => setReferralGoal(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">המתנה</label>
                <input value={referralGift} onChange={e => setReferralGift(e.target.value)}
                  placeholder="תספורת חינם"
                  className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </div>
            </div>
            <p className="text-[11px] text-neutral-400 mt-2">
              לדוגמה: כל {Math.max(1, referralGoal)} חברים = {referralGift.trim() || "תספורת חינם"}.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-neutral-800">מקורות הגעה</h2>
              <button onClick={saveReferralSources} disabled={savingReferral}
                className={`text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 ${savedReferral ? "bg-emerald-500 text-white" : "bg-neutral-900 text-white hover:bg-neutral-700"}`}>
                {savingReferral ? "שומר..." : savedReferral ? "✓ נשמר" : "שמור רשימה"}
              </button>
            </div>
            <p className="text-xs text-neutral-400 mb-4">
              האופציות שיופיעו ללקוח ב״מאיפה הכרת אותנו?״ ולך ביומן הניהול. אפשר לערוך, לסדר ולמחוק.
              סמן ב🤝 איזו אופציה פותחת את בחירת החבר (תוכנית ההמלצות).
            </p>

            <div className="space-y-2 mb-3">
              {referralSources.map((src, i) => {
                const isFriend = !!src.trim() && src === referralFriendSource;
                return (
                <div key={i} className="flex items-center gap-1.5 bg-neutral-50 rounded-xl px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setReferralFriendSource(isFriend ? "" : src)}
                    title={isFriend ? "זו אופציית ההמלצה" : "סמן כאופציית ההמלצה (פותחת בחירת חבר)"}
                    className={`flex-shrink-0 w-7 h-7 rounded-lg text-sm flex items-center justify-center transition-colors ${isFriend ? "bg-teal-600 text-white" : "bg-white border border-neutral-200 text-neutral-300 hover:text-neutral-500"}`}>
                    🤝
                  </button>
                  <input value={src} onChange={e => editSource(i, e.target.value)}
                    className="flex-1 min-w-0 bg-transparent text-sm text-neutral-800 px-1 py-1 rounded focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-400" />
                  <button onClick={() => moveSource(i, -1)} disabled={i === 0}
                    className="text-neutral-400 hover:text-neutral-600 disabled:opacity-20 text-xs px-1">▲</button>
                  <button onClick={() => moveSource(i, 1)} disabled={i === referralSources.length - 1}
                    className="text-neutral-400 hover:text-neutral-600 disabled:opacity-20 text-xs px-1">▼</button>
                  <button onClick={() => removeSource(i)}
                    className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
                </div>
                );
              })}
              {referralSources.length === 0 && (
                <p className="text-sm text-neutral-400 italic text-center py-2">אין אופציות — הוסף למטה</p>
              )}
            </div>

            <div className="flex gap-2">
              <input value={newSource} onChange={e => setNewSource(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addSource()}
                placeholder="הוסף אופציה חדשה..."
                className="flex-1 border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              <button onClick={addSource}
                className="bg-teal-600 text-white px-4 rounded-xl text-sm font-medium hover:bg-teal-700">
                + הוסף
              </button>
            </div>

            {referralEnabled && referralSources.length > 0 && !referralSources.includes(referralFriendSource) && (
              <p className="text-[11px] text-amber-600 mt-3 leading-relaxed">
                ⚠ תוכנית ההמלצות פעילה אך לא סימנת איזו אופציה היא ״המלצת חבר״.
                סמן 🤝 ליד האופציה הנכונה (למשל ״המלצה של חבר״) כדי שבחירת החבר תיפתח.
              </p>
            )}
          </div>

          <div className="bg-white border border-neutral-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className="text-lg">📊</span>
                <h3 className="text-sm font-semibold text-neutral-900">פיקסל פייסבוק (Meta Pixel)</h3>
              </div>
              <button onClick={savePixel} disabled={pixelSaving}
                className={`text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 ${pixelSaved ? "bg-emerald-500 text-white" : "bg-neutral-900 text-white hover:bg-neutral-700"}`}>
                {pixelSaving ? "שומר..." : pixelSaved ? "✓ נשמר" : "שמור"}
              </button>
            </div>
            <p className="text-xs text-neutral-500 mb-3 leading-relaxed">
              מאפשר רימרקטינג למי שנכנס לדף ההזמנות ומדידת המרות ממודעות.
              הדבק את מזהה הפיקסל (15–16 ספרות) — תמצא אותו ב-Meta Events Manager.
            </p>
            <label className="text-xs text-neutral-500 block mb-1">מזהה פיקסל</label>
            <input
              value={facebookPixel}
              onChange={e => setFacebookPixel(e.target.value.match(/\d{6,20}/)?.[0] || "")}
              dir="ltr"
              inputMode="numeric"
              placeholder="לדוגמה: 123456789012345"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
            <p className="text-[11px] text-neutral-400 mt-2 leading-relaxed">
              אפשר להדביק גם את קוד הסקריפט המלא — נשמר רק המספר. השאר ריק כדי לכבות את המעקב.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
