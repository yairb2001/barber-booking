"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BUSINESS_TYPES } from "@/lib/vocab";
import { TYPICAL_BUSINESS, recommendPlan, MESSAGES_EXPLAINED } from "@/lib/crm/plan-reco";
import { CHATOR_PIXEL_ID } from "@/lib/lead-attribution";

/** The first touch the sales landing kept (chator_attr), or this page's own utm/fbclid. */
function readAttribution(): Record<string, unknown> | null {
  try {
    const stored = JSON.parse(localStorage.getItem("chator_attr") || "null");
    if (stored) return stored;
  } catch { /* private mode */ }
  try {
    const p = new URLSearchParams(window.location.search);
    const a: Record<string, unknown> = {};
    for (const k of ["source", "medium", "campaign", "content", "term"]) { const v = p.get(`utm_${k}`); if (v) a[k] = v; }
    if (p.get("fbclid")) a.fbclid = true;
    return Object.keys(a).length ? a : null;
  } catch { return null; }
}

/** Chator's own pixel (off while CHATOR_PIXEL_ID is empty). */
function chatorPixel(event?: string) {
  if (!CHATOR_PIXEL_ID || typeof window === "undefined") return;
  type Fbq = ((...a: unknown[]) => void) & { queue?: unknown[]; callMethod?: (...a: unknown[]) => void; loaded?: boolean; version?: string; push?: unknown };
  const w = window as unknown as { fbq?: Fbq; _fbq?: unknown; __chatorPixel?: boolean };
  if (!w.fbq) {
    const n = function (...args: unknown[]) { if (n.callMethod) n.callMethod(...args); else n.queue!.push(args); } as Fbq;
    n.queue = []; n.loaded = true; n.version = "2.0"; n.push = n;
    w.fbq = n; if (!w._fbq) w._fbq = n;
    const s = document.createElement("script"); s.async = true; s.src = "https://connect.facebook.net/en_US/fbevents.js"; document.head.appendChild(s);
  }
  if (!w.__chatorPixel) { w.fbq!("init", CHATOR_PIXEL_ID); w.fbq!("track", "PageView"); w.__chatorPixel = true; }
  if (event) w.fbq!("track", event);
}

/**
 * Self-service signup — a new business owner registers their shop and goes
 * straight into the setup wizard (auto-logged-in by the API). Chator's brand
 * (stage 1): petrol background, white card, one coral button, Outfit wordmark.
 */
const C = { petrol: "#0B3A3C", turquoise: "#4FE3B1", coral: "#FF6B57", ink: "#0B1F21" };
const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4FE3B1]";

