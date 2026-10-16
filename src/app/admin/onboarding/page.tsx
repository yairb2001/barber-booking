"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { vocabFor, type Vocab } from "@/lib/vocab";
import { setupFieldsFor, SERVICE_LIST, isServiceList, type SetupField, type SetupConfig } from "@/lib/agent/setup-fields";
import { DEFAULT_UNAVAILABLE_MESSAGE } from "@/lib/agent/unavailable-message";
import { ConnectBox, BusinessNumberNote, startOurServerConnection } from "@/components/WhatsAppQrPanel";

/**
 * Setup wizard — stage 1 (docs/PLAN-MASTER.md, spec "אפיון שלב 1" §3).
 *
 * Six screens, mobile first, every step saved (settings.onboarding), all in
 * Chator's brand: petrol #0B3A3C, turquoise #4FE3B1, coral for the one primary
 * button, Outfit for the wordmark, Heebo for text. The owner usually arrives
 * through the personal onboarding link (no password yet) — screen 0 lets him
 * set one. Reuses the admin APIs only.
 *
 *   0 welcome (+ password) · 1 business & hours · 2 team · 3 services ·
 *   4 the agent (form + a few words + preview) · 5 WhatsApp · 6 activate
 */

const C = { petrol: "#0B3A3C", turquoise: "#4FE3B1", coral: "#FF6B57", ink: "#0B1F21", mist: "#E8F4F1" };
const STEPS = ["פתיחה", "העסק", "הצוות", "שירותים", "הסוכן", "וואטסאפ", "הפעלה"] as const;
const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
type Hours = { on: boolean; start: string; end: string }[];
const DEFAULT_HOURS: Hours = [0, 1, 2, 3, 4].map(() => ({ on: true, start: "09:00", end: "19:00" })).concat([{ on: true, start: "09:00", end: "14:00" }, { on: false, start: "09:00", end: "14:00" }]);

/** What signup names a shop when no name was given: the wizard asks for the real one. */
const SIGNUP_DEFAULT_NAME = "המספרה שלי";

type Member = { id?: string; name: string; phone: string };
type Svc = { id?: string; name: string; price: string; duration: string; category?: string; priceFrom?: boolean; rebookDays?: number };

/** First setup asks only what shapes most chats: the must-answer ones and the tone. */
const isMainQuestion = (f: SetupField) => f.core || f.key === "tone";

/** The interview question made short for a screen: no "X / Y" option list (the
 *  chips show them), no long dash, its "(למשל: …)" / "(ברירת מחדל: …)" moved
 *  out as a hint (13.10.2026, Yair: "לדייק את האשף"). */
function ask(f: SetupField): { q: string; hint: string } {
  let q = f.question.replace(/\?\s*[^?]*\/[^?]*$/, "?").replace(/\s*\(walk-in\)/i, "");
  let hint = "";
  const m = /\s*\(([^()]*)\)\s*$/.exec(q);
  if (m) { q = q.slice(0, m.index); hint = /^ברירת מחדל/.test(m[1]) ? "" : m[1].includes("למשל:") ? m[1].slice(m[1].indexOf("למשל:")) : m[1]; }
  q = q.replace(/\s*—\s*/g, ", ").replace(/\s+([?,])/g, "$1").trim();
  if (!/[?.]$/.test(q) && f.type !== "text") q += "?";
  return { q, hint };
}

