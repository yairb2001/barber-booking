"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { THEMES, type ThemeId, DEFAULT_THEME } from "@/lib/themes";

// ── Types ──────────────────────────────────────────────────────────────────────
type Business = {
  name: string; phone: string; address: string; about: string;
  logoUrl: string; coverImageUrl: string; brandColor: string;
  secondaryColor: string; bgColor: string; textColor: string;
  socialLinks: { whatsapp?: string; instagram?: string; facebook?: string; waze?: string };
  whatsappNumber: string;
  messagingProvider: string;
  greenApiInstanceId: string;
  greenApiToken: string;
  features: { reminders: boolean; reminder_24h: boolean; reminder_2h: boolean; agent: boolean };
  reminder24hTemplate: string;
  reminder2hTemplate: string;
  bookingHorizonDays: number;
  minBookingLeadMinutes: number;
  reengageEnabled: boolean;
  reengageWeeks: number;
  reengageTemplate: string;
  chatsEnabled: boolean;
};
type Schedule = { dayOfWeek: number; isWorking: boolean; slots: string; breaks: string | null };
type StaffMember = { id: string; name: string; settings: string | null; schedules: Schedule[] };
type StaffBookingSettings = { bookingHorizonDays?: number; minBookingLeadMinutes?: number };

type DayConfig = { isWorking: boolean; start: string; end: string; hasBreak: boolean; breakStart: string; breakEnd: string };

type AutoType = "reengage" | "post_first_visit" | "post_every_visit";
interface AutoRec {
  id: string; type: AutoType; name: string; active: boolean;
  settings: string; template: string | null;
}
const AUTO_NAMES: Record<AutoType, string> = {
  reengage: "החזרת לקוחות לא פעילים",
  post_first_visit: "קידום חכם — ביקור ראשון",
  post_every_visit: "הודעה אחרי כל ביקור",
};
const AUTO_DEFAULT_SETTINGS: Record<AutoType, object> = {
  reengage:         { inactiveWeeks: 6, excludeWithFutureAppt: true, segment: "all" },
  post_first_visit: { ctaType: "google_review", ctaUrl: "" },
  post_every_visit: { segment: "regular_only", minVisits: 2 },
};
function parseAutoS<T>(s: string): T { try { return JSON.parse(s) as T; } catch { return {} as T; } }

// ── Defaults ───────────────────────────────────────────────────────────────────
const DEFAULT_24H_TEMPLATE =
`שלום {{name}} 👋

תזכורת — יש לך תור מחר ב*{{business}}* ✂️
📅 {{date}}
🕒 {{time}}
💈 אצל {{staff}}{{address_line}}

אם יש שינוי — נא להודיע מראש 🙏`;

const DEFAULT_2H_TEMPLATE =
`שלום {{name}} 👋

תזכורת — יש לך תור בעוד שעתיים ב*{{business}}* ✂️
🕒 {{time}}
💈 אצל {{staff}}{{address_line}}

נתראה בקרוב! 💈`;

const DEFAULT_REENGAGE_TEMPLATE =
`שלום {{name}} 👋

מזמן לא ראינו אותך אצלנו!
נשמח לראותך שוב — קבע תור עכשיו 💈

{{booking_link}}`;

const emptyBusiness: Business = {
  name: "", phone: "", address: "", about: "", logoUrl: "", coverImageUrl: "",
  brandColor: "#D4AF37", secondaryColor: "#ffffff", bgColor: "#faf9f7", textColor: "#171717",
  socialLinks: {},
  whatsappNumber: "", messagingProvider: "green_api", greenApiInstanceId: "", greenApiToken: "",
  features: { reminders: true, reminder_24h: true, reminder_2h: false, agent: false },
  reminder24hTemplate: "", reminder2hTemplate: "",
  bookingHorizonDays: 30, minBookingLeadMinutes: 0,
  reengageEnabled: false, reengageWeeks: 6, reengageTemplate: "",
  chatsEnabled: false,
};
const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function defaultDay(dow: number): DayConfig {
  const isFriday = dow === 5; const isSaturday = dow === 6;
  return { isWorking: !isSaturday, start: isFriday ? "08:00" : "09:00", end: isFriday ? "14:00" : "20:00", hasBreak: false, breakStart: "13:00", breakEnd: "14:00" };
}

function parseSchedule(schedules: Schedule[]): DayConfig[] {
  return Array.from({ length: 7 }, (_, dow) => {
    const s = schedules.find(x => x.dayOfWeek === dow);
    if (!s) return defaultDay(dow);
    let start = "09:00", end = "20:00";
    try { const sl = JSON.parse(s.slots); if (sl[0]) { start = sl[0].start; end = sl[0].end; } } catch { /* ignore */ }
    let hasBreak = false, breakStart = "13:00", breakEnd = "14:00";
    if (s.breaks) { try { const br = JSON.parse(s.breaks); if (br[0]) { hasBreak = true; breakStart = br[0].start; breakEnd = br[0].end; } } catch { /* ignore */ } }
    return { isWorking: s.isWorking, start, end, hasBreak, breakStart, breakEnd };
  });
}

