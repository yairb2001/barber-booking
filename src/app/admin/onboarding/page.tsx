"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { vocabFor, type Vocab } from "@/lib/vocab";
import { setupFieldsFor, type SetupField, type SetupConfig } from "@/lib/agent/setup-fields";
import { DEFAULT_UNAVAILABLE_MESSAGE } from "@/lib/agent/unavailable-message";
import { useWhatsAppQr, WhatsAppQrBody, PairingCodeFallback } from "@/components/WhatsAppQrPanel";

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

type Member = { id?: string; name: string; phone: string };
type Svc = { id?: string; name: string; price: string; duration: string };

const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4FE3B1]";
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
  const qr = useWhatsAppQr(step === 5 && waStatus !== "not_requested");

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
          setName(b.name || ""); setPhone(b.phone || ""); setAddress(b.address || ""); setLogoUrl(b.logoUrl || null);
          if (b.businessType) setBizType(b.businessType);
          const s = b.settings || {};
          if (typeof s.agentUnavailableMessage === "string" && s.agentUnavailableMessage.trim()) setUnavailableMsg(s.agentUnavailableMessage);
          if (s.onboarding) {
            if (typeof s.onboarding.step === "number") setStep(Math.min(Math.max(s.onboarding.step, 0), STEPS.length - 1));
            if (Array.isArray(s.onboarding.doneSteps)) setDone(s.onboarding.doneSteps);
            if (Array.isArray(s.onboarding.hours) && s.onboarding.hours.length === 7) setHours(s.onboarding.hours);
          }
          setMembers(m => m[0]?.name ? m : [{ name: "", phone: b.phone || "" }]);
        }
        if (meRes.ok) { const me = await meRes.json(); if (me?.slug) setSlug(me.slug); if (me?.whatsappStatus) setWaStatus(me.whatsappStatus); }
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
  useEffect(() => { setServices(s => s.length ? s : vocab.serviceCatalog.map(x => ({ name: x.name, price: String(x.price), duration: String(x.duration) }))); }, [vocab]);

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
        const r = await fetch("/api/admin/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: s.name.trim(), price: parseFloat(s.price) || 0, durationMinutes: parseInt(s.duration) || 30 }) });
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
      const r = await fetch("/api/admin/agent", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentName: agentName.trim() || "הסוכן", setupConfig: cfg }) });
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
      setPreview(t.length ? t : [{ role: "assistant", text: j.error || "לא התקבלה תשובה — נסה שוב" }]);
    } catch { setPreview([{ role: "assistant", text: "שגיאת רשת" }]); }
    setPreviewing(false);
  };

  const requestWhatsApp = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/admin/request-whatsapp", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (j?.whatsappStatus) setWaStatus(j.whatsappStatus); else setWaStatus("requested");
    } catch { setError("שגיאת רשת"); }
    setBusy(false);
  };

  // Connected (QR poll says so) → one test message from the business's own number, once.
  useEffect(() => {
    if (step !== 5 || !qr.data?.connected || waTestSent) return;
    setWaTestSent(true);
    fetch("/api/admin/whatsapp/test-self", { method: "POST" }).then(r => { if (r.ok) setWaStatus("connected"); }).catch(() => {});
  }, [step, qr.data?.connected, waTestSent]);

  const activate = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/admin/agent", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isEnabled: true }) });
      if (!r.ok) { setError("הפעלת הסוכן נכשלה"); setBusy(false); return; }
      await fetch("/api/admin/onboarding/complete", { method: "POST" });
      router.push("/admin"); router.refresh();
    } catch { setError("שגיאה בהפעלה"); setBusy(false); }
  };

  const finishLater = async () => {
    await fetch("/api/admin/onboarding/complete", { method: "POST" }).catch(() => {});
    router.push("/admin"); router.refresh();
  };

  if (loading) return <Shell step={0}><div className="text-center text-slate-500 py-10">טוען…</div></Shell>;

  return (
    <Shell step={step} onSkipAll={finishLater}>
      {error && <div className="mb-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

      {step === 0 && (
        <Card title={`בוא נקים את Chator ל${vocab.place} שלך`} sub="עשר דקות, מהנייד. כל שלב נשמר — אפשר לעצור ולחזור.">
          <ul className="text-sm text-slate-600 space-y-1.5 mb-5">
            {["פרטי העסק ושעות הפעילות", `${vocab.staffPluralDef} והשירותים`, "איך הסוכן מדבר עם הלקוחות", "חיבור הוואטסאפ של העסק"].map(t => <li key={t} className="flex gap-2"><span style={{ color: C.turquoise }}>●</span>{t}</li>)}
          </ul>
          <label className="block text-sm text-slate-600 mb-1">סיסמה לכניסה בפעם הבאה <span className="text-slate-400">(לא חובה עכשיו)</span></label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={input} placeholder="לפחות 6 תווים" dir="ltr" />
          <Primary onClick={saveWelcome} busy={busy}>מתחילים</Primary>
        </Card>
      )}

      {step === 1 && (
        <Card title="העסק" sub="אפשר לשנות הכל אחר כך בהגדרות.">
          <Field label={`שם ${vocab.placeDef}`}><input value={name} onChange={e => setName(e.target.value)} className={input} placeholder={vocab.type === "barber_men" ? "המספרה של דני" : vocab.placeDef} /></Field>
          <Field label="טלפון העסק"><input value={phone} onChange={e => setPhone(e.target.value)} className={input} dir="ltr" placeholder="050-0000000" /></Field>
          <Field label="כתובת"><input value={address} onChange={e => setAddress(e.target.value)} className={input} placeholder="רחוב ומספר, עיר" /></Field>
          <Field label="לוגו (לא חובה)">
            <div className="flex items-center gap-3">
              {logoUrl ? <img src={logoUrl} alt="" className="w-14 h-14 rounded-xl object-cover border border-slate-200" /> : <div className="w-14 h-14 rounded-xl bg-slate-100" />}
              <label className="text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white cursor-pointer">בחר תמונה<input type="file" accept="image/*" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { const u = await uploadImage(f); if (u) setLogoUrl(u); } }} /></label>
            </div>
          </Field>
          <Field label="שעות פעילות">
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
        <Card title="הצוות" sub={`מי ${vocab.works} אצלכם. הטלפון משמש להתראות ולכניסה אישית ליומן.`}>
          <div className="space-y-2">
            {members.map((m, i) => (
              <div key={i} className="flex gap-2">
                <input value={m.name} onChange={e => setMembers(a => a.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className={input} placeholder={i === 0 ? "השם שלך" : `שם ${vocab.staff}`} disabled={!!m.id} />
                <input value={m.phone} onChange={e => setMembers(a => a.map((x, j) => j === i ? { ...x, phone: e.target.value } : x))} className={input} dir="ltr" placeholder="טלפון" disabled={!!m.id} />
                {!m.id && members.length > 1 && <button type="button" onClick={() => setMembers(a => a.filter((_, j) => j !== i))} className="text-slate-400 px-1">✕</button>}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setMembers(a => [...a, { name: "", phone: "" }])} className="mt-3 text-sm font-medium" style={{ color: C.petrol }}>+ עוד {vocab.staff}</button>
          <p className="text-xs text-slate-400 mt-3">ברירת מחדל: כולם עושים את כל השירותים, בשעות הפעילות שהגדרת. אפשר לדייק לכל אחד אחר כך.</p>
          <Primary onClick={saveTeam} busy={busy}>המשך</Primary>
        </Card>
      )}

      {step === 3 && (
        <Card title="השירותים" sub="הכנו רשימה במחירי שוק. שנה, מחק, הוסף.">
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_72px_72px_24px] gap-2 text-[11px] text-slate-400 px-1"><span>שירות</span><span>מחיר ₪</span><span>דקות</span><span /></div>
            {services.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_72px_72px_24px] gap-2 items-center">
                <input value={s.name} onChange={e => setServices(a => a.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} className={input} disabled={!!s.id} />
                <input value={s.price} onChange={e => setServices(a => a.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} className={input} type="number" dir="ltr" disabled={!!s.id} />
                <input value={s.duration} onChange={e => setServices(a => a.map((x, j) => j === i ? { ...x, duration: e.target.value } : x))} className={input} type="number" dir="ltr" disabled={!!s.id} />
                {!s.id ? <button type="button" onClick={() => setServices(a => a.filter((_, j) => j !== i))} className="text-slate-400">✕</button> : <span className="text-emerald-500 text-sm">✓</span>}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setServices(a => [...a, { name: "", price: "", duration: "30" }])} className="mt-3 text-sm font-medium" style={{ color: C.petrol }}>+ שירות</button>
          <Primary onClick={saveServices} busy={busy}>המשך</Primary>
        </Card>
      )}

      {step === 4 && (
        <Card title="הסוכן" sub="איך הוא מדבר עם הלקוחות שלך. הבסיס כבר מוכן — כאן רק הדברים שמשתנים מעסק לעסק.">
          <Field label="איך לקוחות יקראו לו"><input value={agentName} onChange={e => setAgentName(e.target.value)} className={input} placeholder="הסוכן" /></Field>
          {fields.map(f => (
            <Field key={f.key} label={f.question.replace(/\s*\(.*?\)\s*$/, "")}>
              {f.type === "choice" && f.options ? (
                <div className="flex flex-wrap gap-1.5">
                  {f.options.map(o => { const on = (setup[f.key] ?? f.default) === o; return <button key={o} type="button" onClick={() => setSetup(s => ({ ...s, [f.key]: o }))} className={chip(on)} style={on ? { background: C.petrol } : {}}>{o}</button>; })}
                </div>
              ) : f.type === "bool" ? (
                <div className="flex gap-1.5">
                  {[true, false].map(v => { const on = (setup[f.key] ?? f.default) === v; return <button key={String(v)} type="button" onClick={() => setSetup(s => ({ ...s, [f.key]: v }))} className={chip(on)} style={on ? { background: C.petrol } : {}}>{v ? "כן" : "לא"}</button>; })}
                </div>
              ) : f.key === "styleNotes" ? (
                <textarea value={String(setup[f.key] ?? "")} onChange={e => setSetup(s => ({ ...s, [f.key]: e.target.value }))} className={input} rows={3} placeholder="כמה מילים בסגנון שלך" />
              ) : (
                <input value={String(setup[f.key] ?? "")} onChange={e => setSetup(s => ({ ...s, [f.key]: e.target.value }))} className={input} placeholder={typeof f.default === "string" ? f.default : ""} />
              )}
            </Field>
          ))}
          <Field label="ההודעה שלקוח מקבל כשהסוכן לא זמין (למשל כשחבילת החודש נגמרה)">
            <textarea value={unavailableMsg} onChange={e => setUnavailableMsg(e.target.value)} className={input} rows={3} />
            <div className="text-[11px] text-slate-400 mt-1">{"{{name}}"} = שם הלקוח, {"{{link}}"} = קישור ההזמנה</div>
          </Field>

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
            <div className="text-[11px] text-slate-500 mt-2">ארגז חול: כלום לא נשלח ולא נשמר ביומן.</div>
          </div>
          <Primary onClick={() => saveAgent(true)} busy={busy}>המשך</Primary>
        </Card>
      )}

      {step === 5 && (
        <Card title="הוואטסאפ של העסק" sub="הסוכן עונה מהמספר של העסק — הלקוחות ממשיכים לכתוב לאותו מספר שהם מכירים.">
          {waStatus === "not_requested" ? (
            <>
              <p className="text-sm text-slate-600 mb-4">לוחצים פעם אחת. Chator מכין את החיבור (בדרך כלל תוך שעה בשעות העבודה), ואז מופיע כאן קוד לסריקה מאפליקציית הוואטסאפ במכשיר של העסק.</p>
              <Primary onClick={requestWhatsApp} busy={busy}>חבר לי את המספר</Primary>
            </>
          ) : (
            <>
              {qr.data?.error && !qr.data?.qr && !qr.data?.connected ? (
                <div className="rounded-2xl px-4 py-5 text-center" style={{ background: C.mist }}>
                  <div className="text-2xl mb-1">⏳</div>
                  <p className="text-sm font-semibold" style={{ color: C.petrol }}>הבקשה התקבלה — Chator מכין את החיבור</p>
                  <p className="text-xs text-slate-500 mt-1">בדרך כלל תוך שעה בשעות העבודה. כשיהיה מוכן יופיע כאן קוד לסריקה, וגם נעדכן אותך בוואטסאפ. אפשר להמשיך בינתיים.</p>
                </div>
              ) : (
                <WhatsAppQrBody data={qr.data} loading={qr.loading} errorHint="נסה שוב בעוד רגע." />
              )}
              {qr.data?.qr && <p className="text-xs text-slate-500 mt-2">במכשיר של העסק: וואטסאפ ← הגדרות ← מכשירים מקושרים ← קישור מכשיר ← סרוק.</p>}
              {qr.data?.qr && <PairingCodeFallback />}
              {qr.data?.connected && <p className="text-sm text-emerald-700 mt-2">{waTestSent ? "שלחנו לך הודעת בדיקה מהמספר של העסק." : ""}</p>}
            </>
          )}
          <div className="flex items-center justify-between mt-5">
            <button type="button" onClick={() => goTo(6, waStatus === "connected" ? "whatsapp" : undefined)} className="text-sm text-slate-500">{waStatus === "connected" || qr.data?.connected ? "המשך" : "אמשיך בלי לחבר עכשיו"}</button>
          </div>
        </Card>
      )}

      {step === 6 && (
        <Card title="הפעלה" sub="רגע לפני שהסוכן מתחיל לענות ללקוחות.">
          <ul className="space-y-2 text-sm">
            {[
              ["העסק ושעות הפעילות", done.includes("business")],
              [`${vocab.staffPluralDef}: ${members.filter(m => m.id).length}`, members.some(m => m.id)],
              [`שירותים: ${services.filter(s => s.id).length}`, services.some(s => s.id)],
              ["הגדרות הסוכן", done.includes("agent")],
              ["וואטסאפ מחובר", waStatus === "connected" || !!qr.data?.connected],
            ].map(([label, ok]) => (
              <li key={String(label)} className="flex items-center gap-2"><span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center text-white ${ok ? "" : "bg-slate-300"}`} style={ok ? { background: C.turquoise, color: C.ink } : {}}>{ok ? "✓" : "·"}</span><span className={ok ? "text-slate-800" : "text-slate-500"}>{label as string}</span></li>
            ))}
          </ul>
          {!(waStatus === "connected" || qr.data?.connected) && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-4">בלי וואטסאפ מחובר הסוכן לא יכול לענות ללקוחות. אפשר להפעיל עכשיו ולחבר אחר כך מההגדרות.</p>}
          {agentEnabled && <p className="text-xs text-emerald-700 mt-3">הסוכן כבר פעיל.</p>}
          <Primary onClick={activate} busy={busy}>{agentEnabled ? "סיים והיכנס למערכת" : "הפעל את הסוכן"}</Primary>
          <p className="text-xs text-slate-500 text-center mt-3">אחרי ההפעלה: שלח לעצמך בוואטסאפ של העסק "יש תור מחר?" ותראה אותו עונה.</p>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mt-4"><label className="block text-sm text-slate-600 mb-1.5">{label}</label>{children}</div>;
}

function Primary({ onClick, busy, children }: { onClick: () => void; busy?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="mt-6 w-full rounded-2xl py-3.5 text-[15px] font-bold text-white disabled:opacity-60 transition active:scale-[0.99]" style={{ background: C.coral }}>
      {busy ? "רגע…" : children}
    </button>
  );
}
