"use client";

import Link from "next/link";
import { useState, useContext, useEffect } from "react";
import { C, TONE, Btn, Card, MoreMenu, useCrm, crmAction, STAGE_TONE, SOURCE_LABEL } from "../../ui";
import { InModal } from "../../card-context";
import { WaButton, WaPanel } from "../../WaPanel";
import { attributionLabel } from "@/lib/lead-attribution";

/**
 * The sales card, in the customer card's four layers (26.10.2026): who and where he is,
 * seen on open; וואטסאפ, חייג and the next step; the ⋯ menu; and boxes that open
 * (the sales call and its outcome, the automation, details, notes).
 */
type Msg = { id: string; role: string; content: string; source: string | null; createdAt: string; mediaUrl?: string | null; mediaType?: string | null };
type Call = { id: string; startsAt: string; status: string; outcome: string | null; label: string; rep: string };
type Data = {
  lead: { id: string; name: string | null; phone: string; businessName: string | null; businessType: string | null; shopSize: string | null; source: string; attribution?: string | null; stage: string; summary: string | null; optedOut: boolean; rep: string | null; repId: string | null; followUpAt: string | null; lostReason: string | null; businessId: string | null; createdAt: string };
  stages: { key: string; label: string }[];
  reps: { id: string; name: string }[];
  agentPausedUntil: string | null;
  messages: Msg[];
  calls: Call[];
  notes: { id: string; author: string; body: string; createdAt: string }[];
  automation: { runId: string; name: string; steps: { text: string; done: boolean; when: string }[] } | null;
  history: { name: string; status: string; stopReason: string | null; at: string }[];
  slots: { iso: string; label: string; repId: string; rep: string }[];
};

const time = (iso: string) => new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
const who = (m: Msg) => (m.role === "user" ? "הליד" : m.source === "admin" ? "נציג" : "הסוכן");