// ── Staff Schedule Editor ──────────────────────────────────────────────────────
function StaffScheduleEditor({ staff }: { staff: StaffMember }) {
  const [days, setDays] = useState<DayConfig[]>(() => parseSchedule(staff.schedules));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Per-barber booking settings (stored in staff.settings JSON)
  const initBooking: StaffBookingSettings = (() => {
    try { return staff.settings ? JSON.parse(staff.settings) : {}; } catch { return {}; }
  })();
  const [horizonDays,    setHorizonDays]    = useState<string>(initBooking.bookingHorizonDays    !== undefined ? String(initBooking.bookingHorizonDays)    : "");
  const [leadMins,       setLeadMins]       = useState<string>(initBooking.minBookingLeadMinutes !== undefined ? String(initBooking.minBookingLeadMinutes) : "");
  const [bookingSaving,  setBookingSaving]  = useState(false);
  const [bookingSaved,   setBookingSaved]   = useState(false);

  async function saveBookingSettings() {
    setBookingSaving(true);
    const patch: StaffBookingSettings = {};
    if (horizonDays !== "") patch.bookingHorizonDays    = Number(horizonDays);
    if (leadMins    !== "") patch.minBookingLeadMinutes = Number(leadMins);
    // Merge into existing settings
    const existing: Record<string, unknown> = (() => {
      try { return staff.settings ? JSON.parse(staff.settings) : {}; } catch { return {}; }
    })();
    const merged = { ...existing, ...patch };
    await fetch(`/api/admin/staff/${staff.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: merged }),
    });
    setBookingSaving(false); setBookingSaved(true); setTimeout(() => setBookingSaved(false), 2500);
  }

  function updateDay(dow: number, patch: Partial<DayConfig>) {
    setDays(prev => prev.map((d, i) => i === dow ? { ...d, ...patch } : d));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    const payload = days.map((d, dow) => ({
      dayOfWeek: dow, isWorking: d.isWorking, start: d.start, end: d.end,
      ...(d.hasBreak && d.breakStart && d.breakEnd ? { breakStart: d.breakStart, breakEnd: d.breakEnd } : {}),
    }));
    await fetch(`/api/admin/staff/${staff.id}/schedule`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-700">{staff.name[0]}</div>
          <span className="font-semibold text-neutral-900">{staff.name}</span>
        </div>
        <button onClick={save} disabled={saving}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${saved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
          {saving ? "שומר..." : saved ? "✓ נשמר" : "שמור"}
        </button>
      </div>

      <div className="divide-y divide-neutral-50">
        {days.map((day, dow) => (
          <div key={dow} className={`px-5 py-3 ${!day.isWorking ? "bg-neutral-50/60" : ""}`}>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Toggle */}
              <button onClick={() => updateDay(dow, { isWorking: !day.isWorking })}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${day.isWorking ? "bg-teal-600" : "bg-neutral-200"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${day.isWorking ? "right-0.5" : "left-0.5"}`} />
              </button>

              <span className={`text-sm font-medium w-16 shrink-0 ${day.isWorking ? "text-neutral-800" : "text-neutral-400"}`}>{DAY_NAMES[dow]}</span>

              {day.isWorking ? (
                <>
                  {/* Work hours — force LTR so "start → end" reads naturally */}
                  <div className="flex items-center gap-2" dir="ltr">
                    <span className="text-xs text-neutral-400">מ</span>
                    <input type="time" dir="ltr" value={day.start} onChange={e => updateDay(dow, { start: e.target.value })}
                      className="border border-neutral-200 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                    <span className="text-xs text-neutral-400">—</span>
                    <input type="time" dir="ltr" value={day.end} onChange={e => updateDay(dow, { end: e.target.value })}
                      className="border border-neutral-200 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                    <span className="text-xs text-neutral-400">עד</span>
                  </div>

                  {/* Break */}
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateDay(dow, { hasBreak: !day.hasBreak })}
                      className={`text-xs px-2.5 py-1 rounded-lg border transition ${day.hasBreak ? "bg-orange-50 border-orange-200 text-orange-700" : "bg-neutral-50 border-neutral-200 text-neutral-400"}`}>
                      הפסקה
                    </button>
                    {day.hasBreak && (
                      <div className="flex items-center gap-2" dir="ltr">
                        <input type="time" dir="ltr" value={day.breakStart} onChange={e => updateDay(dow, { breakStart: e.target.value })}
                          className="border border-neutral-200 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                        <span className="text-xs text-neutral-400">—</span>
                        <input type="time" dir="ltr" value={day.breakEnd} onChange={e => updateDay(dow, { breakEnd: e.target.value })}
                          className="border border-neutral-200 rounded-lg px-2 py-1 text-sm w-24 focus:outline-none focus:ring-1 focus:ring-teal-300" />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <span className="text-xs text-neutral-400">לא עובד</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Per-barber booking calendar settings */}
      <div className="border-t border-neutral-100 px-5 py-4 bg-neutral-50/40">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-semibold text-neutral-700">📅 הגדרות יומן אישיות</p>
            <p className="text-[11px] text-neutral-400 mt-0.5">ריק = ברירת מחדל של העסק</p>
          </div>
          <button onClick={saveBookingSettings} disabled={bookingSaving}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${bookingSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
            {bookingSaving ? "שומר..." : bookingSaved ? "✓ נשמר" : "שמור"}
          </button>
        </div>
        <div className="flex gap-4 flex-wrap">
          <div>
            <label className="text-[11px] text-neutral-500 block mb-1">ימים קדימה פתוח</label>
            <div className="flex items-center gap-1.5">
              <input type="number" min={1} max={365} value={horizonDays}
                onChange={e => setHorizonDays(e.target.value)}
                placeholder="גלובלי"
                className="w-20 border border-neutral-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-300" />
              <span className="text-xs text-neutral-400">ימים</span>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-neutral-500 block mb-1">מינימום לפני קביעה</label>
            <div className="flex items-center gap-1.5">
              <input type="number" min={0} max={1440} value={leadMins}
                onChange={e => setLeadMins(e.target.value)}
                placeholder="גלובלי"
                className="w-20 border border-neutral-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-300" />
              <span className="text-xs text-neutral-400">דקות</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AdminSettingsPage() {
  const [tab, setTab] = useState<"business" | "hours" | "whatsapp" | "automations">("business");
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [form, setForm] = useState<Business>(emptyBusiness);
  const [bizLoading, setBizLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

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
      if (data.url) {
        setField(field, data.url);
      } else {
        alert("שגיאה בהעלאת תמונה: " + (data.error || "שגיאה לא ידועה"));
      }
    } catch {
      alert("שגיאה בהעלאת תמונה — בדוק חיבור לאינטרנט");
    } finally {
      setter(false);
    }
  }

  // Theme preset (curated 4-pack — admin picks one, all colors+font come together)
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME);
  const [themeSaving, setThemeSaving] = useState(false);

  async function saveTheme(t: ThemeId) {
    setThemeSaving(true);
    setThemeId(t);
    const bizData = await fetch("/api/admin/business").then(r => r.json());
    const currentSettings = bizData.settings || {};
    // Save the new themePreset; also mirror brand/bg/text colors to legacy fields for backward compat
    const palette = THEMES[t];
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { ...currentSettings, themePreset: t },
        brandColor: palette.brand,
        bgColor: palette.bg,
        textColor: palette.textPri,
      }),
    });
    setThemeSaving(false);
  }

  // Owner login phone (separate from public business phone — used to log in as owner)
  const [ownerLoginPhone, setOwnerLoginPhone] = useState("");
  const [ownerPhoneSaving, setOwnerPhoneSaving] = useState(false);
  const [ownerPhoneSaved, setOwnerPhoneSaved] = useState(false);

  async function saveOwnerLoginPhone() {
    setOwnerPhoneSaving(true);
    setOwnerPhoneSaved(false);
    const bizData = await fetch("/api/admin/business").then(r => r.json());
    const currentSettings = bizData.settings || {};
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { ...currentSettings, ownerLoginPhone: ownerLoginPhone.trim() },
      }),
    });
    setOwnerPhoneSaving(false);
    setOwnerPhoneSaved(true);
    setTimeout(() => setOwnerPhoneSaved(false), 2000);
  }

  // ── Change password ──
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  async function changePassword() {
    setPwError("");
    setPwSuccess(false);
    if (!oldPassword) { setPwError("נא להזין את הסיסמה הנוכחית"); return; }
    if (!newPassword || newPassword.length < 6) { setPwError("הסיסמה החדשה חייבת להיות לפחות 6 תווים"); return; }
    if (newPassword !== confirmNewPassword) { setPwError("הסיסמאות החדשות לא תואמות"); return; }
    setPwSaving(true);
    try {
      const res = await fetch("/api/admin/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword, confirmPassword: confirmNewPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwError(data.error || "שגיאה");
      } else {
        setPwSuccess(true);
        setOldPassword(""); setNewPassword(""); setConfirmNewPassword("");
        setTimeout(() => setPwSuccess(false), 3000);
      }
    } catch {
      setPwError("שגיאה בחיבור לשרת");
    } finally {
      setPwSaving(false);
    }
  }

  // Hero video URL (stored in business.settings)
  const [heroVideoUrl, setHeroVideoUrl] = useState("");

  // Calendar display hours
  const [calStartHour, setCalStartHour] = useState(8);
  const [calEndHour, setCalEndHour] = useState(21);
  const [calHoursSaving, setCalHoursSaving] = useState(false);
  const [calHoursSaved, setCalHoursSaved] = useState(false);

  async function saveCalendarHours() {
    setCalHoursSaving(true);
    const bizData = await fetch("/api/admin/business").then(r => r.json());
    const currentSettings = bizData.settings || {};
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { ...currentSettings, calendarStartHour: calStartHour, calendarEndHour: calEndHour },
      }),
    });
    setCalHoursSaving(false);
    setCalHoursSaved(true);
    setTimeout(() => setCalHoursSaved(false), 2000);
  }

  // Referral sources
  const [referralSources, setReferralSources] = useState<string[]>([]);
  const [newSource, setNewSource] = useState("");
  const [savingReferral, setSavingReferral] = useState(false);

  useEffect(() => {
    fetch("/api/admin/business").then(r => r.json()).then(data => {
      if (data) {
        const rawF = (typeof data.features === "string" ? JSON.parse(data.features) : data.features) || {};
        setForm({
          name: data.name || "", phone: data.phone || "", address: data.address || "", about: data.about || "",
          logoUrl: data.logoUrl || "", coverImageUrl: data.coverImageUrl || "",
          brandColor: data.brandColor || "#D4AF37",
          secondaryColor: data.secondaryColor || "#ffffff",
          bgColor: data.bgColor || "#faf9f7",
          textColor: data.textColor || "#171717",
          socialLinks: data.socialLinks || {},
          whatsappNumber: data.whatsappNumber || "",
          messagingProvider: data.messagingProvider || "green_api",
          greenApiInstanceId: data.greenApiInstanceId || "",
          greenApiToken: data.greenApiToken || "",
          features: {
            reminders:    rawF.reminders    ?? true,
            // backward compat: if reminder_24h missing, inherit from legacy "reminders"
            reminder_24h: rawF.reminder_24h ?? rawF.reminders ?? true,
            reminder_2h:  rawF.reminder_2h  ?? false,
            agent:        rawF.agent        ?? false,
          },
          reminder24hTemplate: data.reminder24hTemplate || "",
          reminder2hTemplate:  data.reminder2hTemplate  || "",
          bookingHorizonDays:     data.bookingHorizonDays     ?? 30,
          minBookingLeadMinutes:  data.minBookingLeadMinutes  ?? 0,
          reengageEnabled:        data.reengageEnabled        ?? false,
          reengageWeeks:       data.reengageWeeks       ?? 6,
          reengageTemplate:    data.reengageTemplate    || "",
          chatsEnabled:        data.chatsEnabled        ?? false,
        });
        const settingsObj = data.settings || {};
        // Resolve theme preset (with backward compat for old "theme: light/dark")
        let resolvedTheme: ThemeId = DEFAULT_THEME;
        if (settingsObj.themePreset && settingsObj.themePreset in THEMES) {
          resolvedTheme = settingsObj.themePreset as ThemeId;
        } else if (settingsObj.theme === "dark") {
          resolvedTheme = "onyx";
        } else if (settingsObj.theme === "light") {
          resolvedTheme = "vintage";
        }
        setThemeId(resolvedTheme);
        // Owner login phone — falls back to public phone if not set
        setOwnerLoginPhone(settingsObj.ownerLoginPhone || data.phone || "");
        // Calendar hours
        if (typeof settingsObj.calendarStartHour === "number") setCalStartHour(settingsObj.calendarStartHour);
        if (typeof settingsObj.calendarEndHour   === "number") setCalEndHour(settingsObj.calendarEndHour);
        // Hero video
        if (typeof settingsObj.heroVideoUrl === "string") setHeroVideoUrl(settingsObj.heroVideoUrl);
      }
      setBizLoading(false);
    });
    fetch("/api/admin/staff").then(r => r.json()).then(data => { setStaffList(data); setStaffLoading(false); });
    fetch("/api/admin/referral-sources").then(r => r.json()).then(setReferralSources);
  }, []);

  async function saveReferralSources() {
    setSavingReferral(true);
    await fetch("/api/admin/referral-sources", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(referralSources),
    });
    setSavingReferral(false);
  }

  function addSource() {
    const v = newSource.trim();
    if (!v || referralSources.includes(v)) return;
    setReferralSources(prev => [...prev, v]);
    setNewSource("");
  }

  function removeSource(idx: number) {
    setReferralSources(prev => prev.filter((_, i) => i !== idx));
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

  async function saveBiz() {
    setSaving(true);
    // Fetch current settings so we don't overwrite unrelated keys (calendar hours, theme, etc.)
    const bizData = await fetch("/api/admin/business").then(r => r.json());
    const currentSettings = bizData.settings || {};
    await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, settings: { ...currentSettings, heroVideoUrl } }),
    });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  function setField<K extends keyof Business>(key: K, value: Business[K]) { setForm(p => ({ ...p, [key]: value })); }
  function setSocial(key: string, value: string) { setForm(p => ({ ...p, socialLinks: { ...p.socialLinks, [key]: value } })); }

  return (
    <div className="p-8 overflow-auto h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-900">הגדרות</h1>
        <p className="text-neutral-500 text-sm mt-1">ניהול פרטי עסק, שעות עבודה ותכנים</p>
      </div>

      {/* ── Sub-section hub ── */}
      <div className="mb-6 space-y-3">
        {/* הגדרות עסק */}
        <div>
          <p className="text-xs font-medium text-neutral-400 mb-2 px-0.5">הגדרות עסק</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Link href="/admin/staff"
              className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-xl px-4 py-3 hover:border-teal-300 hover:bg-teal-50/50 hover:shadow-sm transition group">
              <span className="text-xl">✂️</span>
              <span className="text-sm font-medium text-neutral-700 group-hover:text-neutral-900">ספרים</span>
            </Link>
            <Link href="/admin/services"
              className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-xl px-4 py-3 hover:border-teal-300 hover:bg-teal-50/50 hover:shadow-sm transition group">
              <span className="text-xl">💈</span>
              <span className="text-sm font-medium text-neutral-700 group-hover:text-neutral-900">שירותים</span>
            </Link>
          </div>
        </div>

        {/* עיצוב דף הבית */}
        <div>
          <p className="text-xs font-medium text-neutral-400 mb-2 px-0.5">עיצוב דף הבית</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Link href="/admin/stories"
              className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-xl px-4 py-3 hover:border-teal-300 hover:bg-teal-50/50 hover:shadow-sm transition group">
              <span className="text-xl">📸</span>
              <span className="text-sm font-medium text-neutral-700 group-hover:text-neutral-900">סטוריז</span>
            </Link>
            <Link href="/admin/products"
              className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-xl px-4 py-3 hover:border-teal-300 hover:bg-teal-50/50 hover:shadow-sm transition group">
              <span className="text-xl">🛍️</span>
              <span className="text-sm font-medium text-neutral-700 group-hover:text-neutral-900">מוצרים</span>
            </Link>
            <Link href="/admin/announcements"
              className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-xl px-4 py-3 hover:border-teal-300 hover:bg-teal-50/50 hover:shadow-sm transition group">
              <span className="text-xl">📢</span>
              <span className="text-sm font-medium text-neutral-700 group-hover:text-neutral-900">עדכונים</span>
            </Link>
            <Link href="/admin/portfolio"
              className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-xl px-4 py-3 hover:border-teal-300 hover:bg-teal-50/50 hover:shadow-sm transition group">
              <span className="text-xl">🖼️</span>
              <span className="text-sm font-medium text-neutral-700 group-hover:text-neutral-900">גלריית עבודות</span>
            </Link>
          </div>
        </div>

        {/* הודעות */}
        <div>
          <p className="text-xs font-medium text-neutral-400 mb-2 px-0.5">הודעות</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Link href="/admin/templates"
              className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-xl px-4 py-3 hover:border-teal-300 hover:bg-teal-50/50 hover:shadow-sm transition group">
              <span className="text-xl">💬</span>
              <span className="text-sm font-medium text-neutral-700 group-hover:text-neutral-900">תבניות הודעות</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-neutral-100 rounded-xl p-1 mb-6 w-fit">
        {([
          { key: "business", label: "פרטי עסק" },
          { key: "hours",    label: "שעות עבודה" },
          { key: "whatsapp", label: "WhatsApp" },
          { key: "automations", label: "🤖 אוטומציות" },
        ] as { key: "business" | "hours" | "whatsapp" | "automations"; label: string }[]).map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === key ? "bg-white shadow text-neutral-900" : "text-neutral-500"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Business tab ── */}
      {tab === "business" && (
        bizLoading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
          <div className="space-y-5 max-w-xl">
            {/* General */}
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

            {/* Images */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <h2 className="font-semibold text-neutral-800 mb-4">תמונות ועיצוב</h2>
              <div className="space-y-4">
                {/* Logo upload */}
                <div>
                  <label className="text-xs text-neutral-500 block mb-2">לוגו העסק</label>
                  <div className="flex gap-3 items-center">
                    {form.logoUrl ? (
                      <div className="relative group">
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

                {/* Cover image upload */}
                <div>
                  <label className="text-xs text-neutral-500 block mb-2">תמונת רקע (Hero)</label>
                  <div className="space-y-2">
                    {form.coverImageUrl && (
                      <div className="relative group w-full h-28 rounded-xl overflow-hidden border border-neutral-200">
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

                {/* ── Hero Video URL ── */}
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

                {/* ── Login & access management ── */}
                <div className="col-span-2 mb-2 p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <label className="text-sm text-neutral-800 font-semibold block">🔐 כניסה למנהל ראשי</label>
                      <p className="text-[11px] text-neutral-600 mt-0.5">הטלפון שתזין כאן יידרש בעת ההתחברות (יחד עם הסיסמה).</p>
                    </div>
                    {ownerPhoneSaved && <span className="text-[11px] text-green-700 font-semibold">✓ נשמר</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="tel"
                      value={ownerLoginPhone}
                      onChange={e => setOwnerLoginPhone(e.target.value)}
                      placeholder="050-0000000"
                      dir="ltr"
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                    />
                    <button
                      type="button"
                      onClick={saveOwnerLoginPhone}
                      disabled={ownerPhoneSaving || !ownerLoginPhone.trim()}
                      className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-neutral-300 text-white text-sm font-semibold rounded-lg transition"
                    >
                      {ownerPhoneSaving ? "שומר..." : "שמור"}
                    </button>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between">
                    <span className="text-[12px] text-neutral-700">👥 מנהלים משניים (ספרים עם גישה)</span>
                    <a href="/admin/staff" className="text-[12px] font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-2">
                      ניהול גישות ←
                    </a>
                  </div>
                  <p className="text-[10px] text-neutral-500 mt-1.5 leading-relaxed">
                    כל ספר שתגדיר לו סיסמה (דרך עמוד הצוות) יוכל להיכנס עם הטלפון והסיסמה שלו.
                  </p>

                  {/* ── Change password ── */}
                  <div className="mt-4 pt-3 border-t border-slate-200">
                    <p className="text-[12px] text-neutral-800 font-semibold mb-2">🔑 החלפת סיסמה</p>
                    <div className="space-y-2">
                      <input
                        type="password"
                        value={oldPassword}
                        onChange={e => setOldPassword(e.target.value)}
                        placeholder="סיסמה נוכחית"
                        autoComplete="current-password"
                        dir="ltr"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                      />
                      <input
                        type="password"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder="סיסמה חדשה (לפחות 6 תווים)"
                        autoComplete="new-password"
                        dir="ltr"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                      />
                      <input
                        type="password"
                        value={confirmNewPassword}
                        onChange={e => setConfirmNewPassword(e.target.value)}
                        placeholder="אימות סיסמה חדשה"
                        autoComplete="new-password"
                        dir="ltr"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                      />
                      {pwError && (
                        <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
                          {pwError}
                        </p>
                      )}
                      {pwSuccess && (
                        <p className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-1.5">
                          ✓ הסיסמה הוחלפה בהצלחה
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={changePassword}
                        disabled={pwSaving || !oldPassword || !newPassword || !confirmNewPassword}
                        className="w-full px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition"
                      >
                        {pwSaving ? "מחליף..." : "החלף סיסמה"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Theme presets — single source of truth for all colors + fonts ── */}
                <div className="col-span-2">
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
                          {/* Mini preview — shows actual theme rendering */}
                          <div className="p-3" style={{ background: opt.bg }}>
                            {/* Header bar */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="h-1.5 rounded" style={{ background: opt.textPri, width: 32, opacity: 0.7 }} />
                              <div className="h-3 px-2 rounded-full text-[7px] font-bold flex items-center"
                                style={{ background: opt.brand, color: opt.bg }}>CTA</div>
                            </div>
                            {/* Cards row */}
                            <div className="flex gap-1 mb-2">
                              {[1, 2, 3].map(i => (
                                <div key={i} className="flex-1 rounded p-1" style={{ height: 32, background: opt.card, border: `1px solid ${opt.divider}` }}>
                                  <div className="h-1 rounded mb-1" style={{ background: opt.brand, width: "30%" }} />
                                  <div className="h-1 rounded" style={{ background: opt.textSec, width: "70%", opacity: 0.5 }} />
                                </div>
                              ))}
                            </div>
                            {/* Sample text */}
                            <p className="text-[9px] leading-tight" style={{ color: opt.textPri, opacity: 0.85, fontFamily: opt.fontDisplay }}>
                              {opt.name.toUpperCase()}
                            </p>
                          </div>
                          {/* Label strip */}
                          <div className="px-3 py-2 flex items-center justify-between bg-white border-t border-neutral-100">
                            <span className="text-xs font-bold text-neutral-800">{opt.name}</span>
                            <span className="text-[10px] text-neutral-500">{opt.description}</span>
                          </div>
                          {/* Selected checkmark */}
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
              </div>
            </div>

            {/* Booking calendar */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <h2 className="font-semibold text-neutral-800 mb-4">יומן ותורים</h2>
              <div className="space-y-5">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">כמה ימים קדימה היומן פתוח</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number" min={1} max={365}
                      value={form.bookingHorizonDays}
                      onChange={e => setField("bookingHorizonDays", Number(e.target.value))}
                      className="w-24 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    />
                    <span className="text-sm text-neutral-500">ימים</span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    לקוחות יכולים לקבוע תור עד {form.bookingHorizonDays} ימים מהיום (ברירת מחדל: 30)
                  </p>
                </div>

                <div>
                  <label className="text-xs text-neutral-500 block mb-1">זמן מינימלי מעכשיו לקביעת תור</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number" min={0} max={1440}
                      value={form.minBookingLeadMinutes}
                      onChange={e => setField("minBookingLeadMinutes", Number(e.target.value))}
                      className="w-24 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                    />
                    <span className="text-sm text-neutral-500">דקות</span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    {form.minBookingLeadMinutes === 0
                      ? "לקוחות יכולים לקבוע תור ״מעכשיו לעכשיו״"
                      : `לקוחות לא יוכלו לקבוע תור פחות מ-${form.minBookingLeadMinutes} דקות מעכשיו`}
                  </p>
                </div>
              </div>
            </div>

            {/* Calendar display hours */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-neutral-800">שעות תצוגת יומן</h2>
                  <p className="text-xs text-neutral-400 mt-0.5">טווח השעות המוצג ביומן הניהול</p>
                </div>
                <button onClick={saveCalendarHours} disabled={calHoursSaving || calStartHour >= calEndHour}
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${calHoursSaved ? "bg-emerald-100 text-emerald-700" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
                  {calHoursSaving ? "שומר..." : calHoursSaved ? "✓ נשמר" : "שמור"}
                </button>
              </div>
              <div className="flex items-center gap-4 flex-wrap" dir="ltr">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1 text-right">שעת התחלה</label>
                  <select value={calStartHour} onChange={e => setCalStartHour(Number(e.target.value))}
                    className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400">
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2,"0")}:00</option>
                    ))}
                  </select>
                </div>
                <span className="text-neutral-400 text-lg mt-4">→</span>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1 text-right">שעת סיום</label>
                  <select value={calEndHour} onChange={e => setCalEndHour(Number(e.target.value))}
                    className="border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400">
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i} disabled={i <= calStartHour}>{String(i).padStart(2,"0")}:00</option>
                    ))}
                  </select>
                </div>
              </div>
              {calStartHour >= calEndHour && (
                <p className="text-xs text-red-500 mt-2">⚠️ שעת הסיום חייבת להיות אחרי שעת ההתחלה</p>
              )}
            </div>

            {/* Referral sources */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-neutral-800">מקורות הגעה</h2>
                <button onClick={saveReferralSources} disabled={savingReferral}
                  className="text-xs bg-neutral-900 text-white px-3 py-1.5 rounded-lg hover:bg-neutral-700 disabled:opacity-50">
                  {savingReferral ? "שומר..." : "שמור רשימה"}
                </button>
              </div>
              <p className="text-xs text-neutral-400 mb-4">
                האופציות שיופיעו ללקוח ב״מאיפה הכרת אותנו?״ ולך ביומן הניהול
              </p>

              <div className="space-y-2 mb-3">
                {referralSources.map((src, i) => (
                  <div key={i} className="flex items-center gap-2 bg-neutral-50 rounded-xl px-3 py-2">
                    <span className="flex-1 text-sm text-neutral-800">{src}</span>
                    <button onClick={() => moveSource(i, -1)} disabled={i === 0}
                      className="text-neutral-400 hover:text-neutral-600 disabled:opacity-20 text-xs px-1">▲</button>
                    <button onClick={() => moveSource(i, 1)} disabled={i === referralSources.length - 1}
                      className="text-neutral-400 hover:text-neutral-600 disabled:opacity-20 text-xs px-1">▼</button>
                    <button onClick={() => removeSource(i)}
                      className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
                  </div>
                ))}
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
            </div>

            {/* Social */}
            <div className="bg-white rounded-2xl border border-neutral-200 p-6">
              <h2 className="font-semibold text-neutral-800 mb-4">רשתות חברתיות</h2>
              <div className="space-y-3">
                {[
                  { key: "whatsapp", label: "WhatsApp", placeholder: "972501234567", icon: "📱" },
                  { key: "instagram", label: "Instagram", placeholder: "dominant_barbershop", icon: "📸" },
                  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/...", icon: "👍" },
                  { key: "waze", label: "Waze", placeholder: "https://waze.com/...", icon: "🗺️" },
                ].map(({ key, label, placeholder, icon }) => (
                  <div key={key}>
                    <label className="text-xs text-neutral-500 block mb-1">{icon} {label}</label>
                    <input value={(form.socialLinks as Record<string, string>)[key] || ""} onChange={e => setSocial(key, e.target.value)} dir="ltr" placeholder={placeholder}
                      className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
                  </div>
                ))}
              </div>
            </div>

            <button onClick={saveBiz} disabled={saving}
              className={`w-full py-3 rounded-xl text-sm font-semibold transition ${saved ? "bg-emerald-500 text-white" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
              {saving ? "שומר..." : saved ? "✓ נשמר!" : "שמור שינויים"}
            </button>
          </div>
        )
      )}

      {/* ── Hours tab ── */}
      {tab === "hours" && (
        staffLoading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
          <div className="space-y-4 max-w-3xl">
            <p className="text-sm text-neutral-500 mb-2">
              הגדר שעות עבודה קבועות לכל ספר. לשינויים חד-פעמיים — לחץ על כותרת היום ביומן.
            </p>
            {staffList.map(staff => (
              <StaffScheduleEditor key={staff.id} staff={staff} />
            ))}
          </div>
        )
      )}

      {/* ── WhatsApp tab ── */}
      {tab === "whatsapp" && (
        bizLoading ? <div className="text-center py-16 text-neutral-400">טוען...</div> : (
          <WhatsAppTab form={form} setField={setField} onSaved={saveBiz} saving={saving} saved={saved} />
        )
      )}

      {/* ── Automations tab ── */}
      {tab === "automations" && <AutomationsTab />}
    </div>
  );
}

// ── ReminderTemplateEditor ─────────────────────────────────────────────────────
function ReminderTemplateEditor({
  label, emoji, description, proNote,
  enabled, onToggle,
  value, onChange, defaultTemplate,
}: {
  label: string; emoji: string; description: string; proNote?: string;
  enabled: boolean; onToggle: () => void;
  value: string; onChange: (v: string) => void;
  defaultTemplate: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const displayValue = value || defaultTemplate;

  return (
    <div className={`rounded-xl border transition ${enabled ? "border-neutral-200 bg-white" : "border-neutral-100 bg-neutral-50/50"}`}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Toggle */}
        <button
          onClick={onToggle}
          className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${enabled ? "bg-emerald-500" : "bg-neutral-200"}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${enabled ? "right-0.5" : "left-0.5"}`} />
        </button>

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${enabled ? "text-neutral-800" : "text-neutral-400"}`}>
            {emoji} {label}
          </p>
          <p className="text-xs text-neutral-400 truncate">{description}</p>
        </div>

        {/* Expand/collapse edit button */}
        <button
          onClick={() => setExpanded(x => !x)}
          className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1 rounded-lg hover:bg-neutral-100 transition flex items-center gap-1 shrink-0"
        >
          ✏️ ערוך טקסט
          <span className="text-[10px]">{expanded ? "▲" : "▼"}</span>
        </button>
      </div>

      {/* Expandable template editor */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-neutral-100 pt-3 space-y-2">
          {proNote && (
            <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700">
              <span>⚠️</span>
              <span>{proNote}</span>
            </div>
          )}
          <textarea
            value={displayValue}
            onChange={e => onChange(e.target.value)}
            rows={7}
            dir="rtl"
            className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
          />
          {/* Variables hint */}
          <div className="flex flex-wrap gap-1.5">
            {[
              ["{{name}}", "שם לקוח"],
              ["{{business}}", "שם עסק"],
              ["{{staff}}", "שם ספר"],
              ["{{date}}", "תאריך"],
              ["{{time}}", "שעה"],
              ["{{address_line}}", "כתובת"],
            ].map(([placeholder, label]) => (
              <button
                key={placeholder}
                onClick={() => onChange(displayValue + placeholder)}
                title={`הוסף ${label}`}
                className="text-[11px] bg-neutral-100 hover:bg-neutral-200 text-neutral-600 px-2 py-0.5 rounded-md font-mono transition"
              >
                {placeholder}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-400">
            לחץ על משתנה כדי להוסיף אותו לסוף הטקסט. ניתן למקם אותו ידנית בכל מקום.
          </p>
          {value && (
            <button
              onClick={() => onChange("")}
              className="text-xs text-red-400 hover:text-red-600 transition"
            >
              ↺ החזר לברירת מחדל
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Re-engagement Template Editor ─────────────────────────────────────────────
function ReengageEditor({
  form, setField,
}: {
  form: Business;
  setField: <K extends keyof Business>(key: K, value: Business[K]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const displayValue = form.reengageTemplate || DEFAULT_REENGAGE_TEMPLATE;

  return (
    <div className={`rounded-xl border transition ${form.reengageEnabled ? "border-neutral-200 bg-white" : "border-neutral-100 bg-neutral-50/50"}`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setField("reengageEnabled", !form.reengageEnabled)}
          className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${form.reengageEnabled ? "bg-emerald-500" : "bg-neutral-200"}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${form.reengageEnabled ? "right-0.5" : "left-0.5"}`} />
        </button>

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${form.reengageEnabled ? "text-neutral-800" : "text-neutral-400"}`}>
            🔁 החזרת לקוחות לא פעילים
          </p>
          <p className="text-xs text-neutral-400 truncate">
            שלח הודעה אוטומטית ללקוחות שלא ביקרו — מופעל על ידי cron יומי
          </p>
        </div>

        <button
          onClick={() => setExpanded(x => !x)}
          className="text-xs text-neutral-400 hover:text-neutral-600 px-2 py-1 rounded-lg hover:bg-neutral-100 transition flex items-center gap-1 shrink-0"
        >
          ✏️ ערוך
          <span className="text-[10px]">{expanded ? "▲" : "▼"}</span>
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-neutral-100 pt-3 space-y-3">
          {/* Weeks threshold */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">שלח הודעה אחרי</label>
            <div className="flex items-center gap-2">
              <input
                type="number" min={1} max={52}
                value={form.reengageWeeks}
                onChange={e => setField("reengageWeeks", Number(e.target.value))}
                className="w-20 border border-neutral-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <span className="text-sm text-neutral-600">שבועות ללא ביקור</span>
            </div>
          </div>

          {/* Template */}
          <div>
            <label className="text-xs text-neutral-500 block mb-1">טקסט ההודעה</label>
            <textarea
              value={displayValue}
              onChange={e => setField("reengageTemplate", e.target.value)}
              rows={6}
              dir="rtl"
              className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
            />
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {[
                ["{{name}}", "שם לקוח"],
                ["{{business}}", "שם עסק"],
                ["{{booking_link}}", "קישור לאתר"],
              ].map(([placeholder, label]) => (
                <button
                  key={placeholder}
                  onClick={() => setField("reengageTemplate", displayValue + placeholder)}
                  title={`הוסף ${label}`}
                  className="text-[11px] bg-neutral-100 hover:bg-neutral-200 text-neutral-600 px-2 py-0.5 rounded-md font-mono transition"
                >
                  {placeholder}
                </button>
              ))}
            </div>
          </div>

          {form.reengageTemplate && (
            <button
              onClick={() => setField("reengageTemplate", "")}
              className="text-xs text-red-400 hover:text-red-600 transition"
            >
              ↺ החזר לברירת מחדל
            </button>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700">
            ⚠️ הגדר cron יומי שיפנה ל: <code className="font-mono">/api/cron/reengage?secret=CRON_SECRET</code>
          </div>
        </div>
      )}
    </div>
  );
}

// ── WhatsApp Tab ───────────────────────────────────────────────────────────────
function WhatsAppTab({
  form, setField, onSaved, saving, saved,
}: {
  form: Business;
  setField: <K extends keyof Business>(key: K, value: Business[K]) => void;
  onSaved: () => void;
  saving: boolean;
  saved: boolean;
}) {
  const [testPhone, setTestPhone] = useState(form.phone || "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/messaging/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: testPhone }),
      });
      const data = await res.json();
      setTestResult({ ok: !!data.ok, error: data.error });
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : "error" });
    }
    setTesting(false);
  }

  const configured = !!(form.greenApiInstanceId && form.greenApiToken);

  return (
    <div className="space-y-5 max-w-xl">
      {/* Credentials */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-neutral-800">חיבור WhatsApp</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full ${configured ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
            {configured ? "✓ מחובר" : "לא מוגדר"}
          </span>
        </div>
        <p className="text-xs text-neutral-500 mb-4">
          הזן את פרטי ה-Green API של המספר העסקי. ההודעות (תזכורות, אישורים) יישלחו ממספר זה.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-neutral-500 block mb-1">ספק הודעות</label>
            <select value={form.messagingProvider} onChange={e => setField("messagingProvider", e.target.value)}
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm">
              <option value="green_api">Green API (לא רשמי)</option>
              <option value="none" disabled>Meta Cloud (רשמי — בקרוב)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">מספר WhatsApp של העסק</label>
            <input value={form.whatsappNumber} onChange={e => setField("whatsappNumber", e.target.value)}
              dir="ltr" placeholder="972501234567"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            <p className="text-[11px] text-neutral-400 mt-1">פורמט בינלאומי, ללא פלוס או אפס מוביל</p>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Instance ID</label>
            <input value={form.greenApiInstanceId} onChange={e => setField("greenApiInstanceId", e.target.value)}
              dir="ltr" placeholder="1101234567"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">API Token</label>
            <input type="password" value={form.greenApiToken} onChange={e => setField("greenApiToken", e.target.value)}
              dir="ltr" placeholder="••••••••"
              className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
        </div>
      </div>

      {/* Automations & templates */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-neutral-800">אוטומציות</h2>
        </div>
        <p className="text-xs text-neutral-500 mb-4">
          בחר אילו הודעות לשלוח ועצב את הטקסט שלהן.
        </p>

        {/* Master toggle — confirmations */}
        <div className="flex items-start gap-3 pb-4 mb-4 border-b border-neutral-100">
          <input type="checkbox" checked={form.features.reminders}
            onChange={e => setField("features", { ...form.features, reminders: e.target.checked })}
            className="accent-emerald-500 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-neutral-800">✅ אישור מיידי</p>
            <p className="text-xs text-neutral-500">נשלח ברגע שנקבע תור (מהאתר או מהאדמין)</p>
          </div>
        </div>

        <div className="space-y-3">
          {/* 24h reminder */}
          <ReminderTemplateEditor
            label="תזכורת 24 שעות לפני"
            emoji="🔔"
            description="נשלחת יום לפני התור, ב-10:00 בבוקר"
            enabled={form.features.reminder_24h}
            onToggle={() => setField("features", { ...form.features, reminder_24h: !form.features.reminder_24h })}
            value={form.reminder24hTemplate}
            onChange={v => setField("reminder24hTemplate", v)}
            defaultTemplate={DEFAULT_24H_TEMPLATE}
          />

          {/* 2h reminder */}
          <ReminderTemplateEditor
            label="תזכורת שעתיים לפני"
            emoji="⏰"
            description="נשלחת כ-2 שעות לפני התור"
            proNote="דורש הרצת cron כל שעה. ב-Vercel Hobby — הגדר שירות חיצוני (cron-job.org) שיפנה כל שעה לכתובת /api/cron/reminders-2h עם ה-CRON_SECRET."
            enabled={form.features.reminder_2h}
            onToggle={() => setField("features", { ...form.features, reminder_2h: !form.features.reminder_2h })}
            value={form.reminder2hTemplate}
            onChange={v => setField("reminder2hTemplate", v)}
            defaultTemplate={DEFAULT_2H_TEMPLATE}
          />

          {/* AI agent — link to dedicated page */}
          <div className="flex items-start gap-3 pt-1">
            <span className="text-lg mt-0.5">🤖</span>
            <div>
              <p className="text-sm font-semibold text-neutral-800">סוכן AI</p>
              <p className="text-xs text-neutral-500 mb-1">מענה אוטומטי וקביעת תורים ישירות מ-WhatsApp</p>
              <a href="/admin/agent" className="text-xs text-slate-800 hover:text-slate-700 font-medium underline">
                עבור להגדרות הסוכן ←
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Re-engagement automation */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-neutral-800">אוטומציה — החזרת לקוחות</h2>
        </div>
        <p className="text-xs text-neutral-500 mb-4">
          שלח הודעה ללקוחות שלא ביקרו כבר זמן מה — נדרש הגדרת cron יומי.
        </p>
        <ReengageEditor form={form} setField={setField} />
      </div>

      {/* Chats — bidirectional WhatsApp */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setField("chatsEnabled", !form.chatsEnabled)}
            className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${form.chatsEnabled ? "bg-teal-500" : "bg-neutral-200"}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${form.chatsEnabled ? "right-0.5" : "left-0.5"}`} />
          </button>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${form.chatsEnabled ? "text-neutral-800" : "text-neutral-400"}`}>
              💬 שיחות עם לקוחות
            </p>
            <p className="text-xs text-neutral-400">
              נהל שיחות WhatsApp עם הלקוחות מתוך המערכת — בלי להיות מחובר ישירות לוואצאפ.
              היסטוריית שיחות נשמרת ל-7 ימים אחורה.
            </p>
          </div>
        </div>
      </div>

      {/* Save */}
      <button onClick={onSaved} disabled={saving}
        className={`w-full py-3 rounded-xl text-sm font-semibold transition ${saved ? "bg-emerald-500 text-white" : "bg-teal-600 text-white hover:bg-teal-700"} disabled:opacity-50`}>
        {saving ? "שומר..." : saved ? "✓ נשמר!" : "שמור שינויים"}
      </button>

      {/* Test send */}
      {configured && (
        <div className="bg-neutral-50 rounded-2xl border border-dashed border-neutral-300 p-6">
          <h3 className="font-semibold text-neutral-800 mb-2">🧪 שלח הודעת בדיקה</h3>
          <p className="text-xs text-neutral-500 mb-3">בדוק שההגדרות נכונות על ידי שליחת הודעה לטלפון שלך</p>
          <div className="flex gap-2">
            <input value={testPhone} onChange={e => setTestPhone(e.target.value)}
              placeholder="0501234567" dir="ltr"
              className="flex-1 border border-neutral-200 rounded-lg px-3 py-2 text-sm" />
            <button onClick={runTest} disabled={testing || !testPhone}
              className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-400 disabled:opacity-50">
              {testing ? "שולח..." : "שלח"}
            </button>
          </div>
          {testResult && (
            <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${testResult.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
              {testResult.ok ? "✓ נשלח בהצלחה!" : `❌ ${testResult.error || "שגיאה"}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Automations sub-panels ─────────────────────────────────────────────────────

function ReengagePanelSettings({
  settings, saving, onSave,
}: {
  settings: Record<string, unknown>;
  saving: boolean;
  onSave: (s: object) => void;
}) {
  const [weeks,   setWeeks]   = useState((settings.inactiveWeeks as number)          ?? 6);
  const [exclude, setExclude] = useState((settings.excludeWithFutureAppt as boolean) ?? true);
  const [segment, setSegment] = useState((settings.segment as string)                ?? "all");
  const [dirty,   setDirty]   = useState(false);
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-neutral-500 block mb-1">שלח אחרי כמה שבועות ללא ביקור</label>
        <div className="flex items-center gap-3">
          <input type="range" min={2} max={24} value={weeks}
            onChange={e => { setWeeks(Number(e.target.value)); setDirty(true); }}
            className="flex-1 accent-slate-900" />
          <span className="text-slate-800 font-bold text-sm w-24 text-center">{weeks} שבועות</span>
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={exclude}
          onChange={e => { setExclude(e.target.checked); setDirty(true); }}
          className="accent-emerald-500" />
        <span className="text-sm text-neutral-600">אל תשלח ללקוחות עם תור עתידי</span>
      </label>
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">למי לשלח</label>
        <div className="flex gap-2">
          {([["all","כולם"],["new_only","חדשים בלבד"],["regular_only","קבועים בלבד"]] as [string,string][]).map(([v,l]) => (
            <button key={v} onClick={() => { setSegment(v); setDirty(true); }}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${segment === v ? "border-teal-600 bg-slate-50 text-slate-700" : "border-neutral-200 text-neutral-500 hover:border-slate-300"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {dirty && (
        <button onClick={() => { onSave({ inactiveWeeks: weeks, excludeWithFutureAppt: exclude, segment }); setDirty(false); }}
          disabled={saving}
          className="text-xs bg-teal-600 text-white px-4 py-1.5 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50">
          {saving ? "שומר..." : "שמור הגדרות"}
        </button>
      )}
    </div>
  );
}

function PostFirstPanelSettings({
  settings, saving, onSave,
}: {
  settings: Record<string, unknown>;
  saving: boolean;
  onSave: (s: object) => void;
}) {
  const [ctaType, setCtaType] = useState((settings.ctaType as string) ?? "google_review");
  const [ctaUrl,  setCtaUrl]  = useState((settings.ctaUrl  as string) ?? "");
  const [delayMinutes, setDelayMinutes] = useState((settings.delayMinutes as number) ?? 30);
  const [dirty,   setDirty]   = useState(false);
  const CTA_OPTIONS = [
    { value: "google_review", label: "⭐ גוגל",      placeholder: "https://g.page/r/..." },
    { value: "instagram",     label: "📸 אינסטגרם", placeholder: "https://instagram.com/..." },
    { value: "custom",        label: "🔗 מותאם",    placeholder: "https://..." },
  ];
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">השהייה אחרי סיום התור</label>
        <div className="flex items-center gap-3">
          <input type="number" min={0} max={1440} value={delayMinutes}
            onChange={e => { setDelayMinutes(Number(e.target.value)); setDirty(true); }}
            className="w-24 border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          <span className="text-sm text-neutral-500">דקות</span>
        </div>
        <p className="text-[10px] text-neutral-400 mt-1">ההודעה תישלח לאחר {delayMinutes} דקות מסיום התור</p>
      </div>
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">קריאה לפעולה (CTA)</label>
        <div className="flex gap-2">
          {CTA_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => { setCtaType(opt.value); setDirty(true); }}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${ctaType === opt.value ? "border-teal-600 bg-slate-50 text-slate-700" : "border-neutral-200 text-neutral-500 hover:border-slate-300"}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs text-neutral-500 block mb-1">קישור</label>
        <input type="url" value={ctaUrl} dir="ltr"
          onChange={e => { setCtaUrl(e.target.value); setDirty(true); }}
          placeholder={CTA_OPTIONS.find(o => o.value === ctaType)?.placeholder}
          className="w-full border border-neutral-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
      </div>
      {dirty && (
        <button onClick={() => { onSave({ ctaType, ctaUrl, delayMinutes }); setDirty(false); }}
          disabled={saving}
          className="text-xs bg-teal-600 text-white px-4 py-1.5 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50">
          {saving ? "שומר..." : "שמור הגדרות"}
        </button>
      )}
    </div>
  );
}

function PostEveryPanelSettings({
  settings, saving, onSave,
}: {
  settings: Record<string, unknown>;
  saving: boolean;
  onSave: (s: object) => void;
}) {
  const [segment,   setSegment]   = useState((settings.segment   as string) ?? "regular_only");
  const [minVisits, setMinVisits] = useState((settings.minVisits as number) ?? 2);
  const [delayMinutes, setDelayMinutes] = useState((settings.delayMinutes as number) ?? 60);
  const [dirty,     setDirty]     = useState(false);
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">השהייה אחרי סיום התור</label>
        <div className="flex items-center gap-3">
          <input type="number" min={0} max={1440} value={delayMinutes}
            onChange={e => { setDelayMinutes(Number(e.target.value)); setDirty(true); }}
            className="w-24 border border-neutral-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          <span className="text-sm text-neutral-500">דקות</span>
        </div>
        <p className="text-[10px] text-neutral-400 mt-1">ההודעה תישלח לאחר {delayMinutes} דקות מסיום התור</p>
      </div>
      <div>
        <label className="text-xs text-neutral-500 block mb-1.5">למי לשלח</label>
        <div className="flex gap-2">
          {([["all","כולם"],["new_only","חדשים בלבד"],["regular_only","קבועים בלבד"]] as [string,string][]).map(([v,l]) => (
            <button key={v} onClick={() => { setSegment(v); setDirty(true); }}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${segment === v ? "border-teal-600 bg-slate-50 text-slate-700" : "border-neutral-200 text-neutral-500 hover:border-slate-300"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {segment === "regular_only" && (
        <div>
          <label className="text-xs text-neutral-500 block mb-1">מינימום ביקורים לשליחה</label>
          <div className="flex items-center gap-3">
            <input type="range" min={2} max={10} value={minVisits}
              onChange={e => { setMinVisits(Number(e.target.value)); setDirty(true); }}
              className="flex-1 accent-slate-900" />
            <span className="text-slate-800 font-bold text-sm w-12 text-center">{minVisits}+</span>
          </div>
        </div>
      )}
      {dirty && (
        <button onClick={() => { onSave({ segment, minVisits, delayMinutes }); setDirty(false); }}
          disabled={saving}
          className="text-xs bg-teal-600 text-white px-4 py-1.5 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50">
          {saving ? "שומר..." : "שמור הגדרות"}
        </button>
      )}
    </div>
  );
}

// ── AutoPanel (shared light-themed card) ───────────────────────────────────────

function AutoPanel({
  emoji, title, subtitle, active, saving, onToggle, template, vars, defaultTemplate, onSave, onTest, children,
}: {
  emoji: string; title: string; subtitle: string;
  active: boolean; saving: boolean;
  onToggle: () => void;
  template: string | null; vars: string[]; defaultTemplate: string;
  onSave: (patch: Record<string, unknown>) => void;
  onTest?: () => void;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [localTpl,  setLocalTpl]  = useState(template ?? "");
  const [tplDirty,  setTplDirty]  = useState(false);
  const display = localTpl || defaultTemplate;

  return (
    <div className={`rounded-2xl border overflow-hidden transition ${active ? "border-neutral-200 bg-white" : "border-neutral-100 bg-neutral-50/60"}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">{emoji}</span>
          <div>
            <p className={`text-sm font-semibold ${active ? "text-neutral-800" : "text-neutral-400"}`}>{title}</p>
            <p className="text-xs text-neutral-400 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <button onClick={onToggle} disabled={saving}
          className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${active ? "bg-emerald-500" : "bg-neutral-200"} disabled:opacity-50`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${active ? "right-0.5" : "left-0.5"}`} />
        </button>
      </div>

      {/* Test button — visible when active */}
      {active && onTest && (
        <div className="px-5 pb-3 -mt-1">
          <button onClick={onTest}
            className="text-xs bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-lg font-semibold transition">
            🧪 שלח הודעת בדיקה
          </button>
        </div>
      )}

      {/* Type-specific settings */}
      {children && (
        <div className="px-5 pb-4 border-t border-neutral-100 pt-4 space-y-3">
          {children}
        </div>
      )}

      {/* Template editor */}
      <div className="px-5 pb-4 border-t border-neutral-100 pt-3">
        <button onClick={() => setExpanded(x => !x)}
          className="text-xs text-neutral-500 hover:text-neutral-700 flex items-center gap-1.5 mb-2 transition">
          ✏️ ערוך תבנית הודעה
          <span className="text-[10px]">{expanded ? "▲" : "▼"}</span>
        </button>
        {expanded && (
          <div className="space-y-2">
            <textarea value={display}
              onChange={e => { setLocalTpl(e.target.value); setTplDirty(true); }}
              rows={5} dir="rtl"
              className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {vars.map(v => (
                <button key={v} onClick={() => { setLocalTpl(display + v); setTplDirty(true); }}
                  className="text-[11px] bg-neutral-100 hover:bg-neutral-200 text-neutral-600 px-2 py-0.5 rounded-md font-mono transition">
                  {v}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              {tplDirty && (
                <button onClick={() => { onSave({ template: localTpl || null }); setTplDirty(false); }}
                  disabled={saving}
                  className="text-xs bg-teal-600 text-white px-4 py-1.5 rounded-lg font-semibold hover:bg-teal-700 disabled:opacity-50">
                  {saving ? "שומר..." : "שמור תבנית"}
                </button>
              )}
              {localTpl && (
                <button onClick={() => { setLocalTpl(""); setTplDirty(true); }}
                  className="text-xs text-red-400 hover:text-red-600 transition">
                  ↺ ברירת מחדל
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AutomationsTab ─────────────────────────────────────────────────────────────

function AutomationsTab() {
  const [autos,   setAutos]   = useState<AutoRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState<AutoType | null>(null);
  const [toast,   setToast]   = useState("");

  useEffect(() => {
    fetch("/api/admin/automations").then(r => r.json())
      .then(d => { setAutos(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const get = (t: AutoType) => autos.find(a => a.type === t) ?? null;

  function showToast() {
    setToast("✅ נשמר בהצלחה");
    setTimeout(() => setToast(""), 2500);
  }

  async function upsert(type: AutoType, patch: Record<string, unknown>) {
    setSaving(type);
    let rec = get(type);
    if (!rec) {
      const created: AutoRec = await fetch("/api/admin/automations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, name: AUTO_NAMES[type], active: false, settings: AUTO_DEFAULT_SETTINGS[type] }),
      }).then(r => r.json());
      setAutos(p => [...p, created]);
      rec = created;
    }
    const updated: AutoRec = await fetch(`/api/admin/automations/${rec.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(r => r.json());
    setAutos(p => p.map(a => a.id === updated.id ? updated : a));
    setSaving(null);
    showToast();
  }

  function toggle(type: AutoType) {
    const cur = get(type)?.active ?? false;
    // Optimistic update
    setAutos(p => p.map(a => a.type === type ? { ...a, active: !cur } : a));
    // If no record yet, add placeholder so UI reacts immediately
    if (!get(type)) {
      setAutos(p => [...p, { id: "__tmp__", type, name: AUTO_NAMES[type], active: true, settings: JSON.stringify(AUTO_DEFAULT_SETTINGS[type]), template: null }]);
    }
    upsert(type, { active: !cur });
  }

  // ── Test send ──────────────────────────────────────────────────────────────
  async function testAutomation(type: AutoType) {
    const rec = get(type);
    if (!rec || rec.id === "__tmp__") {
      alert("יש לשמור את האוטומציה לפני שליחת בדיקה (הפעל ושמור הגדרות)");
      return;
    }
    const phone = prompt("הזן מספר טלפון לקבלת הודעת בדיקה (השאר ריק לשליחה למספר העסק):") ?? "";
    const res = await fetch(`/api/admin/automations/${rec.id}/test`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone.trim() || undefined }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      alert(`✓ נשלחה הודעת בדיקה ל-${data.sentTo}`);
    } else {
      alert(`✗ שגיאה: ${data.error || "שליחה נכשלה"}`);
    }
  }

  if (loading) return <div className="text-center py-16 text-neutral-400">טוען...</div>;

  const reengage  = get("reengage");
  const postFirst = get("post_first_visit");
  const postEvery = get("post_every_visit");

  return (
    <div className="space-y-4 max-w-xl">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-900 border border-emerald-600 text-emerald-300 text-sm font-medium px-5 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <p className="text-xs text-neutral-500">
        האוטומציות שולחות הודעות WhatsApp. ודא שהחיבור מוגדר בלשונית WhatsApp.
      </p>

      {/* Re-engagement */}
      <AutoPanel
        emoji="🔄" title="החזרת לקוחות לא פעילים"
        subtitle="שולח ללקוחות שלא ביקרו זמן רב — דורש cron יומי"
        active={reengage?.active ?? false}
        saving={saving === "reengage"}
        onToggle={() => toggle("reengage")}
        template={reengage?.template ?? null}
        vars={["{{name}}", "{{business}}", "{{booking_url}}"]}
        defaultTemplate={"שלום {{name}} 👋\n\nהתגעגענו אליך ב*{{business}}* ✂️\nבוא נקבע תור: {{booking_url}}"}
        onSave={patch => upsert("reengage", patch)}
        onTest={() => testAutomation("reengage")}
      >
        <ReengagePanelSettings
          settings={parseAutoS(reengage?.settings ?? "{}")}
          saving={saving === "reengage"}
          onSave={s => upsert("reengage", { settings: s })}
        />
      </AutoPanel>

      {/* Post first visit */}
      <AutoPanel
        emoji="🌟" title="קידום חכם — לקוח חדש"
        subtitle="נשלח אחרי הביקור הראשון — אוטומטי לפי שעת סיום התור"
        active={postFirst?.active ?? false}
        saving={saving === "post_first_visit"}
        onToggle={() => toggle("post_first_visit")}
        template={postFirst?.template ?? null}
        vars={["{{name}}", "{{business}}", "{{staff}}", "{{service}}", "{{cta}}"]}
        defaultTemplate={"שלום {{name}} 👋\n\nתודה שביקרת לראשונה ב*{{business}}* ✂️\nנשמח לראותך שוב! {{cta}}"}
        onSave={patch => upsert("post_first_visit", patch)}
        onTest={() => testAutomation("post_first_visit")}
      >
        <PostFirstPanelSettings
          settings={parseAutoS(postFirst?.settings ?? "{}")}
          saving={saving === "post_first_visit"}
          onSave={s => upsert("post_first_visit", { settings: s })}
        />
      </AutoPanel>

      {/* Post every visit */}
      <AutoPanel
        emoji="💬" title="הודעה אחרי כל ביקור"
        subtitle="תודה / follow-up אחרי כל תור — אוטומטי לפי שעת סיום"
        active={postEvery?.active ?? false}
        saving={saving === "post_every_visit"}
        onToggle={() => toggle("post_every_visit")}
        template={postEvery?.template ?? null}
        vars={["{{name}}", "{{business}}", "{{staff}}", "{{service}}"]}
        defaultTemplate={"שלום {{name}} 👋\n\nתודה שביקרת ב*{{business}}* ✂️\nנתראה בפעם הבאה! 😊"}
        onSave={patch => upsert("post_every_visit", patch)}
        onTest={() => testAutomation("post_every_visit")}
      >
        <PostEveryPanelSettings
          settings={parseAutoS(postEvery?.settings ?? "{}")}
          saving={saving === "post_every_visit"}
          onSave={s => upsert("post_every_visit", { settings: s })}
        />
      </AutoPanel>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-emerald-800">
        ✓ <strong>cron אוטומטי</strong> — החזרת לקוחות רץ יומית ב-11:00,
        אוטומציות אחרי ביקור נבדקות כל 15 דקות. כפתור 🧪 שולח הודעת בדיקה לטלפון שלך.
      </div>
    </div>
  );
}
