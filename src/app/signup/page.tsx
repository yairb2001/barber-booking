"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DOMAINS, setupForDomains, type Domain } from "@/lib/domains";
import { TYPICAL_BUSINESS, recommendPlan } from "@/lib/crm/plan-reco";
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
/** Every plan has all of Chator; the plans differ only in WhatsApp messages a month. */
const PLAN_INCLUDES = [
  "סוכן שעונה בוואטסאפ של העסק, קובע, מזיז ומבטל תורים, מסביב לשעון",
  "יומן לכל הצוות וקישור שבו הלקוחות קובעים לבד",
  "אישורים ותזכורות אוטומטיים לפני כל תור",
  "רשימת המתנה שממלאת תורים שהתבטלו",
  "כרטיס לכל לקוח, ותמונה של לקוחות חדשים וחוזרים",
  "הקמה בליווי שלנו",
];

const input = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4FE3B1]";

export default function SignupPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  // What they do, as many as apply (28.10.2026, spec "הקמה עצמית ליופי"); "עסק אחר" stands alone.
  const [domains, setDomains] = useState<Domain[]>([]);
  const [otherBiz, setOtherBiz] = useState(false);
  const businessType = setupForDomains(domains).businessType;
  const toggleDomain = (d: Domain) => { setOtherBiz(false); setDomains(a => (a.includes(d) ? a.filter(x => x !== d) : [...a, d])); };
  // The plans are shown, not picked (25.10.2026, Yair): the first month is free and the
  // plan is chosen at its end. The one that fits his type is marked.
  const [plans, setPlans] = useState<{ key: string; name: string; apptsEstimate: number; messages: number; priceIls: number }[]>([]);
  useEffect(() => { fetch("/api/plans").then(r => (r.ok ? r.json() : null)).then(j => { if (j?.plans?.length) setPlans(j.plans); }).catch(() => {}); }, []);
  const reco = recommendPlan(plans, TYPICAL_BUSINESS[businessType] ?? TYPICAL_BUSINESS.other);
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
    if (!domains.length && !otherBiz) { setError("מה עושים אצלכם? אפשר לבחור כמה"); return; }
    if (!phone) { setError("נא להזין טלפון"); return; }
    if (password.length < 6) { setError("סיסמה חייבת להיות לפחות 6 תווים"); return; }
    if (password !== confirmPassword) { setError("הסיסמאות לא תואמות"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, domains, phone, password, confirmPassword, ref: ref?.code, referrerPhone: !ref && referrerPhone.trim() ? referrerPhone : undefined, attribution: readAttribution() }),
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

  const section = "text-[13px] font-bold tracking-wide mb-2.5";
  return (
    <div className="min-h-screen px-4 py-8 flex items-start sm:items-center justify-center font-heebo" dir="rtl" style={{ background: C.petrol }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700&display=swap" rel="stylesheet" />
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-baseline justify-center gap-2">
          <span className="text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "Outfit, Heebo, sans-serif" }}>Chator</span>
          <span className="text-xs" style={{ color: C.turquoise }}>צ׳אטור</span>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-3xl px-5 py-6 sm:px-7 shadow-xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: C.ink }}>פתיחת עסק חדש</h1>
            <p className="text-[15px] mt-1.5 font-medium" style={{ color: C.petrol }}>החודש הראשון עלינו. בלי כרטיס אשראי ובלי התחייבות.</p>
            {ref && <p className="text-sm font-semibold mt-3 rounded-xl px-3 py-2" style={{ background: "#E3F7EF", color: C.petrol }}>{ref.name ? `הגעת בהמלצה של ${ref.name}. ברוך הבא!` : "הגעת בהמלצה של חבר. ברוך הבא!"}</p>}
          </div>

          <div>
            <p className={section} style={{ color: C.ink }}>מה עושים אצלכם? <span className="font-normal text-slate-400">(אפשר לבחור כמה)</span></p>
            <div className="flex flex-wrap gap-2 mb-3">
              {[...DOMAINS.map(d => ({ id: d.id as string, label: d.label, on: domains.includes(d.id), pick: () => toggleDomain(d.id) })),
                { id: "other", label: "עסק אחר", on: otherBiz, pick: () => { setDomains([]); setOtherBiz(o => !o); } }].map(t => (
                <button key={t.id} type="button" onClick={t.pick} aria-pressed={t.on}
                  className={`px-3.5 py-2 rounded-full text-sm border transition ${t.on ? "text-white border-transparent" : "bg-white border-slate-200 text-slate-600"}`}
                  style={t.on ? { background: C.petrol } : {}}>
                  {t.label}
                </button>
              ))}
            </div>
            <input type="text" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="שם העסק (אפשר גם אחר כך)" className={input} />
          </div>

          <div className="space-y-3">
            <p className={section} style={{ color: C.ink }}>הכניסה שלך</p>
            <div>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="הנייד של העסק" dir="rtl" className={input} />
              <p className="text-xs text-slate-500 mt-1.5">המספר שהלקוחות כותבים אליו. עליו הסוכן יענה.</p>
            </div>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="סיסמה (לפחות 6 תווים)" dir="rtl" className={input} />
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="הסיסמה שוב" dir="rtl" className={input} />
          </div>

          {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 text-center">{error}</div>}

          <div className="space-y-3">
            <button type="submit" disabled={submitting || !phone || !password || !confirmPassword}
              className="w-full rounded-2xl py-4 text-base font-bold text-white disabled:opacity-50 transition active:scale-[0.99]" style={{ background: C.coral }}>
              {submitting ? "רגע…" : "פתיחת העסק שלי"}
            </button>
            {!ref && (askRef ? (
              <div>
                <input type="tel" value={referrerPhone} onChange={e => setReferrerPhone(e.target.value)} placeholder="הנייד של מי שהמליץ (לא חובה)" dir="rtl" className={input} />
                <p className="text-xs text-slate-500 mt-1.5">ככה הוא יקבל חודש חינם כשתתחיל לשלם.</p>
              </div>
            ) : (
              <button type="button" onClick={() => setAskRef(true)} className="block mx-auto text-sm font-medium" style={{ color: C.petrol }}>מישהו המליץ לך עלינו?</button>
            ))}
            <p className="text-center text-sm text-slate-500">
              כבר יש לכם חשבון?{" "}
              <Link href="/admin/login" className="font-semibold" style={{ color: C.petrol }}>כניסה</Link>
            </p>
          </div>
        </form>

        {plans.length > 0 && (
          <section className="bg-white rounded-3xl px-5 py-5 sm:px-7 shadow-xl">
            <h2 className="text-base font-bold" style={{ color: C.ink }}>אחרי החודש החינמי</h2>
            <p className="text-sm text-slate-500 mt-0.5">בוחרים מסלול רק בסוף החודש, ואפשר להחליף בכל רגע.</p>
            <ul className="mt-4 divide-y divide-slate-100">
              {plans.map(p => (
                <li key={p.key}>
                  <details className="group">
                    <summary className="flex items-center gap-3 py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-[15px]" style={{ color: C.ink }}>
                          {p.name}
                          {reco?.key === p.key && <span className="mr-2 align-middle text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: "#E3F7EF", color: C.petrol }}>מתאים לך</span>}
                        </p>
                        <p className="text-[13px] text-slate-500">עד {p.apptsEstimate.toLocaleString("he-IL")} תורים בחודש</p>
                      </div>
                      <p className="text-lg font-bold tabular-nums whitespace-nowrap" style={{ color: C.ink }}>{p.priceIls} ₪<span className="text-xs font-normal text-slate-500"> לחודש</span></p>
                      <svg className="w-4 h-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                    </summary>
                    <div className="pb-4 -mt-1 space-y-2.5">
                      <p className="text-sm rounded-xl px-3 py-2" style={{ background: "#E3F7EF", color: C.petrol }}>
                        <b>{p.messages.toLocaleString("he-IL")} הודעות וואטסאפ בחודש.</b> זה מספיק לבערך {p.apptsEstimate.toLocaleString("he-IL")} תורים: התשובות של הסוכן, אישורים ותזכורות. התורים עצמם לא מוגבלים.
                      </p>
                      <ul className="space-y-1.5 text-sm text-slate-600">
                        {PLAN_INCLUDES.map(line => (
                          <li key={line} className="flex gap-2"><span aria-hidden="true" style={{ color: C.petrol }}>✓</span><span>{line}</span></li>
                        ))}
                      </ul>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500 mt-2">המחירים כוללים מע״מ. דיוורים שיווקיים בתשלום נפרד.</p>
          </section>
        )}
      </div>
    </div>
  );
}