export default function LeadCard({ id }: { id: string }) {
  const inModal = useContext(InModal);
  const { data, error, reload } = useCrm<Data>(`view=lead&id=${id}`);
  const [waOpen, setWaOpen] = useState(false);
  // Opened from "היום" with ?wa=1: the chat is open already.
  useEffect(() => { if (new URLSearchParams(window.location.search).get("wa") === "1") setWaOpen(true); }, []);
  // A box the ⋯ menu or the next step opened (Card keeps its own state, so it remounts open).
  const [box, setBox] = useState<string | null>(null);
  const openBox = (k: string) => { setBox(k); setTimeout(() => document.getElementById(`box-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pickSlot, setPickSlot] = useState(false);
  const [later, setLater] = useState(false);
  const [laterDate, setLaterDate] = useState("");

  async function act(key: string, body: Record<string, unknown>, done?: string) {
    setBusy(key); setFlash(null);
    const r = await crmAction(body);
    setBusy(null);
    setFlash(r.ok ? (done ?? null) : r.error ?? "שגיאה");
    if (r.ok) await reload();
    return r;
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p style={{ color: C.muted }}>טוען…</p>;
  const l = data.lead;
  const booked = data.calls.find(c => c.status === "booked");
  const callPast = !!booked && new Date(booked.startsAt).getTime() < Date.now();
  const last = data.messages[data.messages.length - 1];
  const waiting = last?.role === "user";
  const openChat = () => { setWaOpen(true); setTimeout(() => document.getElementById("wa-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); };
  const scheduleCall = () => { setPickSlot(true); openBox("call"); };
  const notRelevant = () => { const reason = prompt("למה לא רלוונטי? (לא חובה)"); if (reason !== null) void act("nr", { action: "call.outcome", leadId: l.id, outcome: "not_relevant", callId: booked?.id, lostReason: reason }, "סומן לא רלוונטי"); };

  // Where he is, in one sentence.
  const state: { tone: "bad" | "warn" | "info" | "ok"; title: string; sub?: string } =
    l.optedOut ? { tone: "bad", title: "ביקש להסיר", sub: "אוטומציות לא יישלחו אליו." } :
    l.businessId ? { tone: "ok", title: "נהיה לקוח", sub: "העסק שלו נפתח. ההמשך בכרטיס הלקוח." } :
    booked ? { tone: callPast ? "warn" : "info", title: `שיחה ${booked.label}`, sub: callPast ? "השיחה עברה. מה יצא?" : `אצל ${booked.rep} · הנציג מתקשר` } :
    data.agentPausedUntil ? { tone: "warn", title: "אתה עונה לו", sub: `הסוכן שותק עד ${time(data.agentPausedUntil)}` } :
    l.followUpAt ? { tone: "info", title: `לחזור אליו ${time(l.followUpAt)}` } :
    data.automation ? { tone: "info", title: `האוטומציה פעילה: ${data.automation.name}`, sub: data.automation.steps.find(s => !s.done)?.when ? `ההודעה הבאה ${data.automation.steps.find(s => !s.done)!.when}` : undefined } :
    l.stage === "not_relevant" ? { tone: "info", title: "לא רלוונטי", sub: l.lostReason ?? undefined } :
    { tone: "warn", title: "אין צעד קבוע", sub: "אין שיחה ואין תזכורות פעילות." };

  // The next step: one place, named by the situation.
  const next: { label: string; run: () => void } | null =
    l.businessId ? { label: "לכרטיס הלקוח", run: () => { window.location.href = `/admin/crm/customers/${l.businessId}`; } } :
    callPast ? { label: "מה יצא בשיחה?", run: () => openBox("call") } :
    waiting ? { label: "ענה לו", run: openChat } :
    !booked && !l.optedOut && l.stage !== "not_relevant" && l.stage !== "paying" ? { label: "קבע שיחה", run: scheduleCall } :
    null;

  const more = [
    ...(!booked ? [{ label: "קבע שיחה", onClick: scheduleCall }] : [{ label: "הזז את השיחה", onClick: scheduleCall }]),
    { label: "שייך לנציג", onClick: () => openBox("details") },
    { label: "שנה שלב", onClick: () => openBox("details") },
    ...(data.automation ? [{ label: "עצור את התזכורות", onClick: () => void act("stop", { action: "lead.stopAutomation", id: l.id }, "האוטומציה נעצרה") }] : []),
    ...(l.businessId ? [{ label: "כרטיס הלקוח", onClick: () => { window.location.href = `/admin/crm/customers/${l.businessId}`; } }] : []),
    ...(l.stage !== "not_relevant" ? [{ label: "לא רלוונטי", danger: true, onClick: notRelevant }] : []),
  ];

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {!inModal && <Link href="/admin/crm/leads" className="text-sm" style={{ color: C.petrol }}>→ חזרה ללידים</Link>}

      {/* 1 · Seen on open */}
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="m-0 text-[26px] font-extrabold">{l.name || l.phone}</h1>
          <span className="text-[13px] font-bold px-3 py-1.5 rounded-full" style={{ background: C.mist, color: C.petrol }}>{data.stages.find(s => s.key === l.stage)?.label ?? STAGE_TONE[l.stage]?.label ?? l.stage}</span>
        </div>
        <span className="text-sm" style={{ color: C.muted }}>{[l.businessName, l.shopSize, l.phone, SOURCE_LABEL[l.source] ?? l.source, attributionLabel(l.attribution), l.rep ? `נציג: ${l.rep}` : null].filter(Boolean).join(" · ")}</span>
      </header>
      <section className="rounded-[18px] px-4 py-3.5 flex flex-col gap-0.5" style={{ background: TONE[state.tone].bg, color: TONE[state.tone].color }}>
        <b className="text-[17px]">{state.title}</b>
        {state.sub && <span className="text-sm">{state.sub}</span>}
      </section>
      {last && (
        <button type="button" onClick={openChat} className="text-right bg-white rounded-2xl px-4 py-3 text-sm leading-relaxed" style={{ border: `1px solid ${C.line}`, color: C.ink }}>
          <span className="block text-[12px] font-semibold" style={{ color: waiting ? "#B42318" : C.muted }}>{waiting ? "כתב ועוד לא ענו לו" : `ההודעה האחרונה, ${who(last)}`} · {time(last.createdAt)}</span>
          {last.content.length > 160 ? `${last.content.slice(0, 160)}…` : last.content}
        </button>
      )}

      {/* 2 · Up to three buttons, and ⋯ */}
      <div className="flex flex-wrap items-center gap-2">
        <WaButton open={waOpen} onClick={() => setWaOpen(o => !o)} count={data.messages.length} waiting={waiting} />
        <a href={`tel:${l.phone}`} className="min-h-[44px] px-4 rounded-xl text-sm font-semibold inline-flex items-center" style={{ border: `1px solid ${C.petrol}`, color: C.petrol, textDecoration: "none" }}>חייג</a>
        {next && <Btn kind="primary" disabled={!!busy} onClick={next.run}>{next.label}</Btn>}
        <MoreMenu items={more} />
      </div>
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}
      {waOpen && (
        <div id="wa-panel">
          <WaPanel
            messages={data.messages}
            who={who}
            placeholder="לכתוב לו בעצמך"
            status={data.agentPausedUntil
              ? <span className="text-xs flex items-center gap-2" style={{ color: "#7A4A00" }}>הסוכן שותק עד {time(data.agentPausedUntil)}<button type="button" className="underline min-h-[32px]" onClick={() => act("resume", { action: "lead.resumeAgent", id: l.id }, "הסוכן חזר לענות")}>החזר את הסוכן</button></span>
              : <span className="text-xs" style={{ color: "#3E5A5B" }}>הסוכן מטפל · הודעה שלך משתיקה אותו ל-24 שעות</span>}
            onSend={async body => (await act("msg", { action: "lead.message", id: l.id, body }, "נשלח")).ok}
            name={l.name}
            voice={{ to: "lead", id: l.id }}
            onSent={() => void reload()}
          />
        </div>
      )}

      {/* 3 · Boxes that open */}
      <div id="box-call" className="scroll-mt-4">
        <Card key={box === "call" ? "call-open" : "call"} collapsible defaultOpen={box === "call" || callPast} title="שיחת מכירה" aside={booked ? booked.label : l.followUpAt ? `לחזור ${time(l.followUpAt)}` : "לא נקבעה"}>
          <div className="flex flex-col gap-3">
            {booked ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm flex-1">שיחה {booked.label} · אצל {booked.rep} · 10 דקות</span>
                <Btn className="!min-h-[38px]" onClick={() => setPickSlot(s => !s)}>הזז</Btn>
                <Btn kind="danger" className="!min-h-[38px]" disabled={!!busy} onClick={() => confirm("לבטל את השיחה?") && act("cancel", { action: "call.cancel", callId: booked.id }, "השיחה בוטלה")}>בטל</Btn>
              </div>
            ) : (
              !pickSlot && <Btn kind="dark" className="self-start" onClick={() => setPickSlot(true)}>קבע שיחה</Btn>
            )}
            {pickSlot && (
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
                {data.slots.length === 0 && <span className="text-sm col-span-2" style={{ color: C.muted }}>אין שעות פנויות. פתח חלון ביומן.</span>}
                {data.slots.map(s => (
                  <button key={s.iso} type="button" disabled={!!busy} onClick={async () => { const r = await act("book", { action: "call.book", leadId: l.id, startsAt: s.iso, repId: s.repId }, "השיחה נקבעה, הליד יקבל תזכורות"); if (r.ok) setPickSlot(false); }} className="min-h-[44px] rounded-[10px] text-[13px] px-2" style={{ background: C.mist, color: C.petrol, border: `1px solid ${C.line}` }}>{s.label}<span className="block text-[11px]" style={{ color: C.muted }}>{s.rep}</span></button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2 pt-3" style={{ borderTop: `1px solid ${C.soft}` }}>
              <span className="text-[13px] font-semibold">אחרי השיחה: מה יצא?</span>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
                <Btn kind="primary" disabled={!!busy} onClick={() => confirm("לסמן נסגר? ייפתח לו עסק ויישלח קישור הקמה אישי בוואטסאפ.") && act("won", { action: "call.outcome", leadId: l.id, outcome: "won", callId: booked?.id }, "נסגר! העסק נפתח וקישור ההקמה נשלח")}>נסגר ← הקמה</Btn>
                <Btn onClick={() => setLater(s => !s)}>לחזור אליו</Btn>
                <Btn disabled={!!busy} onClick={() => act("noans", { action: "call.outcome", leadId: l.id, outcome: "no_answer", callId: booked?.id }, "סומן. אם האוטומציה פעילה, הוא יקבל הצעה לשעה אחרת")}>לא ענה</Btn>
                <Btn kind="danger" disabled={!!busy} onClick={notRelevant}>לא רלוונטי</Btn>
              </div>
              {later && (
                <div className="flex gap-2 items-end">
                  <label className="flex flex-col gap-1 text-xs flex-1" style={{ color: C.muted }}>מתי
                    <input type="date" value={laterDate} onChange={e => setLaterDate(e.target.value)} className="h-11 rounded-xl px-3 text-sm" style={{ border: "1px solid #C7D8D5" }} />
                  </label>
                  <Btn kind="dark" disabled={!laterDate || !!busy} onClick={async () => { const r = await act("later", { action: "call.outcome", leadId: l.id, outcome: "later", callId: booked?.id, followUpAt: `${laterDate}T07:00:00.000Z` }, "נקבע. באותו בוקר תצא אליו הודעה (אם האוטומציה פעילה)"); if (r.ok) setLater(false); }}>שמור</Btn>
                </div>
              )}
              <p className="m-0 text-xs" style={{ color: C.muted }}>כל בחירה מעדכנת את השלב ומפעילה את האוטומציה שלה.</p>
            </div>
          </div>
        </Card>
      </div>

      <Card collapsible title="אוטומציה" aside={data.automation ? data.automation.name : "אין פעילה"}>
        {!data.automation && <p className="m-0 text-sm" style={{ color: C.muted }}>אין אוטומציה פעילה על הליד הזה.</p>}
        {data.automation && (
          <>
            {data.automation.steps.map((s, i) => (
              <div key={i} className="flex gap-2.5 items-start mb-2">
                <span className="w-[22px] h-[22px] rounded-full text-xs font-bold inline-flex items-center justify-center shrink-0" style={s.done ? { background: "#E3F7EF", color: "#0F6B4F" } : { background: C.soft, color: C.muted }}>{s.done ? "✓" : i + 1}</span>
                <div className="min-w-0"><div className="text-[13px]" style={{ color: s.done ? C.ink : C.muted }}>{s.text.slice(0, 90)}{s.text.length > 90 ? "…" : ""}</div><div className="text-xs" style={{ color: C.muted }}>{s.when}</div></div>
              </div>
            ))}
            <button type="button" className="text-[13px] font-semibold min-h-[40px]" style={{ color: "#B42318" }} onClick={() => act("stop", { action: "lead.stopAutomation", id: l.id }, "האוטומציה נעצרה")}>עצור את התזכורות</button>
          </>
        )}
        {data.history.length > 0 && <p className="m-0 mt-1 text-xs" style={{ color: C.muted }}>קודם: {data.history.slice(0, 3).map(h => `${h.name} (${h.status === "done" ? "הסתיימה" : "נעצרה"})`).join(" · ")}</p>}
      </Card>

      <div id="box-details" className="scroll-mt-4">
        <Card key={box === "details" ? "details-open" : "details"} collapsible defaultOpen={box === "details"} title="פרטים" aside={l.rep ? `נציג: ${l.rep}` : undefined}>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1.5">
              <span style={{ color: C.muted }}>שלב</span>
              <div role="group" aria-label="שלב" className="flex flex-wrap gap-1.5">
                {data.stages.map(s => {
                  const on = s.key === l.stage;
                  return <button key={s.key} type="button" disabled={!!busy} onClick={() => !on && act("stage", { action: "lead.update", id: l.id, stage: s.key }, "השלב עודכן")} className="h-9 px-3 rounded-full text-[13px]" style={on ? { background: C.petrol, color: "#fff", border: `1px solid ${C.petrol}`, fontWeight: 700 } : { background: "#fff", color: C.ink, border: "1px solid #C7D8D5" }}>{s.label}</button>;
                })}
              </div>
            </div>
            <label className="flex items-center justify-between gap-2">נציג
              <select value={l.repId ?? ""} onChange={e => act("rep", { action: "lead.update", id: l.id, repId: e.target.value }, "הנציג עודכן")} className="h-10 rounded-lg px-2 text-sm" style={{ border: "1px solid #C7D8D5" }}>
                {data.reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            {l.summary && <p className="m-0 text-[13px] leading-relaxed" style={{ color: "#3E5A5B" }}><b>מה כתב בשיחה:</b> {l.summary}</p>}
            {l.lostReason && <p className="m-0 text-[13px]" style={{ color: "#B42318" }}>סיבה: {l.lostReason}</p>}
            {l.businessId && <Link href={`/admin/crm/customers/${l.businessId}`} className="text-[13px] font-semibold" style={{ color: C.petrol }}>כרטיס הלקוח ←</Link>}
          </div>
        </Card>
      </div>

      <Card collapsible title="הערות" aside={data.notes.length ? `${data.notes.length} הערות` : undefined}>
        <div className="flex gap-2 mb-3">
          <label className="sr-only" htmlFor="crm-note">הערה</label>
          <input id="crm-note" value={note} onChange={e => setNote(e.target.value)} placeholder="מה חשוב לזכור" className="flex-1 h-11 rounded-xl px-3 text-sm" style={{ border: "1px solid #C7D8D5" }} />
          <Btn kind="dark" disabled={!note.trim() || !!busy} onClick={async () => { const r = await act("note", { action: "lead.note", id: l.id, body: note }); if (r.ok) setNote(""); }}>הוסף</Btn>
        </div>
        {data.notes.map(n => <p key={n.id} className="m-0 mb-2 text-[13px]"><b>{n.author}</b> · <span style={{ color: C.muted }}>{time(n.createdAt)}</span><br />{n.body}</p>)}
      </Card>
    </div>
  );
}
