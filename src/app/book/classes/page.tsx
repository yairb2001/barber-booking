"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSlug, apiWithSlug, publicHref, useSmartBack } from "@/lib/public-nav";
import { useG } from "@/components/VocabProvider";

/**
 * Group classes (16.10.2026, Yair: "אם זה חדרי כושר זה קבוצות"). The coming
 * sessions with the spots left; tap one, name + phone + the WhatsApp code, and
 * she has a spot — or, when it's full, a place in line that moves up by itself.
 */
type Session = { id: string; name: string; description: string | null; price: number; date: string; startTime: string; endTime: string; staffName: string | null; left: number; waiting: number };

const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const dayTitle = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); return `יום ${DAYS[d.getUTCDay()]}, ${d.getUTCDate()}.${d.getUTCMonth() + 1}`; };

function BackArrow({ href }: { href: string }) {
  const onBack = useSmartBack(href);
  return (
    <Link href={href} onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full" style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }} aria-label="חזרה">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: "var(--text-sec)" }}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
    </Link>
  );
}

export default function ClassesPage() {
  const slug = useSlug();
  const g = useG();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [open, setOpen] = useState<Session | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"form" | "code" | "quick" | "done">("form");
  // Signed in on this phone already (the bk_session cookie): no code needed.
  const [me, setMe] = useState<{ phone: string; token: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const load = () => fetch(apiWithSlug("/api/classes", slug)).then(r => (r.ok ? r.json() : { sessions: [] })).then(d => setSessions(d.sessions ?? [])).catch(() => setSessions([]));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slug]);
  useEffect(() => {
    fetch(apiWithSlug("/api/otp/auto-token", slug), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(r => (r.ok ? r.json() : null))
      .then(a => { if (a?.phone && a?.token) setMe({ phone: a.phone, token: a.token, name: a.name ?? "" }); })
      .catch(() => {});
  }, [slug]);

  function pick(s: Session) { setOpen(s); setStep(me ? "quick" : "form"); setError(""); setCode(""); setResult(""); }

  async function book(token: string, p: string, n: string): Promise<boolean> {
    if (!open) return false;
    const r = await fetch(apiWithSlug("/api/classes/book", slug), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: open.id, customerName: n, customerPhone: p, otpToken: token }) }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    if (!r?.ok) { setError(d?.error || "ההרשמה נכשלה"); return r?.status !== 401 && r?.status !== 400; }
    setResult(d.status === "waitlist" ? `השיעור מלא, נכנסת לרשימת ההמתנה (מקום ${d.position ?? 1}). אם יתפנה מקום, נרשום אותך ונשלח הודעה בוואטסאפ.` : d.test ? "מצב בדיקה: ההרשמה לא נשמרה." : "נרשמת ✓ אישור נשלח בוואטסאפ.");
    setStep("done");
    void load();
    return true;
  }

  async function quick() {
    if (!me) return;
    setBusy(true); setError("");
    const handled = await book(me.token, me.phone, me.name);
    setBusy(false);
    // The saved sign-in belongs to another business (or a new customer needs a name): the form.
    if (!handled) { setMe(null); setError(""); setStep("form"); }
  }

  async function sendCode() {
    if (!name.trim() || phone.replace(/\D/g, "").length < 9) { setError(g("מלא שם וטלפון", "מלאי שם וטלפון")); return; }
    setBusy(true); setError("");
    const r = await fetch(apiWithSlug("/api/otp/send", slug), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) setStep("code"); else setError((await r?.json().catch(() => ({})))?.error || g("שליחת הקוד נכשלה, נסה שוב", "שליחת הקוד נכשלה, נסי שוב"));
  }

  async function confirm() {
    if (!open) return;
    setBusy(true); setError("");
    const v = await fetch(apiWithSlug("/api/otp/verify", slug), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, code }) }).catch(() => null);
    const vd = await v?.json().catch(() => ({}));
    if (!v?.ok || !vd?.token) { setBusy(false); setError(vd?.error || "קוד שגוי"); return; }
    await book(vd.token, phone, name);
    setBusy(false);
  }

  const byDay = (sessions ?? []).reduce<Record<string, Session[]>>((acc, s) => { (acc[s.date] ??= []).push(s); return acc; }, {});

  return (
    <div className="min-h-screen pb-24" dir="rtl" style={{ background: "var(--bg)" }}>
      <div className="sticky top-0 z-20 px-4 py-3" style={{ background: "var(--header-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center justify-between">
          <BackArrow href={publicHref(slug, "/")} />
          <h1 className="text-[13px] font-semibold tracking-[0.12em]" style={{ color: "var(--text-pri)" }}>שיעורים</h1>
          <span className="w-9" />
        </div>
      </div>

      <div className="px-4 pt-5 space-y-6">
        {sessions === null && [1, 2, 3].map(i => <div key={i} className="h-[76px] rounded-2xl animate-pulse" style={{ background: "var(--card)" }} />)}
        {sessions?.length === 0 && <p className="text-sm text-center py-10" style={{ color: "var(--text-muted)" }}>אין כרגע שיעורים פתוחים להרשמה.</p>}
        {Object.entries(byDay).map(([day, list]) => (
          <div key={day} className="space-y-2.5">
            <h2 className="text-[12px] font-semibold tracking-[0.15em]" style={{ color: "var(--brand)" }}>{dayTitle(day)}</h2>
            {list.map(s => (
              <button key={s.id} type="button" onClick={() => pick(s)} className="w-full text-right flex items-center rounded-2xl overflow-hidden active:scale-[0.99] transition-all"
                style={{ background: "var(--card)", border: `1px solid ${open?.id === s.id ? "var(--brand)" : "var(--divider)"}`, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                <div className="w-1 self-stretch flex-shrink-0" style={{ background: "var(--brand)" }} />
                <div className="flex items-center flex-1 gap-3 px-4 py-3.5 min-w-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold" style={{ color: "var(--text-pri)" }}>{s.name}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{s.startTime}–{s.endTime}{s.staffName ? ` · עם ${s.staffName}` : ""}</p>
                  </div>
                  <div className="text-left flex-shrink-0">
                    {s.price > 0 && <p className="text-[15px] font-bold" style={{ color: "var(--brand)" }}>₪{s.price}</p>}
                    <p className="text-[11px]" style={{ color: s.left ? "var(--text-muted)" : "#b45309" }}>{s.left ? `נשארו ${s.left} מקומות` : "מלא · רשימת המתנה"}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>

      {open && (
        <div className="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl px-5 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-2xl" style={{ background: "var(--card)", borderTop: "1px solid var(--divider)" }}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-[15px] font-bold" style={{ color: "var(--text-pri)" }}>{open.name}</p>
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>{dayTitle(open.date)} · {open.startTime}{open.left ? "" : " · מלא, נכנסים לרשימת המתנה"}</p>
            </div>
            <button type="button" onClick={() => setOpen(null)} className="text-[13px] px-2" style={{ color: "var(--text-muted)" }}>סגירה</button>
          </div>
          {open.description && step === "form" && <p className="text-[12px] mb-3 leading-relaxed" style={{ color: "var(--text-sec)" }}>{open.description}</p>}
          {step === "form" && (
            <div className="space-y-2.5">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="שם מלא" className="w-full rounded-xl px-3 py-2.5 text-[15px] outline-none" style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)", color: "var(--text-pri)" }} />
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="טלפון" inputMode="tel" dir="ltr" className="w-full rounded-xl px-3 py-2.5 text-[15px] outline-none" style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)", color: "var(--text-pri)" }} />
              <button type="button" onClick={() => void sendCode()} disabled={busy} className="w-full rounded-xl py-3 font-bold text-white disabled:opacity-60" style={{ background: "var(--brand)" }}>{busy ? "…" : g("שלח לי קוד בוואטסאפ", "שלחי לי קוד בוואטסאפ")}</button>
            </div>
          )}
          {step === "quick" && me && (
            <div className="space-y-2.5">
              <p className="text-[13px]" style={{ color: "var(--text-sec)" }}>{me.name ? `נרשמים בתור ${me.name}` : "נרשמים עם הטלפון השמור"} <span dir="ltr">{me.phone.replace(/^972/, "0")}</span></p>
              <button type="button" onClick={() => void quick()} disabled={busy} className="w-full rounded-xl py-3 font-bold text-white disabled:opacity-60" style={{ background: "var(--brand)" }}>{busy ? "…" : open.left ? "הרשמה" : "כניסה לרשימת המתנה"}</button>
              <button type="button" onClick={() => setStep("form")} className="w-full text-[12px] py-1" style={{ color: "var(--text-muted)" }}>לא אני</button>
            </div>
          )}
          {step === "code" && (
            <div className="space-y-2.5">
              <input value={code} onChange={e => setCode(e.target.value)} placeholder="הקוד מהוואטסאפ" inputMode="numeric" dir="ltr" className="w-full rounded-xl px-3 py-2.5 text-[15px] outline-none tracking-widest text-center" style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)", color: "var(--text-pri)" }} />
              <button type="button" onClick={() => void confirm()} disabled={busy || code.replace(/\D/g, "").length < 4} className="w-full rounded-xl py-3 font-bold text-white disabled:opacity-60" style={{ background: "var(--brand)" }}>{busy ? "…" : open.left ? "הרשמה" : "כניסה לרשימת המתנה"}</button>
            </div>
          )}
          {step === "done" && <p className="text-[14px] leading-relaxed py-2" style={{ color: "var(--text-pri)" }}>{result}</p>}
          {error && <p className="text-[12px] mt-2 text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
