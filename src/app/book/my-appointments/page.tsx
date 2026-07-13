"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSlug, apiWithSlug, publicHref, useSmartBack } from "@/lib/public-nav";

type Appt = {
  id: string;
  date: string;        // ISO date
  startTime: string;
  endTime: string;
  status: string;
  price: number;
  staff:   { id: string; name: string; avatarUrl: string | null };
  service: { id: string; name: string; durationMinutes: number };
};

type WaitlistEntry = {
  id: string;
  date: string;        // ISO date
  preferredTimeOfDay: string | null;
  isFlexible: boolean;
  staff:   { id: string; name: string } | null;
  service: { id: string; name: string };
};

// ── Back arrow (matches the booking flow style) ──────────────────────────────
function BackArrow({ href }: { href: string }) {
  const onBack = useSmartBack(href);
  return (
    <Link href={href} onClick={onBack}
      className="w-9 h-9 flex items-center justify-center rounded-full transition-colors"
      style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        style={{ color: "var(--text-sec)" }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

// ── Hebrew date label: "יום שלישי, 12 ביוני" ─────────────────────────────────
function dateLabel(iso: string): { weekday: string; full: string; rel: string } {
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const weekday = d.toLocaleDateString("he-IL", { weekday: "long" });
  const full = d.toLocaleDateString("he-IL", { day: "numeric", month: "long" });
  let rel = "";
  if (diff === 0) rel = "היום";
  else if (diff === 1) rel = "מחר";
  return { weekday, full, rel };
}

export default function MyAppointmentsPage() {
  const slug = useSlug();
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [name, setName]       = useState("");
  const [upcoming, setUpcoming] = useState<Appt[]>([]);
  const [past, setPast]         = useState<Appt[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  // Auth credentials kept for follow-up actions (e.g. cancelling a booking).
  const [auth, setAuth]       = useState<{ phone: string; token: string } | null>(null);
  // Cancellation flow state
  const [confirmId, setConfirmId]   = useState<string | null>(null); // appointment pending confirmation
  const [cancellingId, setCancellingId] = useState<string | null>(null); // request in flight
  const [cancelError, setCancelError]   = useState("");
  // Leave-waitlist flow state
  const [leavingWaitlistId, setLeavingWaitlistId] = useState<string | null>(null); // request in flight
  // Phone + OTP login (fallback when there's no bk_session cookie — e.g. incognito
  // or a different device/browser than the one used to book).
  const [loginStep, setLoginStep]     = useState<"phone" | "code">("phone");
  const [loginPhone, setLoginPhone]   = useState("");
  const [loginCode, setLoginCode]     = useState("");
  const [loginBusy, setLoginBusy]     = useState(false);
  const [loginError, setLoginError]   = useState("");

  // Fetch a customer's appointments with phone + OTP token. Returns true on success.
  async function loadAppointments(phone: string, token: string): Promise<boolean> {
    const url = apiWithSlug(`/api/my-appointments?phone=${encodeURIComponent(phone)}&token=${encodeURIComponent(token)}`, slug);
    const res = await fetch(url);
    if (!res.ok) return false;
    const data = await res.json();
    setUpcoming(Array.isArray(data.upcoming) ? data.upcoming : []);
    setPast(Array.isArray(data.past) ? data.past : []);
    setWaitlist(Array.isArray(data.waitlist) ? data.waitlist : []);
    if (data?.customer?.name) setName(String(data.customer.name).split(" ")[0]);
    return true;
  }

  useEffect(() => {
    (async () => {
      try {
        // 1) Exchange the bk_session cookie for a fresh OTP token (no SMS).
        const authRes = await fetch(apiWithSlug("/api/otp/auto-token", slug), { method: "POST" });
        if (!authRes.ok) {
          // No session (incognito / different browser) → offer phone+OTP login.
          setError("not-signed-in");
          setLoading(false);
          return;
        }
        const auth = await authRes.json();
        if (auth?.name) setName(String(auth.name).split(" ")[0]);
        if (auth?.phone && auth?.token) setAuth({ phone: auth.phone, token: auth.token });

        // 2) Fetch this customer's appointments using phone + token.
        const ok = await loadAppointments(auth.phone, auth.token);
        if (!ok) { setError("load-failed"); setLoading(false); return; }
        setLoading(false);
      } catch {
        setError("load-failed");
        setLoading(false);
      }
    })();
  }, []);

  // ── Phone + OTP login (no session) ──────────────────────────────────────────
  async function sendLoginOtp() {
    const digits = loginPhone.replace(/\D/g, "");
    if (digits.length < 9) { setLoginError("מספר טלפון לא תקין"); return; }
    setLoginBusy(true);
    setLoginError("");
    try {
      const res = await fetch(apiWithSlug("/api/otp/send", slug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: loginPhone }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setLoginError(d?.error || "שליחת הקוד נכשלה, נסה שוב");
        setLoginBusy(false);
        return;
      }
      setLoginStep("code");
    } catch {
      setLoginError("שליחת הקוד נכשלה, נסה שוב");
    }
    setLoginBusy(false);
  }

  async function verifyLoginOtp() {
    if (loginCode.replace(/\D/g, "").length < 4) { setLoginError("הזן את הקוד בן 4 הספרות"); return; }
    setLoginBusy(true);
    setLoginError("");
    try {
      const res = await fetch(apiWithSlug("/api/otp/verify", slug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: loginPhone, code: loginCode }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setLoginError(d?.error || "קוד שגוי או שפג תוקפו");
        setLoginBusy(false);
        return;
      }
      const data = await res.json(); // { ok, token, customerName }
      if (data?.customerName) setName(String(data.customerName).split(" ")[0]);
      setAuth({ phone: loginPhone, token: data.token });
      setError("");
      setLoading(true);
      const ok = await loadAppointments(loginPhone, data.token);
      setError(ok ? "" : "load-failed");
      setLoading(false);
    } catch {
      setLoginError("האימות נכשל, נסה שוב");
      setLoginBusy(false);
    }
  }

  // Cancel an upcoming appointment (after the user confirms).
  async function handleCancel(id: string) {
    if (!auth) { setCancelError("פג תוקף הסשן — רענן את הדף"); return; }
    setCancellingId(id);
    setCancelError("");
    try {
      const res = await fetch(apiWithSlug("/api/my-appointments/cancel", slug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: id, phone: auth.phone, token: auth.token }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCancelError(data?.error || "הביטול נכשל, נסה שוב");
        setCancellingId(null);
        return;
      }
      // Remove from the upcoming list on success.
      setUpcoming(prev => prev.filter(a => a.id !== id));
      setConfirmId(null);
      setCancellingId(null);
    } catch {
      setCancelError("הביטול נכשל, נסה שוב");
      setCancellingId(null);
    }
  }

  // Leave a waitlist day.
  async function handleLeaveWaitlist(id: string) {
    if (!auth) return;
    setLeavingWaitlistId(id);
    try {
      const res = await fetch(apiWithSlug(
        `/api/waitlist?id=${id}&phone=${encodeURIComponent(auth.phone)}&token=${encodeURIComponent(auth.token)}`, slug),
        { method: "DELETE" });
      if (res.ok) setWaitlist(prev => prev.filter(w => w.id !== id));
    } catch { /* ignore */ }
    setLeavingWaitlistId(null);
  }

  return (
    <div className="min-h-screen pb-24" dir="rtl" style={{ background: "var(--bg)" }}>

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-20 px-4 py-3"
        style={{ background: "var(--header-bg)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "1px solid var(--divider)" }}>
        <div className="flex items-center justify-between">
          <BackArrow href={publicHref(slug, "/book")} />
          <h1 className="text-[13px] font-semibold tracking-[0.15em]" style={{ color: "var(--text-pri)" }}>
            התורים שלי
          </h1>
          <div className="w-9" />
        </div>
      </div>

      {/* ── Greeting ── */}
      {!loading && !error && name && (
        <div className="px-4 pt-4 pb-1">
          <p className="text-[17px] font-bold leading-tight" style={{ color: "var(--text-pri)" }}>
            היי {name} 👋
          </p>
          <p className="text-[12px] leading-tight mt-0.5" style={{ color: "var(--text-muted)" }}>
            {upcoming.length > 0
              ? `יש לך ${upcoming.length} ${upcoming.length === 1 ? "תור עתידי" : "תורים עתידיים"}`
              : "אין לך תורים עתידיים כרגע"}
          </p>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="px-4 pt-5 space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded-2xl h-24" style={{ background: "var(--card)" }} />
          ))}
        </div>
      )}

      {/* ── Not signed in → phone + OTP login ── */}
      {!loading && error === "not-signed-in" && (
        <div className="px-6 pt-16">
          <div className="text-center mb-6">
            <div className="text-5xl mb-4">🔒</div>
            <p className="text-[16px] font-bold mb-1" style={{ color: "var(--text-pri)" }}>
              {loginStep === "phone" ? "כניסה לתורים שלך" : "הזן את קוד האימות"}
            </p>
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              {loginStep === "phone"
                ? "הזן את מספר הטלפון שאיתו קבעת — נשלח לך קוד אימות"
                : `שלחנו קוד בן 4 ספרות ל-${loginPhone}`}
            </p>
          </div>

          <div className="max-w-sm mx-auto">
            {loginStep === "phone" ? (
              <>
                <input
                  type="tel"
                  inputMode="tel"
                  dir="ltr"
                  value={loginPhone}
                  onChange={e => { setLoginPhone(e.target.value); setLoginError(""); }}
                  onKeyDown={e => { if (e.key === "Enter") sendLoginOtp(); }}
                  placeholder="050-0000000"
                  className="w-full text-center text-[18px] tracking-wide rounded-2xl px-4 py-3.5 mb-3 outline-none"
                  style={{ background: "var(--card)", border: "1px solid var(--divider)", color: "var(--text-pri)" }}
                />
                {loginError && <p className="text-[12px] text-center mb-3" style={{ color: "#dc2626" }}>{loginError}</p>}
                <button
                  onClick={sendLoginOtp}
                  disabled={loginBusy}
                  className="w-full py-3.5 rounded-2xl font-bold text-white active:scale-95 transition-transform disabled:opacity-60"
                  style={{ background: "var(--brand)" }}>
                  {loginBusy ? "שולח…" : "שלח לי קוד"}
                </button>
              </>
            ) : (
              <>
                <input
                  type="tel"
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={4}
                  value={loginCode}
                  onChange={e => { setLoginCode(e.target.value.replace(/\D/g, "")); setLoginError(""); }}
                  onKeyDown={e => { if (e.key === "Enter") verifyLoginOtp(); }}
                  placeholder="••••"
                  className="w-full text-center text-[26px] font-extrabold tracking-[0.5em] rounded-2xl px-4 py-3.5 mb-3 outline-none"
                  style={{ background: "var(--card)", border: "1px solid var(--divider)", color: "var(--text-pri)" }}
                />
                {loginError && <p className="text-[12px] text-center mb-3" style={{ color: "#dc2626" }}>{loginError}</p>}
                <button
                  onClick={verifyLoginOtp}
                  disabled={loginBusy}
                  className="w-full py-3.5 rounded-2xl font-bold text-white active:scale-95 transition-transform disabled:opacity-60"
                  style={{ background: "var(--brand)" }}>
                  {loginBusy ? "מאמת…" : "כניסה"}
                </button>
                <button
                  onClick={() => { setLoginStep("phone"); setLoginCode(""); setLoginError(""); }}
                  className="w-full mt-3 text-[12px] font-semibold"
                  style={{ color: "var(--text-muted)" }}>
                  ← שינוי מספר טלפון
                </button>
              </>
            )}

            <div className="mt-6 text-center">
              <Link href={publicHref(slug, "/book")}
                className="text-[13px] font-semibold" style={{ color: "var(--text-muted)" }}>
                עדיין לא קבעת תור? קבע עכשיו
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── Load failed ── */}
      {!loading && error === "load-failed" && (
        <div className="px-6 pt-20 text-center">
          <div className="text-5xl mb-4">😕</div>
          <p className="text-[15px] font-semibold mb-4" style={{ color: "var(--text-pri)" }}>
            לא הצלחנו לטעון את התורים
          </p>
          <button onClick={() => location.reload()}
            className="px-6 py-3 rounded-2xl font-bold text-white active:scale-95 transition-transform"
            style={{ background: "var(--brand)" }}>
            נסה שוב
          </button>
        </div>
      )}

      {/* ── Upcoming ── */}
      {!loading && !error && (
        <div className="px-4 pt-4">
          {upcoming.length > 0 ? (
            <div className="space-y-3">
              {upcoming.map(a => {
                const dl = dateLabel(a.date);
                return (
                  <div key={a.id} className="rounded-2xl p-4 relative overflow-hidden"
                    style={{ background: "var(--card)", border: "1px solid var(--divider)", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                    {/* Brand accent stripe */}
                    <div className="absolute top-0 bottom-0 right-0 w-1" style={{ background: "var(--brand)" }} />
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {dl.rel && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                              style={{ background: "var(--brand)" }}>{dl.rel}</span>
                          )}
                          <p className="text-[14px] font-bold truncate" style={{ color: "var(--text-pri)" }}>
                            {dl.weekday}, {dl.full}
                          </p>
                        </div>
                        <p className="text-[12px] mt-1.5 truncate" style={{ color: "var(--text-sec)" }}>
                          {a.service.name} · אצל {a.staff.name}
                        </p>
                      </div>
                      <div className="flex flex-col items-center pl-2 flex-shrink-0">
                        <span className="text-[20px] font-extrabold tracking-wide leading-none" dir="ltr"
                          style={{ color: "var(--brand)" }}>{a.startTime}</span>
                        <span className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }} dir="ltr">
                          {a.startTime}–{a.endTime}
                        </span>
                      </div>
                    </div>

                    {/* ── Cancel row ── */}
                    {confirmId === a.id ? (
                      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--divider)" }}>
                        <p className="text-[12px] font-semibold text-center mb-2" style={{ color: "var(--text-pri)" }}>
                          לבטל את התור?
                        </p>
                        {cancelError && (
                          <p className="text-[11px] text-center mb-2" style={{ color: "#dc2626" }}>{cancelError}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleCancel(a.id)}
                            disabled={cancellingId === a.id}
                            className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-white active:scale-95 transition-transform disabled:opacity-60"
                            style={{ background: "#dc2626" }}>
                            {cancellingId === a.id ? "מבטל…" : "כן, בטל תור"}
                          </button>
                          <button
                            onClick={() => { setConfirmId(null); setCancelError(""); }}
                            disabled={cancellingId === a.id}
                            className="flex-1 py-2.5 rounded-xl text-[13px] font-bold active:scale-95 transition-transform disabled:opacity-60"
                            style={{ background: "var(--bg-alt)", color: "var(--text-sec)", border: "1px solid var(--divider)" }}>
                            השאר תור
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 pt-3 flex justify-end" style={{ borderTop: "1px solid var(--divider)" }}>
                        <button
                          onClick={() => { setConfirmId(a.id); setCancelError(""); }}
                          className="text-[12px] font-semibold px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
                          style={{ color: "#dc2626" }}>
                          ביטול תור
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center pt-12 pb-6">
              <div className="text-5xl mb-4">📅</div>
              <p className="text-[15px] font-semibold mb-1" style={{ color: "var(--text-pri)" }}>
                אין תורים עתידיים
              </p>
              <p className="text-[13px] mb-6" style={{ color: "var(--text-muted)" }}>
                בוא נקבע לך תור חדש
              </p>
              <Link href={publicHref(slug, "/book")}
                className="inline-block px-6 py-3 rounded-2xl font-bold text-white active:scale-95 transition-transform"
                style={{ background: "var(--brand)" }}>
                קבע תור
              </Link>
            </div>
          )}

          {/* ── Waitlist days ── */}
          {waitlist.length > 0 && (
            <div className="mt-8">
              <p className="text-[10px] tracking-[0.3em] uppercase font-medium mb-3 px-1" style={{ color: "var(--text-muted)" }}>
                רשימת המתנה
              </p>
              <div className="space-y-2">
                {waitlist.map(w => {
                  const dl = dateLabel(w.date);
                  return (
                    <div key={w.id} className="rounded-2xl p-4 relative overflow-hidden"
                      style={{ background: "var(--card)", border: "1px solid var(--divider)", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                      <div className="absolute top-0 bottom-0 right-0 w-1" style={{ background: "#f59e0b" }} />
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px]">⏳</span>
                            <p className="text-[14px] font-bold truncate" style={{ color: "var(--text-pri)" }}>
                              {dl.weekday}, {dl.full}
                            </p>
                          </div>
                          <p className="text-[12px] mt-1.5 truncate" style={{ color: "var(--text-sec)" }}>
                            {w.service.name}{w.staff ? ` · אצל ${w.staff.name}` : ""}
                          </p>
                          <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                            נעדכן אותך ב-WhatsApp ברגע שיתפנה תור
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 flex justify-end" style={{ borderTop: "1px solid var(--divider)" }}>
                        <button
                          onClick={() => handleLeaveWaitlist(w.id)}
                          disabled={leavingWaitlistId === w.id}
                          className="text-[12px] font-semibold px-3 py-1.5 rounded-lg active:scale-95 transition-transform disabled:opacity-60"
                          style={{ color: "#dc2626" }}>
                          {leavingWaitlistId === w.id ? "מסיר…" : "יציאה מרשימת ההמתנה"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Past appointments ── */}
          {past.length > 0 && (
            <div className="mt-8">
              <p className="text-[10px] tracking-[0.3em] uppercase font-medium mb-3 px-1" style={{ color: "var(--text-muted)" }}>
                היסטוריה
              </p>
              <div className="space-y-2">
                {past.slice(0, 10).map(a => {
                  const dl = dateLabel(a.date);
                  return (
                    <div key={a.id} className="rounded-xl px-4 py-3 flex items-center justify-between"
                      style={{ background: "var(--bg-alt)", border: "1px solid var(--divider)" }}>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: "var(--text-sec)" }}>
                          {dl.weekday}, {dl.full}
                        </p>
                        <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                          {a.service.name} · {a.staff.name}
                        </p>
                      </div>
                      <span className="text-[13px] font-bold pl-2 flex-shrink-0" dir="ltr"
                        style={{ color: "var(--text-muted)" }}>{a.startTime}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
