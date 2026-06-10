"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { THEMES, type ThemeId } from "@/lib/themes";

/**
 * Onboarding wizard — runs once for a freshly-signed-up owner.
 *
 * Every step is SKIPPABLE and everything is editable later from /admin/settings.
 * Progress is persisted to `settings.onboarding` ({ step, doneSteps }) via
 * PATCH /api/admin/settings (which merges), so a refresh resumes where the owner
 * left off. "Finish" calls POST /api/admin/onboarding/complete which stamps
 * `onboardingCompletedAt` — the /admin layout uses that to stop redirecting here.
 *
 * Reuses existing admin APIs only — no bespoke onboarding endpoints beyond the
 * completion stamp.
 */

const STEPS = [
  { key: "business", title: "פרטי העסק", icon: "🏪" },
  { key: "branding", title: "לוגו ותמונה", icon: "🖼️" },
  { key: "theme", title: "עיצוב", icon: "🎨" },
  { key: "service", title: "שירות ראשון", icon: "✂️" },
  { key: "staff", title: "ספר ראשון", icon: "💈" },
  { key: "done", title: "סיום", icon: "🎉" },
] as const;

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export default function OnboardingPage() {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [doneSteps, setDoneSteps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Resolved business identity (for the final public-link reveal)
  const [slug, setSlug] = useState<string | null>(null);

  // ── Step 1: business ──
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  // ── Step 2: branding ──
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);

  // ── Step 3: theme ──
  const [themePreset, setThemePreset] = useState<ThemeId>("onyx");

  // ── Step 4: first service ──
  const [svcName, setSvcName] = useState("");
  const [svcPrice, setSvcPrice] = useState("");
  const [svcDuration, setSvcDuration] = useState("30");
  const [createdServiceId, setCreatedServiceId] = useState<string | null>(null);

  // ── Step 5: first staff ──
  const [staffName, setStaffName] = useState("");
  const [staffPhone, setStaffPhone] = useState("");
  // Simple weekday working toggles (Sun–Thu on by default), single 09–20 slot.
  const [workDays, setWorkDays] = useState<boolean[]>([true, true, true, true, true, false, false]);
  const [dayStart, setDayStart] = useState("09:00");
  const [dayEnd, setDayEnd] = useState("20:00");

  // ── Load existing data + saved progress ──
  useEffect(() => {
    (async () => {
      try {
        const [bizRes, meRes] = await Promise.all([
          fetch("/api/admin/business"),
          fetch("/api/admin/me"),
        ]);
        if (bizRes.ok) {
          const biz = await bizRes.json();
          if (biz) {
            setName(biz.name || "");
            setPhone(biz.phone || "");
            setLogoUrl(biz.logoUrl || null);
            setCoverImageUrl(biz.coverImageUrl || null);
            const s = biz.settings || {};
            if (s.themePreset && s.themePreset in THEMES) setThemePreset(s.themePreset);
            if (s.onboarding) {
              if (typeof s.onboarding.step === "number") {
                setStep(Math.min(Math.max(s.onboarding.step, 0), STEPS.length - 1));
              }
              if (Array.isArray(s.onboarding.doneSteps)) setDoneSteps(s.onboarding.doneSteps);
            }
          }
        }
        if (meRes.ok) {
          const me = await meRes.json();
          if (me?.slug) setSlug(me.slug);
        }
      } catch {
        /* ignore — wizard still works with empty fields */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Persist progress (best-effort) — merges into settings.onboarding.
  const saveProgress = useCallback(async (nextStep: number, nextDone: string[]) => {
    try {
      await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboarding: { step: nextStep, doneSteps: nextDone } }),
      });
    } catch {
      /* progress save is best-effort */
    }
  }, []);

  const goTo = useCallback((next: number, markDone?: string) => {
    setError("");
    const clamped = Math.min(Math.max(next, 0), STEPS.length - 1);
    let nextDone = doneSteps;
    if (markDone && !doneSteps.includes(markDone)) {
      nextDone = [...doneSteps, markDone];
      setDoneSteps(nextDone);
    }
    setStep(clamped);
    saveProgress(clamped, nextDone);
  }, [doneSteps, saveProgress]);

  const skip = () => goTo(step + 1);

  // ── Image upload helper ──
  const uploadImage = async (file: File): Promise<string | null> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url || null;
  };

  // ── Step handlers ──
  const saveBusiness = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      if (!res.ok) { setError("שמירת פרטי העסק נכשלה"); setBusy(false); return; }
      goTo(step + 1, "business");
    } catch { setError("שגיאת רשת"); }
    setBusy(false);
  };

  const saveBranding = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl, coverImageUrl }),
      });
      if (!res.ok) { setError("שמירת התמונות נכשלה"); setBusy(false); return; }
      goTo(step + 1, "branding");
    } catch { setError("שגיאת רשת"); }
    setBusy(false);
  };

  const saveTheme = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themePreset }),
      });
      if (!res.ok) { setError("שמירת העיצוב נכשלה"); setBusy(false); return; }
      goTo(step + 1, "theme");
    } catch { setError("שגיאת רשת"); }
    setBusy(false);
  };

  const saveService = async () => {
    if (!svcName.trim()) { setError("נא להזין שם שירות"); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: svcName.trim(),
          price: parseFloat(svcPrice) || 0,
          durationMinutes: parseInt(svcDuration) || 30,
        }),
      });
      if (!res.ok) { setError("יצירת השירות נכשלה"); setBusy(false); return; }
      const svc = await res.json();
      setCreatedServiceId(svc.id);
      goTo(step + 1, "service");
    } catch { setError("שגיאת רשת"); }
    setBusy(false);
  };

  const saveStaff = async () => {
    if (!staffName.trim()) { setError("נא להזין שם ספר"); return; }
    setBusy(true); setError("");
    try {
      // 1) create the barber
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: staffName.trim(), phone: staffPhone || undefined }),
      });
      if (!res.ok) { setError("יצירת הספר נכשלה"); setBusy(false); return; }
      const staff = await res.json();

      // 2) weekly schedule (single 09–20 slot per working day)
      const days = DAYS.map((_, i) => ({
        dayOfWeek: i,
        isWorking: workDays[i],
        start: dayStart,
        end: dayEnd,
      }));
      await fetch(`/api/admin/staff/${staff.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(days),
      });

      // 3) assign the first service so the barber appears on the storefront
      //    (/api/staff only returns barbers with ≥1 service).
      if (createdServiceId) {
        await fetch(`/api/admin/staff/${staff.id}/services`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serviceId: createdServiceId, enabled: true }),
        });
      }

      goTo(step + 1, "staff");
    } catch { setError("שגיאת רשת"); }
    setBusy(false);
  };

  const finish = async () => {
    setBusy(true); setError("");
    try {
      await fetch("/api/admin/onboarding/complete", { method: "POST" });
      router.push("/admin");
      router.refresh();
    } catch {
      setError("שגיאה בסיום");
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <div className="text-neutral-500 text-sm">טוען...</div>
      </div>
    );
  }

  const current = STEPS[step];
  const progress = Math.round((step / (STEPS.length - 1)) * 100);

  return (
    <div className="min-h-screen bg-neutral-950 text-white font-heebo px-4 py-8" dir="rtl">
      <div className="max-w-lg mx-auto">

        {/* ── Progress ── */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-neutral-400">
              שלב {step + 1} מתוך {STEPS.length}
            </span>
            <button
              onClick={finish}
              disabled={busy}
              className="text-[12px] text-neutral-500 hover:text-neutral-300 transition disabled:opacity-50"
            >
              סיים והיכנס למערכת ←
            </button>
          </div>
          <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="bg-neutral-900 rounded-2xl border border-neutral-800 p-6">
          <div className="text-center mb-6 space-y-1">
            <div className="text-4xl">{current.icon}</div>
            <h1 className="text-xl font-bold">{current.title}</h1>
          </div>

          {/* ── Step bodies ── */}
          {current.key === "business" && (
            <div className="space-y-4">
              <p className="text-[12px] text-neutral-500 text-center">
                אפשר לשנות הכל אחר כך בהגדרות העסק.
              </p>
              <Field label="שם העסק">
                <input
                  type="text" value={name} onChange={(e) => setName(e.target.value)}
                  className={inputCls} placeholder="המספרה של דני"
                />
              </Field>
              <Field label="טלפון העסק">
                <input
                  type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                  className={inputCls} placeholder="050-0000000" dir="ltr"
                />
              </Field>
            </div>
          )}

          {current.key === "branding" && (
            <div className="space-y-5">
              <ImagePick
                label="לוגו" value={logoUrl} round
                onPick={async (f) => { const u = await uploadImage(f); if (u) setLogoUrl(u); }}
                onClear={() => setLogoUrl(null)}
              />
              <ImagePick
                label="תמונת רקע (קאבר)" value={coverImageUrl}
                onPick={async (f) => { const u = await uploadImage(f); if (u) setCoverImageUrl(u); }}
                onClear={() => setCoverImageUrl(null)}
              />
            </div>
          )}

          {current.key === "theme" && (
            <div className="grid grid-cols-3 gap-3">
              {(Object.values(THEMES)).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setThemePreset(t.id)}
                  className={`rounded-xl p-3 border-2 transition text-right ${
                    themePreset === t.id ? "border-teal-500" : "border-neutral-800 hover:border-neutral-700"
                  }`}
                  style={{ background: t.bg }}
                >
                  <div className="flex gap-1 mb-2">
                    <span className="w-4 h-4 rounded-full" style={{ background: t.brand }} />
                    <span className="w-4 h-4 rounded-full" style={{ background: t.brandSoft }} />
                  </div>
                  <div className="text-[12px] font-bold" style={{ color: t.textPri }}>{t.name}</div>
                  <div className="text-[9px]" style={{ color: t.textMuted }}>{t.description}</div>
                </button>
              ))}
            </div>
          )}

          {current.key === "service" && (
            <div className="space-y-4">
              <p className="text-[12px] text-neutral-500 text-center">
                שירות אחד מספיק כדי להתחיל — אפשר להוסיף עוד בכל רגע.
              </p>
              <Field label="שם השירות">
                <input
                  type="text" value={svcName} onChange={(e) => setSvcName(e.target.value)}
                  className={inputCls} placeholder="תספורת גבר"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="מחיר (₪)">
                  <input
                    type="number" value={svcPrice} onChange={(e) => setSvcPrice(e.target.value)}
                    className={inputCls} placeholder="80" dir="ltr"
                  />
                </Field>
                <Field label="משך (דקות)">
                  <input
                    type="number" value={svcDuration} onChange={(e) => setSvcDuration(e.target.value)}
                    className={inputCls} placeholder="30" dir="ltr"
                  />
                </Field>
              </div>
            </div>
          )}

          {current.key === "staff" && (
            <div className="space-y-4">
              <p className="text-[12px] text-neutral-500 text-center">
                הוסף את עצמך או ספר ראשון. אפשר להוסיף עוד ספרים בהגדרות.
              </p>
              <Field label="שם הספר">
                <input
                  type="text" value={staffName} onChange={(e) => setStaffName(e.target.value)}
                  className={inputCls} placeholder="דני"
                />
              </Field>
              <Field label="טלפון (לא חובה)">
                <input
                  type="tel" value={staffPhone} onChange={(e) => setStaffPhone(e.target.value)}
                  className={inputCls} placeholder="050-0000000" dir="ltr"
                />
              </Field>
              <div>
                <label className="text-sm text-neutral-400 block mb-2">ימי עבודה</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((d, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setWorkDays((w) => w.map((v, j) => j === i ? !v : v))}
                      className={`px-3 py-1.5 rounded-lg text-[12px] transition ${
                        workDays[i] ? "bg-teal-600 text-white" : "bg-neutral-800 text-neutral-400"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="שעת פתיחה">
                  <input type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} className={inputCls} dir="ltr" />
                </Field>
                <Field label="שעת סגירה">
                  <input type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} className={inputCls} dir="ltr" />
                </Field>
              </div>
              {!createdServiceId && (
                <p className="text-[11px] text-amber-400/80 text-center">
                  לא נוצר שירות בשלב הקודם — הספר לא יופיע בדף הציבורי עד ששירות אחד ישויך אליו בהגדרות.
                </p>
              )}
            </div>
          )}

          {current.key === "done" && (
            <div className="space-y-4 text-center">
              <p className="text-neutral-300 text-sm">
                הכל מוכן! דף הזמנת התורים שלך פעיל.
              </p>
              {slug && (
                <div className="bg-neutral-800 rounded-lg p-3">
                  <div className="text-[11px] text-neutral-500 mb-1">הכתובת הציבורית שלך</div>
                  <div className="font-mono text-teal-400 text-sm break-all" dir="ltr">/{slug}</div>
                </div>
              )}
              <div className="bg-teal-500/10 border border-teal-500/30 rounded-lg p-3 text-[12px] text-teal-300 leading-relaxed">
                💬 רוצה תזכורות אוטומטיות בוואטסאפ ללקוחות? אפשר לחבר WhatsApp מתוך ההגדרות בכל עת.
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          {/* ── Footer actions ── */}
          <div className="mt-6 flex items-center gap-3">
            {current.key !== "done" ? (
              <>
                <button
                  onClick={skip}
                  disabled={busy}
                  className="flex-1 py-3 rounded-xl text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 transition disabled:opacity-50"
                >
                  דלג
                </button>
                <button
                  onClick={
                    current.key === "business" ? saveBusiness
                    : current.key === "branding" ? saveBranding
                    : current.key === "theme" ? saveTheme
                    : current.key === "service" ? saveService
                    : saveStaff
                  }
                  disabled={busy}
                  className="flex-[2] py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold transition disabled:bg-neutral-700"
                >
                  {busy ? "שומר..." : "המשך"}
                </button>
              </>
            ) : (
              <button
                onClick={finish}
                disabled={busy}
                className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold transition disabled:bg-neutral-700"
              >
                {busy ? "..." : "כניסה למערכת 🚀"}
              </button>
            )}
          </div>
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 mt-4">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              onClick={() => goTo(i)}
              className={`w-2 h-2 rounded-full transition ${
                i === step ? "bg-teal-500" : doneSteps.includes(s.key) ? "bg-teal-700" : "bg-neutral-700"
              }`}
              aria-label={s.title}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Small presentational helpers ──
const inputCls =
  "w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-white placeholder:text-neutral-600 focus:outline-none focus:border-teal-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm text-neutral-400 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function ImagePick({
  label, value, round, onPick, onClear,
}: {
  label: string;
  value: string | null;
  round?: boolean;
  onPick: (file: File) => Promise<void>;
  onClear: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  return (
    <div>
      <label className="text-sm text-neutral-400 block mb-2">{label}</label>
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={label}
            className={`object-cover bg-neutral-800 border border-neutral-700 ${round ? "w-16 h-16 rounded-full" : "w-24 h-14 rounded-lg"}`}
          />
        ) : (
          <div className={`bg-neutral-800 border border-dashed border-neutral-700 flex items-center justify-center text-neutral-600 text-2xl ${round ? "w-16 h-16 rounded-full" : "w-24 h-14 rounded-lg"}`}>
            +
          </div>
        )}
        <div className="flex-1 flex gap-2">
          <label className="cursor-pointer px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-300 transition">
            {uploading ? "מעלה..." : value ? "החלף" : "העלה"}
            <input
              type="file" accept="image/*" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                await onPick(f);
                setUploading(false);
                e.target.value = "";
              }}
            />
          </label>
          {value && (
            <button
              onClick={onClear}
              className="px-3 py-2 rounded-lg bg-neutral-800 hover:bg-red-900/40 text-sm text-red-400 transition"
            >
              הסר
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
