"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { C, Btn, Card, useCrm, crmAction, STAGE_TONE, SOURCE_LABEL } from "../../ui";

type Msg = { id: string; role: string; content: string; source: string | null; createdAt: string };
type Call = { id: string; startsAt: string; status: string; outcome: string | null; label: string; rep: string };
type Data = {
  lead: { id: string; name: string | null; phone: string; businessName: string | null; businessType: string | null; shopSize: string | null; source: string; stage: string; summary: string | null; optedOut: boolean; rep: string | null; repId: string | null; followUpAt: string | null; lostReason: string | null; businessId: string | null; createdAt: string };
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

export default function LeadCard() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useCrm<Data>(`view=lead&id=${id}`);
  const [text, setText] = useState("");
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
  const initials = (l.name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("");

  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/crm/leads" className="text-sm" style={{ color: C.petrol }}>→ חזרה ללידים</Link>

      <header className="flex flex-wrap items-center justify-between gap-3.5">
        <div className="flex items-center gap-3.5">
          <span className="w-[52px] h-[52px] rounded-full inline-flex items-center justify-center font-extrabold text-xl" style={{ background: C.mist, color: C.petrol }}>{initials}</span>
          <div>
            <h1 className="m-0 text-2xl font-extrabold">{l.name || l.phone}</h1>
            <span className="text-sm" style={{ color: C.muted }}>{[l.businessName, l.shopSize, l.phone, SOURCE_LABEL[l.source] ?? l.source].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        <div role="group" aria-label="שלב" className="flex flex-wrap gap-1.5">
          {data.stages.map(s => {
            const on = s.key === l.stage;
            return <button key={s.key} type="button" disabled={!!busy} onClick={() => !on && act("stage", { action: "lead.update", id: l.id, stage: s.key }, "השלב עודכן")} className="h-9 px-3 rounded-full text-[13px]" style={on ? { background: C.petrol, color: "#fff", border: `1px solid ${C.petrol}`, fontWeight: 700 } : { background: "#fff", color: C.ink, border: "1px solid #C7D8D5" }}>{s.label}</button>;
          })}
        </div>
      </header>
      {flash && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: C.mist, color: C.petrol }}>{flash}</p>}
      {l.optedOut && <p className="m-0 text-sm rounded-xl px-3 py-2" style={{ background: "#FDECEA", color: "#B42318" }}>הליד ביקש להסיר. אוטומציות לא יישלחו אליו.</p>}

      <div className="flex flex-wrap gap-4 items-start">
        <section aria-label="שיחת וואטסאפ" className="flex-[999_1_440px] min-w-0 rounded-[18px] p-4 flex flex-col gap-2.5" style={{ background: "#EFE9E1" }}>
          <div className="flex flex-wrap justify-between items-center gap-2">
            <h2 className="m-0 text-base font-bold">וואטסאפ · המספר של צ׳אטור</h2>
            {data.agentPausedUntil
              ? <span className="text-xs flex items-center gap-2" style={{ color: "#7A4A00" }}>הסוכן שותק עד {time(data.agentPausedUntil)}<button type="button" className="underline min-h-[32px]" onClick={() => act("resume", { action: "lead.resumeAgent", id: l.id }, "הסוכן חזר לענות")}>החזר את הסוכן</button></span>
              : <span className="text-xs" style={{ color: "#3E5A5B" }}>הסוכן מטפל · הודעה שלך משתיקה אותו ל-24 שעות</span>}
          </div>
          <div className="flex flex-col gap-2 max-h-[560px] overflow-y-auto">
            {data.messages.length === 0 && <p className="m-0 text-sm text-center py-6" style={{ color: "#6B7F80" }}>עוד אין הודעות בשיחה הזאת.</p>}
            {data.messages.map(m => {
              const mine = m.role !== "user";
              return (
                <div key={m.id} className="flex" style={{ justifyContent: mine ? "flex-start" : "flex-end" }}>
                  <div className="max-w-[78%] rounded-[14px] px-3 py-2 flex flex-col gap-0.5" style={{ background: mine ? "#D9FDD3" : "#fff", boxShadow: "0 1px 0 rgba(0,0,0,0.06)" }}>
                    <span className="text-[11px] font-bold" style={{ color: mine ? "#0F6B4F" : "#7A4A00" }}>{who(m)}</span>
                    <span className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</span>
                    <span className="text-[11px] self-end" style={{ color: "#6B7F80" }}>{time(m.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 items-center bg-white rounded-full ps-4 pe-1.5 py-1">
            <label className="sr-only" htmlFor="crm-msg">הודעה לליד</label>
            <input id="crm-msg" value={text} onChange={e => setText(e.target.value)} placeholder="לכתוב לו בעצמך" className="flex-1 h-10 bg-transparent outline-none text-sm" />
            <Btn kind="dark" className="rounded-full" disabled={!text.trim() || busy === "msg"} onClick={async () => { const r = await act("msg", { action: "lead.message", id: l.id, body: text }, "נשלח"); if (r.ok) setText(""); }}>{busy === "msg" ? "שולח…" : "שלח"}</Btn>
          </div>
        </section>

        <aside className="flex-[1_1_320px] min-w-0 flex flex-col gap-4">
          <Card dark>
            <span className="text-xs font-semibold" style={{ color: "#A9C9C4" }}>השלב הבא</span>
            {booked ? (
              <>
                <div className="text-xl font-extrabold mt-1">שיחה {booked.label}</div>
                <div className="text-sm mt-1" style={{ color: "#CFE3DF" }}>אצל {booked.rep} · 10 דקות · הנציג מתקשר</div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <a href={`tel:${l.phone}`} className="min-h-[40px] px-3.5 rounded-[10px] text-sm font-bold inline-flex items-center" style={{ background: C.turquoise, color: C.ink, textDecoration: "none" }}>חייג עכשיו</a>
                  <Btn kind="ghost" style={{ color: "#fff", border: "1px solid #36585A" }} onClick={() => setPickSlot(s => !s)}>הזז</Btn>
                  <Btn kind="ghost" style={{ color: "#FFB4A8" }} disabled={!!busy} onClick={() => confirm("לבטל את השיחה?") && act("cancel", { action: "call.cancel", callId: booked.id }, "השיחה בוטלה")}>בטל</Btn>
                </div>
              </>
            ) : (
              <>
                <div className="text-lg font-bold mt-1">{l.followUpAt ? `לחזור אליו ${time(l.followUpAt)}` : "אין שיחה קבועה"}</div>
                <Btn kind="ghost" className="mt-2" style={{ color: C.ink, background: C.turquoise }} onClick={() => setPickSlot(s => !s)}>קבע שיחה</Btn>
              </>
            )}
            {pickSlot && (
              <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
                {data.slots.length === 0 && <span className="text-sm col-span-2" style={{ color: "#CFE3DF" }}>אין שעות פנויות. פתח חלון ביומן.</span>}
                {data.slots.map(s => (
                  <button key={s.iso} type="button" disabled={!!busy} onClick={async () => { const r = await act("book", { action: "call.book", leadId: l.id, startsAt: s.iso, repId: s.repId }, "השיחה נקבעה, הליד יקבל תזכורות"); if (r.ok) setPickSlot(false); }} className="min-h-[44px] rounded-[10px] text-[13px] px-2" style={{ background: C.petrol2, color: "#fff", border: "1px solid #36585A" }}>{s.label}<span className="block text-[11px]" style={{ color: "#A9C9C4" }}>{s.rep}</span></button>
                ))}
              </div>
            )}
          </Card>

          <Card title="אחרי השיחה: מה יצא?">
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
              <Btn kind="primary" disabled={!!busy} onClick={() => confirm("לסמן נסגר? ייפתח לו עסק ויישלח קישור הקמה אישי בוואטסאפ.") && act("won", { action: "call.outcome", leadId: l.id, outcome: "won", callId: booked?.id }, "נסגר! העסק נפתח וקישור ההקמה נשלח")}>נסגר ← הקמה</Btn>
              <Btn onClick={() => setLater(s => !s)}>לחזור אליו</Btn>
              <Btn disabled={!!busy} onClick={() => act("noans", { action: "call.outcome", leadId: l.id, outcome: "no_answer", callId: booked?.id }, "סומן. אם האוטומציה פעילה, הוא יקבל הצעה לשעה אחרת")}>לא ענה</Btn>
              <Btn kind="danger" disabled={!!busy} onClick={() => { const reason = prompt("למה לא רלוונטי? (לא חובה)") ?? ""; void act("nr", { action: "call.outcome", leadId: l.id, outcome: "not_relevant", callId: booked?.id, lostReason: reason }, "סומן לא רלוונטי"); }}>לא רלוונטי</Btn>
            </div>
            {later && (
              <div className="flex gap-2 items-end mt-3">
                <label className="flex flex-col gap-1 text-xs flex-1" style={{ color: C.muted }}>מתי
                  <input type="date" value={laterDate} onChange={e => setLaterDate(e.target.value)} className="h-11 rounded-xl px-3 text-sm" style={{ border: "1px solid #C7D8D5" }} />
                </label>
                <Btn kind="dark" disabled={!laterDate || !!busy} onClick={async () => { const r = await act("later", { action: "call.outcome", leadId: l.id, outcome: "later", callId: booked?.id, followUpAt: `${laterDate}T07:00:00.000Z` }, "נקבע. באותו בוקר תצא אליו הודעה (אם האוטומציה פעילה)"); if (r.ok) setLater(false); }}>שמור</Btn>
              </div>
            )}
            <p className="m-0 mt-2 text-xs" style={{ color: C.muted }}>כל בחירה מעדכנת את השלב ומפעילה את האוטומציה שלה.</p>
          </Card>

          <Card title="אוטומציה" aside={data.automation ? <button type="button" className="text-[13px] font-semibold min-h-[44px]" style={{ color: "#B42318" }} onClick={() => act("stop", { action: "lead.stopAutomation", id: l.id }, "האוטומציה נעצרה")}>עצור</button> : undefined}>
            {!data.automation && <p className="m-0 text-sm" style={{ color: C.muted }}>אין אוטומציה פעילה על הליד הזה.</p>}
            {data.automation && (
              <>
                <div className="text-sm font-semibold mb-2">{data.automation.name}</div>
                {data.automation.steps.map((s, i) => (
                  <div key={i} className="flex gap-2.5 items-start mb-2">
                    <span className="w-[22px] h-[22px] rounded-full text-xs font-bold inline-flex items-center justify-center shrink-0" style={s.done ? { background: "#E3F7EF", color: "#0F6B4F" } : { background: C.soft, color: C.muted }}>{s.done ? "✓" : i + 1}</span>
                    <div className="min-w-0"><div className="text-[13px]" style={{ color: s.done ? C.ink : C.muted }}>{s.text.slice(0, 90)}{s.text.length > 90 ? "…" : ""}</div><div className="text-xs" style={{ color: C.muted }}>{s.when}</div></div>
                  </div>
                ))}
              </>
            )}
            {data.history.length > 0 && <p className="m-0 mt-1 text-xs" style={{ color: C.muted }}>קודם: {data.history.slice(0, 3).map(h => `${h.name} (${h.status === "done" ? "הסתיימה" : "נעצרה"})`).join(" · ")}</p>}
          </Card>

          <Card title="פרטים">
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center justify-between gap-2">נציג
                <select value={l.repId ?? ""} onChange={e => act("rep", { action: "lead.update", id: l.id, repId: e.target.value }, "הנציג עודכן")} className="h-10 rounded-lg px-2 text-sm" style={{ border: "1px solid #C7D8D5" }}>
                  {data.reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              {l.summary && <p className="m-0 text-[13px] leading-relaxed" style={{ color: "#3E5A5B" }}><b>מה כתב בשיחה:</b> {l.summary}</p>}
              {l.lostReason && <p className="m-0 text-[13px]" style={{ color: "#B42318" }}>סיבה: {l.lostReason}</p>}
              {l.businessId && <Link href={`/admin/crm/customers?focus=${l.businessId}`} className="text-[13px]" style={{ color: C.petrol }}>לעסק שנפתח ←</Link>}
              <span className="text-xs" style={{ color: C.muted }}>שלב: {STAGE_TONE[l.stage]?.label ?? l.stage}</span>
            </div>
          </Card>

          <Card title="הערות">
            <div className="flex gap-2 mb-3">
              <label className="sr-only" htmlFor="crm-note">הערה</label>
              <input id="crm-note" value={note} onChange={e => setNote(e.target.value)} placeholder="מה חשוב לזכור" className="flex-1 h-11 rounded-xl px-3 text-sm" style={{ border: "1px solid #C7D8D5" }} />
              <Btn kind="dark" disabled={!note.trim() || !!busy} onClick={async () => { const r = await act("note", { action: "lead.note", id: l.id, body: note }); if (r.ok) setNote(""); }}>הוסף</Btn>
            </div>
            {data.notes.map(n => <p key={n.id} className="m-0 mb-2 text-[13px]"><b>{n.author}</b> · <span style={{ color: C.muted }}>{time(n.createdAt)}</span><br />{n.body}</p>)}
          </Card>
        </aside>
      </div>
    </div>
  );
}