const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4FE3B1]";
const num = "w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[14px] text-center text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4FE3B1]";
const chip = (on: boolean) => `px-3 py-1.5 rounded-full text-sm border transition ${on ? "text-white border-transparent" : "bg-white border-slate-200 text-slate-600"}`;

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<string[]>([]);

  // business
  const [bizType, setBizType] = useState("barber_men");
  const vocab: Vocab = useMemo(() => vocabFor(bizType), [bizType]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [hours, setHours] = useState<Hours>(DEFAULT_HOURS);
  const [slug, setSlug] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false); // signup already set one
  const [moreQs, setMoreQs] = useState(false);            // the agent questions that can wait
  const [live, setLive] = useState<{ endsAt: string | null } | null>(null); // activated just now
  const [copied, setCopied] = useState(false);
  const [tester, setTester] = useState(""); // test mode: the one number the agent answers before "הפעל"
  // team & services
  const [members, setMembers] = useState<Member[]>([{ name: "", phone: "" }]);
  const [services, setServices] = useState<Svc[]>([]);
  // agent
  const [agentName, setAgentName] = useState("הסוכן");
  const [setup, setSetup] = useState<SetupConfig>({});
  const [unavailableMsg, setUnavailableMsg] = useState(DEFAULT_UNAVAILABLE_MESSAGE);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [preview, setPreview] = useState<{ role: string; text: string }[] | null>(null);
  const [previewText, setPreviewText] = useState("היי, יש תור מחר בערב?");
  const [previewing, setPreviewing] = useState(false);
  // whatsapp
  const [waStatus, setWaStatus] = useState("not_requested");
  const [waTestSent, setWaTestSent] = useState(false);
  const [waBox, setWaBox] = useState(false);       // the linking box is open (device opened on our server)
  const [waLinked, setWaLinked] = useState(false);  // the phone linked during this visit
  const [waOfficial, setWaOfficial] = useState(false); // asked for official WhatsApp

  const fields: SetupField[] = useMemo(() => setupFieldsFor(bizType), [bizType]);

  // ── Load ──
  useEffect(() => {
    (async () => {
      try {
        const [bizRes, meRes, staffRes, svcRes, agentRes] = await Promise.all([
          fetch("/api/admin/business"), fetch("/api/admin/me"), fetch("/api/admin/staff"), fetch("/api/admin/services"), fetch("/api/admin/agent"),
        ]);
        if (bizRes.ok) {
          const b = await bizRes.json();
          setName(b.name && b.name !== SIGNUP_DEFAULT_NAME ? b.name : ""); setPhone(b.phone || ""); setAddress(b.address || ""); setLogoUrl(b.logoUrl || null);
          if (b.businessType) setBizType(b.businessType);
          const s = b.settings || {};
          if (typeof s.agentUnavailableMessage === "string" && s.agentUnavailableMessage.trim()) setUnavailableMsg(s.agentUnavailableMessage);
          if (Array.isArray(s.agentTesters) && typeof s.agentTesters[0] === "string") setTester(s.agentTesters[0]);
          if (s.onboarding) {
            if (typeof s.onboarding.step === "number") setStep(Math.min(Math.max(s.onboarding.step, 0), STEPS.length - 1));
            if (Array.isArray(s.onboarding.doneSteps)) setDone(s.onboarding.doneSteps);
            if (Array.isArray(s.onboarding.hours) && s.onboarding.hours.length === 7) setHours(s.onboarding.hours);
          }
        }
        if (meRes.ok) { const me = await meRes.json(); if (me?.slug) setSlug(me.slug); if (me?.whatsappStatus) setWaStatus(me.whatsappStatus); if (me?.hasPassword) setHasPassword(true); }
        if (staffRes.ok) { const st = await staffRes.json(); if (Array.isArray(st) && st.length) setMembers(st.map((x: { id: string; name: string; phone: string | null }) => ({ id: x.id, name: x.name, phone: x.phone || "" }))); }
        if (svcRes.ok) { const sv = await svcRes.json(); if (Array.isArray(sv) && sv.length) setServices(sv.map((x: { id: string; name: string; price: number; durationMinutes: number }) => ({ id: x.id, name: x.name, price: String(x.price), duration: String(x.durationMinutes) }))); }
        if (agentRes.ok) {
          const a = await agentRes.json();
          if (a?.agentName) setAgentName(a.agentName);
          if (a?.isEnabled) setAgentEnabled(true);
          if (a?.setupConfig) { try { setSetup(JSON.parse(a.setupConfig)); } catch { /* ignore */ } }
        }
      } catch { /* the wizard still works with empty fields */ }
      finally { setLoading(false); }
    })();
  }, []);

  // Starter catalog once we know the type (only when the shop has no services yet).
  useEffect(() => { setServices(s => s.length ? s : vocab.serviceCatalog.map(x => ({ name: x.name, price: String(x.price), duration: String(x.duration), category: x.category, priceFrom: x.priceFrom, rebookDays: x.rebookDays }))); }, [vocab]);

  const saveProgress = useCallback(async (nextStep: number, nextDone: string[], extra?: Record<string, unknown>) => {
    try { await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboarding: { step: nextStep, doneSteps: nextDone, hours, ...extra } }) }); } catch { /* best effort */ }
  }, [hours]);

  const goTo = useCallback((next: number, markDone?: string) => {
    setError("");
    const clamped = Math.min(Math.max(next, 0), STEPS.length - 1);
    let nextDone = done;
    if (markDone && !done.includes(markDone)) { nextDone = [...done, markDone]; setDone(nextDone); }
    setStep(clamped); saveProgress(clamped, nextDone);
    window.scrollTo({ top: 0 });
  }, [done, saveProgress]);

  const uploadImage = async (file: File): Promise<string | null> => {
    const { compressImage } = await import("@/lib/image-compress");
    const fd = new FormData(); fd.append("file", await compressImage(file, "cover"));
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    if (!res.ok) return null;
    return (await res.json()).url || null;
  };

  // ── Step saves ──
  const saveWelcome = async () => {
    setBusy(true); setError("");
    try {
      if (password) {
        const r = await fetch("/api/admin/auth/set-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
        if (!r.ok) { setError((await r.json()).error || "שמירת הסיסמה נכשלה"); setBusy(false); return; }
      }
      goTo(1, "welcome");
    } catch { setError("שגיאת רשת"); }
    setBusy(false);
  };

  const saveBusiness = async () => {
    if (!name.trim()) { setError(`איך קוראים ל${vocab.place}?`); return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/admin/business", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), phone, address, logoUrl }) });
      if (!r.ok) { setError("שמירת פרטי העסק נכשלה"); setBusy(false); return; }
      // Apply the hours to staff that already exist (new ones get them on creation).
      await Promise.all(members.filter(m => m.id).map(m => postSchedule(m.id!)));
      goTo(2, "business");
    } catch { setError("שגיאת רשת"); }
    setBusy(false);
  };

  const postSchedule = (staffId: string) => fetch(`/api/admin/staff/${staffId}/schedule`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(DAYS.map((_, i) => ({ dayOfWeek: i, isWorking: hours[i].on, start: hours[i].start, end: hours[i].end }))),
  });

  const saveTeam = async () => {
    const valid = members.filter(m => m.name.trim());
    if (!valid.length) { setError(`צריך לפחות ${vocab.staff} ${vocab.staffFem ? "אחת" : "אחד"}`); return; }
    setBusy(true); setError("");
    try {
      const out: Member[] = [];
      for (const m of valid) {
        if (m.id) { out.push(m); continue; }
        const r = await fetch("/api/admin/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: m.name.trim(), phone: m.phone || undefined }) });
        if (!r.ok) { setError(`יצירת ${m.name} נכשלה`); setBusy(false); return; }
        const created = await r.json();
        await postSchedule(created.id);
        out.push({ id: created.id, name: m.name.trim(), phone: m.phone });
      }
      setMembers(out);
      goTo(3, "team");
    } catch { setError("שגיאת רשת"); }
    setBusy(false);
  };

  const saveServices = async () => {
    const valid = services.filter(s => s.name.trim());
    if (!valid.length) { setError("צריך לפחות שירות אחד"); return; }
    setBusy(true); setError("");
    try {
      const out: Svc[] = [];
      for (const s of valid) {
        if (s.id) { out.push(s); continue; }
        const r = await fetch("/api/admin/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: s.name.trim(), price: parseFloat(s.price) || 0, durationMinutes: parseInt(s.duration) || 30, category: s.category ?? null, priceFrom: !!s.priceFrom, rebookDays: s.rebookDays ?? null, sortOrder: valid.indexOf(s) }) });
        if (!r.ok) { setError(`יצירת ${s.name} נכשלה`); setBusy(false); return; }
        out.push({ ...s, id: (await r.json()).id });
      }
      setServices(out);
      // Everyone does everything (default of the spec); editable later per member.
      await Promise.all(members.filter(m => m.id).flatMap(m => out.filter(s => s.id).map(s =>
        fetch(`/api/admin/staff/${m.id}/services`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serviceId: s.id, enabled: true }) }).catch(() => null),
      )));
      goTo(4, "services");
    } catch { setError("שגיאת רשת"); }
    setBusy(false);
  };

  const saveAgent = async (advance = true) => {
    setBusy(true); setError("");
    try {
      const cfg: SetupConfig = { ...setup };
      for (const f of fields) if ((cfg[f.key] === undefined || cfg[f.key] === "") && f.default !== undefined) cfg[f.key] = f.default;
      const r = await fetch("/api/admin/agent", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentName: agentName.trim() || "הסוכן", setupConfig: cfg, author: "wizard" }) });
      if (!r.ok) { setError("שמירת הגדרות הסוכן נכשלה"); setBusy(false); return false; }
      await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentUnavailableMessage: unavailableMsg.trim() || DEFAULT_UNAVAILABLE_MESSAGE }) });
      setSetup(cfg);
      if (advance) goTo(5, "agent");
      setBusy(false);
      return true;
    } catch { setError("שגיאת רשת"); setBusy(false); return false; }
  };

  const runPreview = async () => {
    if (!previewText.trim()) return;
    setPreviewing(true); setPreview(null);
    const ok = await saveAgent(false);
    if (!ok) { setPreviewing(false); return; }
    try {
      const r = await fetch("/api/admin/agent/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [previewText.trim()] }) });
      const j = await r.json();
      const t = Array.isArray(j.transcript) ? j.transcript : [];
      setPreview(t.length ? t : [{ role: "assistant", text: j.error || "לא התקבלה תשובה, נסה שוב" }]);
    } catch { setPreview([{ role: "assistant", text: "שגיאת רשת" }]); }
    setPreviewing(false);
  };

  // One click: the number is opened on Chator's own WhatsApp server and the
  // scan box appears — no request, no waiting (Yair, 6.10: "סריקה קלילה וחיבור מהיר").
  const connectWhatsApp = async () => {
    setBusy(true); setError("");
    const r = await startOurServerConnection();
    if (!r.ok) setError(r.error || "לא הצלחנו לפתוח את החיבור");
    else if (r.connected) setWaLinked(true);
    else { setWaStatus("requested"); setWaBox(true); }
    setBusy(false);
  };
  // Official WhatsApp: recorded until Meta's connect window is ready (api/admin/whatsapp/official).
  const chooseOfficial = async () => {
    setBusy(true);
    const r = await fetch("/api/admin/whatsapp/official", { method: "POST" }).catch(() => null);
    if (r?.ok) setWaOfficial(true); else setError("לא הצלחנו לשמור, נסה שוב");
    setBusy(false);
  };
  useEffect(() => { if (step === 6 && !tester && members[0]?.phone) setTester(members[0].phone); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (step !== 5) return;
    fetch("/api/admin/whatsapp/official").then(r => (r.ok ? r.json() : null)).then(j => { if (j?.wanted) setWaOfficial(true); }).catch(() => {});
  }, [step]);
  // Came back to this step with a device already opened earlier → straight to the box.
  useEffect(() => {
    if (step === 5 && waStatus === "requested" && !waBox && !waLinked) void connectWhatsApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, waStatus]);

  // Linked → one test message from the business's own number, once.
  useEffect(() => {
    if (!waLinked || waTestSent) return;
    setWaTestSent(true);
    fetch("/api/admin/whatsapp/test-self", { method: "POST" }).then(r => { if (r.ok) setWaStatus("connected"); }).catch(() => {});
  }, [waLinked, waTestSent]);

  const activate = async () => {
    setBusy(true); setError("");
    try {
      const wasOn = agentEnabled;
      const r = await fetch("/api/admin/agent", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isEnabled: true }) });
      if (!r.ok) { setError("הפעלת הסוכן נכשלה"); setBusy(false); return; }
      await fetch("/api/admin/onboarding/complete", { method: "POST" });
      if (wasOn) { router.push("/admin"); router.refresh(); return; }
      // Just went live: the link to share and when the free month ends.
      const me = await fetch("/api/admin/me").then(x => (x.ok ? x.json() : null)).catch(() => null);
      setAgentEnabled(true);
      setLive({ endsAt: me?.trialEndsAt ?? null });
      window.scrollTo({ top: 0 });
    } catch { setError("שגיאה בהפעלה"); }
    setBusy(false);
  };

  // Not now (14.10.2026, Yair: "בתחילת החודש ללחוץ על הפעל"): setup is done, the
  // shop stays in test mode and the agent answers only the tester's number.
  const finishWithoutActivating = async () => {
    setBusy(true); setError("");
    try {
      const t = tester.trim();
      await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentTesters: t ? [t] : [] }) });
      await fetch("/api/admin/onboarding/complete", { method: "POST" });
      router.push("/admin"); router.refresh();
    } catch { setError("שגיאת רשת"); setBusy(false); }
  };

  const finishLater = async () => {
    await fetch("/api/admin/onboarding/complete", { method: "POST" }).catch(() => {});
    router.push("/admin"); router.refresh();
  };

  // One agent question: chips for a choice, a box for words (the question without its option list).
  const renderField = (f: SetupField) => {
    const { q, hint } = ask(f);
    return (
      <Field key={f.key} label={q} help={f.help || (f.type !== "text" ? hint : "")}>
        {f.type === "choice" && f.options ? (
          <div className="flex flex-wrap gap-1.5">
            {f.options.map(o => { const on = (setup[f.key] ?? f.default) === o; return <button key={o} type="button" onClick={() => setSetup(s => ({ ...s, [f.key]: o }))} className={chip(on)} style={on ? { background: C.petrol } : {}}>{o}</button>; })}
          </div>
        ) : f.type === "bool" ? (
          <div className="flex gap-1.5">
            {[true, false].map(v => { const on = (setup[f.key] ?? f.default) === v; return <button key={String(v)} type="button" onClick={() => setSetup(s => ({ ...s, [f.key]: v }))} className={chip(on)} style={on ? { background: C.petrol } : {}}>{v ? "כן" : "לא"}</button>; })}
          </div>
        ) : f.multiline ? (
          <textarea value={String(setup[f.key] ?? "")} onChange={e => setSetup(s => ({ ...s, [f.key]: e.target.value }))} className={input} rows={3} placeholder={f.key === "styleSamples" ? "הודעה אחת בכל שורה" : hint || "כמה מילים בסגנון שלך"} />
        ) : typeof f.default === "string" && f.default.length > 32 ? (
          // A long default (who gets escalated) shows whole, not cut off on a phone.
          <textarea value={String(setup[f.key] ?? "")} onChange={e => setSetup(s => ({ ...s, [f.key]: e.target.value }))} className={input} rows={2} placeholder={f.default} />
        ) : (
          <input value={f.key === "defaultService" && isServiceList(setup[f.key]) ? "" : String(setup[f.key] ?? "")} onChange={e => setSetup(s => ({ ...s, [f.key]: e.target.value }))} className={input} placeholder={f.key === "defaultService" && isServiceList(setup[f.key]) ? "או שם של שירות" : typeof f.default === "string" ? f.default : hint} />
        )}
        {/* A default service, or show the list and ask (16.10.2026). */}
        {f.key === "defaultService" && (() => { const on = isServiceList(setup[f.key]); return <button type="button" onClick={() => setSetup(s => ({ ...s, [f.key]: on ? "" : SERVICE_LIST }))} className={`${chip(on)} mt-1.5`} style={on ? { background: C.petrol } : {}}>{SERVICE_LIST}</button>; })()}
      </Field>
    );
  };

  if (loading) return <Shell step={0}><div className="text-center text-slate-500 py-10">טוען…</div></Shell>;

  // Activated: the shop is live. What to do now, not a jump into the admin (13.10.2026).
  if (live) {
    const link = slug ? `${window.location.origin}/${slug}` : "";
    const ends = live.endsAt ? new Date(live.endsAt).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Asia/Jerusalem" }) : null;
    const waOn = waStatus === "connected" || waLinked;
    const share = `היי, מעכשיו אפשר לקבוע תור אצלנו ישר מכאן: ${link}`;
    const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ } };
    return (
      <Shell step={STEPS.length - 1}>
        <Card title="המערכת פעילה" sub={ends ? `החודש החינמי שלך רץ עד ${ends}.` : undefined}>
          <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center text-2xl my-2" style={{ background: C.turquoise, color: C.ink }}>✓</div>
          {link && (
            <Field label="הקישור לקביעת תורים, לשתף עם הלקוחות">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[14px] break-all text-slate-700" dir="ltr">{link}</div>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => void copy()} className="flex-1 rounded-xl border py-2.5 text-sm font-semibold" style={{ borderColor: C.petrol, color: C.petrol }}>{copied ? "הועתק ✓" : "העתק"}</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white text-center bg-[#25D366]">שלח בוואטסאפ</a>
              </div>
            </Field>
          )}
          {waOn ? (
            <p className="text-sm rounded-xl px-3 py-2.5 mt-5 leading-relaxed" style={{ background: C.mist, color: C.petrol }}>נסה עכשיו: מטלפון אחר, שלח לוואטסאפ של {vocab.placeDef} &quot;יש תור מחר?&quot;</p>
          ) : (
            <div className="text-sm rounded-xl px-3 py-2.5 mt-5 leading-relaxed bg-amber-50 border border-amber-200 text-amber-800">
              הוואטסאפ לא מחובר, אז הסוכן עוד לא עונה.{" "}
              <button type="button" onClick={() => router.push("/admin/settings/whatsapp")} className="font-semibold underline">לחבר עכשיו</button>
            </div>
          )}
          <Primary onClick={() => { router.push("/admin"); router.refresh(); }}>כניסה למערכת</Primary>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell step={step} onSkipAll={finishLater}>
      {error && <div className="mb-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

      {step === 0 && (
        <Card title={`בוא נקים את צ׳אטור ל${vocab.place} שלך`} sub="עשר דקות, מהנייד. כל שלב נשמר, אפשר לעצור ולחזור.">
          <ul className="text-sm text-slate-600 space-y-1.5 mb-5">
            {["פרטי העסק ושעות הפעילות", `${vocab.staffPluralDef} והשירותים`, "איך הסוכן מדבר עם הלקוחות", "חיבור הוואטסאפ של העסק"].map(t => <li key={t} className="flex gap-2"><span style={{ color: C.turquoise }}>●</span>{t}</li>)}
          </ul>
          <p className="text-sm rounded-xl px-3 py-2.5 mb-1" style={{ background: C.mist, color: C.petrol }}>החודש החינמי מתחיל רק כשתלחץ &quot;הפעל&quot; בסוף.</p>
          {/* Signup already set a password; only someone who came in through a personal link has none. */}
          {!hasPassword && (
            <div className="mt-4">
              <label className="block text-sm text-slate-600 mb-1">סיסמה לכניסה בפעם הבאה <span className="text-slate-400">(לא חובה עכשיו)</span></label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={input} placeholder="לפחות 6 תווים" dir="ltr" />
            </div>
          )}
          <Primary onClick={saveWelcome} busy={busy}>מתחילים</Primary>
        </Card>
      )}

      {step === 1 && (
        <Card title="העסק" sub="אפשר לשנות הכל אחר כך בהגדרות.">
          <Field label={`שם ${vocab.placeDef}`}><input value={name} onChange={e => setName(e.target.value)} className={input} placeholder={vocab.type === "barber_men" ? "המספרה של דני" : vocab.placeDef} /></Field>
          <Field label="טלפון העסק" help="המספר שהלקוחות רואים בעמוד קביעת התור. כדאי שזה יהיה המספר של הוואטסאפ של העסק."><input value={phone} onChange={e => setPhone(e.target.value)} className={input} dir="ltr" placeholder="050-0000000" /></Field>
          <Field label="כתובת"><input value={address} onChange={e => setAddress(e.target.value)} className={input} placeholder="רחוב ומספר, עיר" /></Field>
          <Field label="לוגו (לא חובה)">
            <div className="flex items-center gap-3">
              {logoUrl ? <img src={logoUrl} alt="" className="w-14 h-14 rounded-xl object-cover border border-slate-200" /> : <div className="w-14 h-14 rounded-xl bg-slate-100" />}
              <label className="text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white cursor-pointer">בחר תמונה<input type="file" accept="image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { const u = await uploadImage(f); if (u) setLogoUrl(u); } }} /></label>
            </div>
          </Field>
          <Field label="שעות פעילות" help={`השעות שבהן אפשר לקבוע תורים. כל ${vocab.staffPluralDef} מקבלים אותן, ואפשר לשנות לכל אחד אחר כך.`}>
            <div className="space-y-1.5">
              {DAYS.map((d, i) => (
                <div key={d} className="flex items-center gap-2 text-sm">
                  <button type="button" onClick={() => setHours(h => h.map((x, j) => j === i ? { ...x, on: !x.on } : x))} className={chip(hours[i].on)} style={hours[i].on ? { background: C.petrol } : {}}>{d}</button>
                  {hours[i].on ? (
                    <>
                      <input type="time" value={hours[i].start} onChange={e => setHours(h => h.map((x, j) => j === i ? { ...x, start: e.target.value } : x))} className="rounded-lg border border-slate-200 px-2 py-1 text-sm" />
                      <span className="text-slate-400">–</span>
                      <input type="time" value={hours[i].end} onChange={e => setHours(h => h.map((x, j) => j === i ? { ...x, end: e.target.value } : x))} className="rounded-lg border border-slate-200 px-2 py-1 text-sm" />
                    </>
                  ) : <span className="text-slate-400 text-xs">סגור</span>}
                </div>
              ))}
            </div>
          </Field>
          <Primary onClick={saveBusiness} busy={busy}>המשך</Primary>
        </Card>
      )}

      {step === 2 && (
        <Card title="הצוות" sub={`מי ${vocab.works} אצלכם, כולל אתה.`}>
          <div className="space-y-2">
            {members.map((m, i) => (
              <div key={i} className="flex gap-2">
                <input value={m.name} onChange={e => setMembers(a => a.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className={input} placeholder={i === 0 ? "השם שלך" : `שם ${vocab.staff}`} disabled={!!m.id} />
                <input value={m.phone} onChange={e => setMembers(a => a.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} className={input} dir="ltr" placeholder={i === 0 ? "הנייד שלך" : "נייד"} inputMode="tel" disabled={!!m.id} />
                {!m.id && members.length > 1 && <button type="button" onClick={() => setMembers(a => a.filter((_, j) => j !== i))} className="text-slate-400 px-1">✕</button>}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setMembers(a => [...a, { name: "", phone: "" }])} className="mt-3 text-sm font-medium" style={{ color: C.petrol }}>+ עוד {vocab.staff}</button>
          <Help label="למה צריך נייד?">
            <Bubble>הנייד האישי של כל אחד, לא של העסק. אליו מגיעות ההתראות, ואיתו נכנסים ליומן. כולם מקבלים את כל השירותים ואת שעות הפעילות, ואפשר לדייק לכל אחד אחר כך.</Bubble>
          </Help>
          <Primary onClick={saveTeam} busy={busy}>המשך</Primary>
        </Card>
      )}

      {step === 3 && (
        <Card title="השירותים" sub="הכנו רשימה במחירי שוק. שנה, מחק, הוסף.">
          {/* The name gets the full width (it was cut off on a phone), price and minutes under it. */}
          <div className="space-y-2">
            {services.map((s, i) => (
              <div key={i}>
              {/* Beauty catalogs come by category (16.10.2026). */}
              {s.category && s.category !== services[i - 1]?.category && <p className="text-[12px] font-semibold mt-3 mb-1.5" style={{ color: C.petrol }}>{s.category}</p>}
              <div className="rounded-2xl border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <input value={s.name} onChange={e => setServices(a => a.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className={input} placeholder="שם השירות" disabled={!!s.id} />
                  {!s.id ? <button type="button" onClick={() => setServices(a => a.filter((_, j) => j !== i))} className="shrink-0 w-8 text-slate-400" aria-label="מחק שירות">✕</button> : <span className="shrink-0 w-8 text-center text-emerald-500 text-sm">✓</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 text-[13px] text-slate-500">
                  <input value={s.price} onChange={e => setServices(a => a.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} className={num} type="number" inputMode="numeric" dir="ltr" disabled={!!s.id} aria-label="מחיר" />
                  <span>₪</span>
                  <input value={s.duration} onChange={e => setServices(a => a.map((x, j) => j === i ? { ...x, duration: e.target.value } : x))} className={`${num} ms-3`} type="number" inputMode="numeric" dir="ltr" disabled={!!s.id} aria-label="דקות" />
                  <span>דקות</span>
                  {s.priceFrom && <span className="ms-auto text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: C.mist, color: C.petrol }}>החל מ</span>}
                </div>
              </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setServices(a => [...a, { name: "", price: "", duration: "30" }])} className="mt-3 text-sm font-medium" style={{ color: C.petrol }}>+ שירות</button>
          <Help label="מה משנים המחיר והדקות?">
            <Bubble>המחיר מופיע ללקוחות בעמוד קביעת התור, והסוכן אומר אותו כששואלים. הדקות קובעות כמה זמן התור תופס ביומן, אז מציעים ללקוח רק זמנים שהשירות נכנס בהם.</Bubble>
          </Help>
          <Primary onClick={saveServices} busy={busy}>המשך</Primary>
        </Card>
      )}

      {step === 4 && (
        <Card title="הסוכן" sub="הבסיס מוכן. כאן רק מה שמיוחד אצלך.">
          <Field label="איך לקוחות יקראו לו" help="השם של הסוכן. אם לקוח שואל עם מי הוא מדבר, זה השם שהסוכן יגיד."><input value={agentName} onChange={e => setAgentName(e.target.value)} className={input} placeholder="הסוכן" /></Field>
          {fields.filter(isMainQuestion).map(renderField)}

          {/* The rest can wait: folded, so the first setup stays short (13.10.2026). */}
          <button type="button" onClick={() => setMoreQs(v => !v)} className="mt-5 w-full flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold" style={{ color: C.petrol }} aria-expanded={moreQs}>
            <span>עוד שאלות <span className="font-normal text-slate-400">(אפשר גם אחר כך)</span></span>
            <span aria-hidden="true">{moreQs ? "▲" : "▼"}</span>
          </button>
          {moreQs && (
            <div className="border-s-2 ps-3 mt-1" style={{ borderColor: C.mist }}>
              {fields.filter(f => !isMainQuestion(f)).map(renderField)}
              <Field label="ההודעה שלקוח מקבל כשהסוכן לא זמין" help="נשלחת לבד כשהסוכן לא יכול לענות, למשל כשנגמרו ההודעות של החודש, כדי שאף לקוח לא יישאר בלי תשובה.">
                <textarea value={unavailableMsg} onChange={e => setUnavailableMsg(e.target.value)} className={input} rows={3} />
                <div className="text-[11px] text-slate-400 mt-1">{"{{name}}"} יוחלף בשם הלקוח, {"{{link}}"} בקישור לקביעת תור</div>
              </Field>
            </div>
          )}

          <div className="mt-5 rounded-2xl p-4" style={{ background: C.mist }}>
            <div className="text-sm font-semibold mb-2" style={{ color: C.petrol }}>נסה אותו</div>
            <div className="flex gap-2">
              <input value={previewText} onChange={e => setPreviewText(e.target.value)} className={input} />
              <button type="button" onClick={runPreview} disabled={previewing || busy} className="shrink-0 px-4 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: C.petrol }}>{previewing ? "…" : "שלח"}</button>
            </div>
            {preview && (
              <div className="mt-3 space-y-1.5">
                {preview.map((m, i) => (
                  <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-white text-slate-800" : "text-white"}`} style={m.role === "user" ? {} : { background: C.petrol }}>{m.text}</div>
                ))}
              </div>
            )}
            <div className="text-[11px] text-slate-500 mt-2">רק ניסיון, שום דבר לא נשלח.</div>
          </div>
          <Primary onClick={() => saveAgent(true)} busy={busy}>המשך</Primary>
        </Card>
      )}

      {step === 5 && (
        <Card title="הוואטסאפ של העסק" sub="הסוכן עונה מהמספר שהלקוחות כבר מכירים.">
          {waStatus === "connected" || waLinked ? (
            <div className="rounded-2xl px-4 py-5 text-center" style={{ background: C.mist }}>
              <div className="w-12 h-12 mx-auto rounded-full inline-flex items-center justify-center text-2xl mb-1" style={{ background: C.turquoise, color: C.ink }}>✓</div>
              <p className="text-sm font-semibold" style={{ color: C.petrol }}>הוואטסאפ של העסק מחובר</p>
              <p className="text-xs text-slate-500 mt-1">{waTestSent ? "שלחנו לך הודעת בדיקה מהמספר של העסק." : "הסוכן, התזכורות והאישורים יוצאים מהמספר של העסק."}</p>
            </div>
          ) : waBox ? (
            <ConnectBox onLinked={() => setWaLinked(true)} />
          ) : (
            // Regular or official, chosen right here at the connection step (10.10.2026).
            <div className="space-y-3">
              <BusinessNumberNote />
              {/* Yair, 14.10.2026: a small "what's the difference", very short. */}
              <Help label="רגיל או רשמי? מה ההבדל">
                <Bubble title="וואטסאפ רגיל">
                  <Pro ok>שולחים כל הודעה, מתי שרוצים, כמה שרוצים.</Pro>
                  <Pro ok={false}>יש סיכון לחסימה. <span className="opacity-75">(עבדנו עם הרבה {vocab.type.startsWith("barber") ? "מספרות" : "עסקים"} ויודעים איך לעבוד בלי להיחסם. עד היום {vocab.type.startsWith("barber") ? "אף מספרה לא נחסמה" : "אף עסק לא נחסם"}.)</span></Pro>
                </Bubble>
                <Bubble title="וואטסאפ רשמי של מטא">
                  <Pro ok>בלי סיכון לחסימה.</Pro>
                  <Pro ok={false}>אי אפשר לשלוח מה שרוצים מתי שרוצים. הודעה ראשונה ללקוח רק בתבנית שמטא אישרה. רק אחרי שהוא עונה כותבים לו חופשי, עד 24 שעות.</Pro>
                </Bubble>
              </Help>
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-slate-800">וואטסאפ רגיל</p>
                <p className="text-xs text-slate-500 mt-1 mb-3">סורקים קוד מהטלפון של העסק. פחות מדקה.</p>
                <Primary onClick={connectWhatsApp} busy={busy}>חבר את הטלפון</Primary>
              </div>
              <div className="rounded-2xl border p-4" style={{ borderColor: waOfficial ? C.turquoise : "#E2E8F0", background: waOfficial ? C.mist : "#fff" }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">וואטסאפ רשמי של מטא</p>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#FFF1D6", color: "#7A4A00" }}>אחרי החודש החינמי</span>
                </div>
                {waOfficial
                  ? <p className="text-xs mt-3 leading-relaxed" style={{ color: C.petrol }}>רשמנו. בחודש החינמי מתחברים ברגיל, ואחריו נעביר אותך לרשמי.</p>
                  : <button type="button" onClick={chooseOfficial} disabled={busy} className="mt-3 w-full rounded-xl py-2.5 text-sm font-semibold border disabled:opacity-50" style={{ borderColor: C.petrol, color: C.petrol }}>אני רוצה רשמי</button>}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between mt-5">
            <button type="button" onClick={() => goTo(6, waStatus === "connected" || waLinked ? "whatsapp" : undefined)} className="text-sm text-slate-500">{waStatus === "connected" || waLinked ? "המשך" : "אמשיך בלי לחבר עכשיו"}</button>
          </div>
        </Card>
      )}

      {step === 6 && (
        <Card title="הפעלה" sub="בדיקה אחרונה, ומפעילים.">
          <ul className="space-y-2 text-sm">
            {[
              ["העסק ושעות הפעילות", done.includes("business")],
              [`${vocab.staffPluralDef}: ${members.filter(m => m.id).length}`, members.some(m => m.id)],
              [`שירותים: ${services.filter(s => s.id).length}`, services.some(s => s.id)],
              ["הגדרות הסוכן", done.includes("agent")],
              ["וואטסאפ מחובר", waStatus === "connected" || waLinked],
            ].map(([label, ok]) => (
              <li key={String(label)} className="flex items-center gap-2"><span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center text-white ${ok ? "" : "bg-slate-300"}`} style={ok ? { background: C.turquoise, color: C.ink } : {}}>{ok ? "✓" : "·"}</span><span className={ok ? "text-slate-800" : "text-slate-500"}>{label as string}</span></li>
            ))}
          </ul>
          <Help label="מה קורה כשלוחצים הפעל?">
            <Bubble>הסוכן מתחיל לענות ללקוחות, הלקוחות יכולים לקבוע, ומתחיל החודש החינמי. הוא כולל את החבילה של מסלול בסיס. אם היא נגמרת לפני סוף החודש, ממשיכים בהצטרפות למסלול. בלי כרטיס זה פשוט נעצר, בלי שום חיוב.</Bubble>
          </Help>
          {agentEnabled && <p className="text-xs text-emerald-700 mt-3">הסוכן כבר פעיל.</p>}
          {waStatus === "connected" || waLinked || agentEnabled ? (
            <Primary onClick={activate} busy={busy}>{agentEnabled ? "סיים והיכנס למערכת" : "הפעל"}</Primary>
          ) : (
            // Without WhatsApp the free month would run while the agent answers no one: connect first.
            <>
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-4 leading-relaxed">הוואטסאפ לא מחובר: הסוכן לא יענה, והחודש החינמי ירוץ בכל זאת. כדאי לחבר קודם, פחות מדקה.</p>
              <Primary onClick={() => goTo(5)} busy={busy}>לחבר את הוואטסאפ</Primary>
              <button type="button" onClick={activate} disabled={busy} className="mt-3 w-full text-sm text-slate-500 underline disabled:opacity-50">להפעיל בכל זאת</button>
            </>
          )}
          {!agentEnabled && (
            <div className="mt-6 pt-5 border-t border-slate-100">
              <p className="text-sm font-semibold text-slate-800">להפעיל אחר כך</p>
              <p className="text-xs text-slate-500 mt-0.5">למשל בתחילת החודש. עד אז זה מצב בדיקה.</p>
              <Field label="מספר לבדיקה" help="עד ההפעלה הסוכן עונה בוואטסאפ רק למספר הזה, כדי שתוכל לבדוק אותו. לקוחות לא קובעים, ותורים בבדיקה לא נשמרים. ההודעות יורדות מהחבילה החינמית.">
                <input value={tester} onChange={e => setTester(e.target.value)} className={input} dir="ltr" inputMode="tel" placeholder={members[0]?.phone || "הנייד שלך"} />
              </Field>
              <button type="button" onClick={() => void finishWithoutActivating()} disabled={busy} className="mt-3 w-full rounded-2xl py-3 text-[15px] font-semibold border disabled:opacity-50" style={{ borderColor: C.petrol, color: C.petrol }}>סיים, אפעיל אחר כך</button>
            </div>
          )}
        </Card>
      )}
    </Shell>
  );
}

// ─── Chrome ──────────────────────────────────────────────────────────────────

function Shell({ step, children, onSkipAll }: { step: number; children: React.ReactNode; onSkipAll?: () => void }) {
  return (
    <div className="min-h-screen px-4 py-6 font-heebo" dir="rtl" style={{ background: C.petrol }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700&display=swap" rel="stylesheet" />
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-white" style={{ fontFamily: "Outfit, Heebo, sans-serif" }}>Chator</span>
            <span className="text-xs" style={{ color: C.turquoise }}>הקמה</span>
          </div>
          {onSkipAll && step > 0 && <button onClick={onSkipAll} className="text-[12px] text-white/60 hover:text-white">אמשיך אחר כך ←</button>}
        </div>
        <div className="flex gap-1 mb-5">
          {STEPS.map((s, i) => <div key={s} className="h-1.5 flex-1 rounded-full" style={{ background: i <= step ? C.turquoise : "rgba(255,255,255,0.15)" }} title={s} />)}
        </div>
        <div className="text-[12px] text-white/60 mb-2">שלב {step + 1} מתוך {STEPS.length} · {STEPS[step]}</div>
        {children}
      </div>
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-3xl p-5 shadow-xl">
      <h1 className="text-xl font-bold" style={{ color: C.ink }}>{title}</h1>
      {sub && <p className="text-sm text-slate-500 mt-1 mb-4">{sub}</p>}
      {children}
    </div>
  );
}

// Explanations (14.10.2026, Yair: "כפתור שאתה פותח אותו ואז הוא מסביר לך"):
// a small "?" next to a question, or a short link for a whole step. Closed by default.
function Field({ label, help, children }: { label: string; help?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <label className="block text-sm text-slate-600">{label}</label>
        {help && (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="הסבר" className="shrink-0 w-6 h-6 rounded-full text-[12px] font-bold inline-flex items-center justify-center" style={open ? { background: C.petrol, color: "#fff" } : { background: C.mist, color: C.petrol }}>?</button>
        )}
      </div>
      {help && open && <Bubble>{help}</Bubble>}
      {children}
    </div>
  );
}

function Help({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: C.petrol }}>
        <span className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px]" style={open ? { background: C.petrol, color: "#fff" } : { background: C.mist }}>?</span>{label}
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

function Bubble({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 rounded-2xl px-3 py-2.5 text-[13px] leading-relaxed" style={{ background: C.mist, color: C.petrol }}>
      {title && <div className="font-bold mb-1">{title}</div>}
      {children}
    </div>
  );
}

/** One line of a comparison: ✓ for what you get, ✗ for what you give up. */
function Pro({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <div className="flex gap-1.5"><span className="shrink-0 font-bold" style={{ color: ok ? "#0F8A63" : "#C2410C" }}>{ok ? "✓" : "✗"}</span><span>{children}</span></div>;
}

function Primary({ onClick, busy, children }: { onClick: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="mt-6 w-full rounded-2xl py-3.5 text-[15px] font-bold text-white disabled:opacity-60 transition active:scale-[0.99]" style={{ background: C.coral }}>
      {busy ? "רגע…" : children}
    </button>
  );
}