export default function SignupPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("barber_men");
  // Plan by how many appointments he has (10.10.2026). Only WhatsApp messages
  // are limited; the appointments are the estimate the plan fits.
  const [plans, setPlans] = useState<{ key: string; name: string; apptsEstimate: number; messages: number; priceIls: number }[]>([]);
  const [planKey, setPlanKey] = useState("base");
  useEffect(() => { fetch("/api/plans").then(r => (r.ok ? r.json() : null)).then(j => { if (j?.plans?.length) setPlans(j.plans); }).catch(() => {}); }, []);
  const plan = plans.find(p => p.key === planKey) ?? null;
  // The plan that fits the type (16.10.2026): chosen for him until he picks one himself.
  const [planTouched, setPlanTouched] = useState(false);
  const typical = TYPICAL_BUSINESS[businessType] ?? TYPICAL_BUSINESS.other;
  const reco = recommendPlan(plans, typical);
  useEffect(() => { if (!planTouched && reco) setPlanKey(reco.key); }, [businessType, reco?.key, planTouched]); // eslint-disable-line react-hooks/exhaustive-deps
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // "חבר מביא חבר" (11.10.2026): a friend's link (?ref=<his shop>), kept for a
  // later visit too, or the phone of the owner who told him about us.
  const [ref, setRef] = useState<{ code: string; name: string | null } | null>(null);
  const [askRef, setAskRef] = useState(false);
  const [referrerPhone, setReferrerPhone] = useState("");
  useEffect(() => { chatorPixel(); }, []);
  useEffect(() => {
    let code = new URLSearchParams(window.location.search).get("ref") ?? "";
    try { if (code) localStorage.setItem("chator_ref", code); else code = localStorage.getItem("chator_ref") ?? ""; } catch { /* private mode */ }
    if (!code) return;
    fetch(`/api/signup/referrer?ref=${encodeURIComponent(code)}`).then(r => (r.ok ? r.json() : null)).then(j => { if (j?.ok) setRef({ code, name: j.name ?? null }); }).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!phone) { setError("נא להזין טלפון"); return; }
    if (password.length < 6) { setError("סיסמה חייבת להיות לפחות 6 תווים"); return; }
    if (password !== confirmPassword) { setError("הסיסמאות לא תואמות"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, businessType, phone, password, confirmPassword, planKey: plan ? planKey : undefined, ref: ref?.code, referrerPhone: !ref && referrerPhone.trim() ? referrerPhone : undefined, attribution: readAttribution() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "שגיאה בהרשמה"); setSubmitting(false); return;
      }
      chatorPixel("CompleteRegistration");
      router.push("/admin/onboarding");
      router.refresh();
    } catch { setError("שגיאה בחיבור לשרת"); setSubmitting(false); }
  };

  return (
    <div className="min-h-screen px-4 py-8 flex items-center justify-center font-heebo" dir="rtl" style={{ background: C.petrol }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700&display=swap" rel="stylesheet" />
      <div className="w-full max-w-sm">
        <div className="flex items-baseline justify-center gap-2 mb-5">
          <span className="text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "Outfit, Heebo, sans-serif" }}>Chator</span>
          <span className="text-xs" style={{ color: C.turquoise }}>צ׳אטור</span>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-3xl p-5 shadow-xl space-y-4">
          <div>
            <h1 className="text-xl font-bold" style={{ color: C.ink }}>פתיחת עסק חדש</h1>
            <p className="text-sm text-slate-500 mt-1">דקה להרשמה, ואז אשף קצר שמקים לך את המערכת ואת הסוכן.</p>
            {ref && <p className="text-sm font-semibold mt-2.5 rounded-xl px-3 py-2" style={{ background: "#E3F7EF", color: C.petrol }}>{ref.name ? `הגעת בהמלצה של ${ref.name}. ברוך הבא!` : "הגעת בהמלצה של חבר. ברוך הבא!"}</p>}
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1.5">סוג העסק</label>
            <div className="flex flex-wrap gap-1.5">
              {BUSINESS_TYPES.map(t => {
                const on = businessType === t.id;
                return (
                  <button key={t.id} type="button" onClick={() => setBusinessType(t.id)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition ${on ? "text-white border-transparent" : "bg-white border-slate-200 text-slate-600"}`}
                    style={on ? { background: C.petrol } : {}}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {plans.length > 0 && (
            <div>
              <label className="block text-sm text-slate-600 mb-1.5">כמה תורים יש לך בחודש, בערך?</label>
              <div className="grid grid-cols-3 gap-1.5">
                {plans.map(p => {
                  const on = planKey === p.key;
                  return (
                    <button key={p.key} type="button" onClick={() => { setPlanTouched(true); setPlanKey(p.key); }}
                      className={`rounded-xl border px-2 py-2 text-center transition ${on ? "text-white border-transparent" : "bg-white border-slate-200 text-slate-700"}`}
                      style={on ? { background: C.petrol } : {}}>
                      <span className="block text-sm font-bold">כ־{p.apptsEstimate.toLocaleString("he-IL")}</span>
                      <span className={`block text-[11px] ${on ? "text-white/80" : "text-slate-500"}`}>{p.priceIls} ₪ לחודש</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">המחירים כוללים מע״מ.</p>
              {reco && <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: C.petrol }}>{BUSINESS_TYPES.find(t => t.id === businessType)?.label}: בדרך כלל כ־{typical.toLocaleString("he-IL")} תורים בחודש, מסלול {reco.name} מתאים.{plan && plan.key !== reco.key ? " אפשר כמובן לבחור אחר." : ""}</p>}
              {plan && <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">מסלול {plan.name}: {plan.messages.toLocaleString("he-IL")} הודעות וואטסאפ בחודש. {MESSAGES_EXPLAINED}, כ־{plan.apptsEstimate.toLocaleString("he-IL")} תורים. התורים עצמם לא מוגבלים, ואפשר לשנות מסלול בכל רגע.</p>}
              <p className="text-[11px] mt-1 leading-relaxed" style={{ color: C.petrol }}><b>חבר מביא חבר:</b> על כל מספרה שתביא, כשהיא מתחילה לשלם, אתה מקבל חודש חינם.</p>
            </div>
          )}

          <div>
            <label className="block text-sm text-slate-600 mb-1.5">שם העסק <span className="text-slate-400">(לא חובה, אפשר גם אחר כך)</span></label>
            <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="המספרה של דני" autoFocus className={input} />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1.5">נייד של המספרה (לכניסה ולוואטסאפ)</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="050-0000000" dir="ltr" className={input} />
            <p className="text-[11px] text-slate-500 mt-1">המספר של המספרה, לא הפרטי שלך: הסוכן יענה לכל מי שכותב אליו.</p>
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1.5">סיסמה (לפחות 6 תווים)</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} dir="ltr" className={input} />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1.5">אימות סיסמה</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} dir="ltr" className={input} />
          </div>

          {!ref && (askRef ? (
            <div>
              <label className="block text-sm text-slate-600 mb-1.5">הנייד של בעל המספרה שהמליץ <span className="text-slate-400">(לא חובה)</span></label>
              <input type="tel" value={referrerPhone} onChange={e => setReferrerPhone(e.target.value)} placeholder="050-0000000" dir="ltr" className={input} />
              <p className="text-[11px] text-slate-500 mt-1">ככה הוא יקבל חודש חינם כשתתחיל לשלם.</p>
            </div>
          ) : (
            <button type="button" onClick={() => setAskRef(true)} className="text-sm font-medium" style={{ color: C.petrol }}>מישהו המליץ לך עלינו?</button>
          ))}

          {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 text-center">{error}</div>}

          <button type="submit" disabled={submitting || !phone || !password || !confirmPassword}
            className="w-full rounded-2xl py-3.5 text-[15px] font-bold text-white disabled:opacity-50 transition active:scale-[0.99]" style={{ background: C.coral }}>
            {submitting ? "רגע…" : "פתיחת העסק שלי"}
          </button>

          <p className="text-center text-xs text-slate-500">
            כבר יש לכם חשבון?{" "}
            <Link href="/admin/login" className="font-medium" style={{ color: C.petrol }}>כניסה</Link>
          </p>
        </form>
        <p className="text-center text-[11px] mt-4" style={{ color: "rgba(255,255,255,0.55)" }}>חודש ראשון חינם בחבילה של מסלול בסיס, שמתחיל רק כשמסיימים להקים ולוחצים "הפעל". ההקמה בליווי, ביחד איתנו.</p>
      </div>
    </div>
  );
}
