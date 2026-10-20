"use client";

import { useEffect, useRef, useState } from "react";
import { C, crmAction } from "./ui";
import { VoiceBubble, VoiceComposer } from "@/components/Voice";

/**
 * The reply box of every WhatsApp chat in the CRM (20.10.2026, Yair: "אופציה
 * להקליט להודעות בווצאפ, ותעשה לי הודעות מהירות לשלוח ללידים ... שלא ישלח
 * ישר, שיופיע בכתב שאני אוכל לערוך"):
 * - ⚡ opens the quick replies; picking one only fills the box, with the name
 *   and links filled in, and he edits before sending. "עריכה" changes the list.
 * - An empty box shows the mic (voice note from Chator's line); text shows send.
 * Used by the lead card, the customer card and the chats screen.
 */
type Quick = { id: string; title: string; text: string };
export type VoiceTarget = { to: "lead" | "customer" | "chat"; id: string };

const firstName = (name: string | null | undefined) => (name || "").trim().split(/\s+/)[0] || "";

export function Composer({ placeholder, name, onSend, voice, onSent }: {
  placeholder: string;
  name?: string | null;
  onSend: (text: string) => Promise<boolean>;
  voice?: VoiceTarget | null;
  onSent?: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState<{ items: Quick[]; vars: Record<string, string> } | null>(null);
  const [editing, setEditing] = useState<Quick[] | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // The box grows with the text (a quick reply is several lines), up to ~8 lines, then scrolls.
  useEffect(() => { const el = box.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight + 2, 220)}px`; }, [text]);

  async function openQuick() {
    setQuickOpen(o => !o); setEditing(null);
    if (quick) return;
    const r = await fetch("/api/admin/crm?view=quickReplies", { cache: "no-store" }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    setQuick(j ? { items: j.items ?? [], vars: j.vars ?? {} } : { items: [], vars: {} });
  }
  function pick(q: Quick) {
    let t = q.text;
    for (const [k, v] of Object.entries(quick?.vars ?? {})) t = t.split(k).join(v);
    const n = firstName(name);
    t = n ? t.split("{שם}").join(n) : t.replace(/ ?\{שם\}/g, "");
    setText(prev => (prev.trim() ? `${prev.trimEnd()}\n${t}` : t));
    setQuickOpen(false);
    // The text is his to edit now: focus with the cursor at the end.
    requestAnimationFrame(() => { const el = box.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }
  async function saveQuick() {
    if (!editing) return;
    setBusy(true);
    const r = await crmAction({ action: "quickReplies.save", items: editing });
    setBusy(false);
    if (r.ok) { setQuick(q => ({ items: (r.items as Quick[]) ?? editing, vars: q?.vars ?? {} })); setEditing(null); }
    else setNote(r.error ?? "לא נשמר");
  }
  async function send() {
    if (!text.trim()) return;
    setBusy(true); setNote(null);
    const ok = await onSend(text);
    setBusy(false);
    if (ok) setText(""); else setNote("ההודעה לא נשלחה");
  }
  async function sendVoice(blob: Blob, secs: number) {
    if (!voice) return false;
    setBusy(true); setNote(null);
    const fd = new FormData();
    fd.set("file", blob, "voice.ogg"); fd.set("to", voice.to); fd.set("id", voice.id); fd.set("secs", String(secs));
    const r = await fetch("/api/admin/crm/voice", { method: "POST", body: fd }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) { setNote(j.error ?? "ההקלטה לא נשלחה"); return false; }
    onSent?.();
    return true;
  }

  const round = "shrink-0 w-11 h-11 rounded-full inline-flex items-center justify-center disabled:opacity-40";
  return (
    <div className="flex flex-col gap-2">
      {quickOpen && (
        <div className="bg-white rounded-2xl p-2 flex flex-col gap-1 max-h-[340px] overflow-y-auto" style={{ border: `1px solid ${C.line}`, boxShadow: "0 8px 24px rgba(11,31,33,0.10)" }}>
          <div className="flex items-center justify-between px-2 pt-1">
            <b className="text-[13px]" style={{ color: C.ink }}>{editing ? "עריכת ההודעות המהירות" : "הודעות מהירות"}</b>
            {!editing && quick && <button type="button" className="text-[13px] font-semibold min-h-[36px] px-2" style={{ color: C.petrol }} onClick={() => setEditing(quick.items.map(q => ({ ...q })))}>עריכה</button>}
          </div>
          {!quick && <p className="m-0 px-2 py-3 text-sm" style={{ color: C.muted }}>טוען…</p>}
          {quick && !editing && (
            <>
              {quick.items.length === 0 && <p className="m-0 px-2 py-3 text-sm" style={{ color: C.muted }}>אין עדיין הודעות מהירות. לחץ עריכה כדי להוסיף.</p>}
              {quick.items.map(q => (
                <button key={q.id} type="button" onClick={() => pick(q)} className="text-right rounded-xl px-3 py-2.5 flex flex-col gap-0.5 hover:bg-[#EEF3F2]">
                  <span className="text-[14px] font-semibold" style={{ color: C.ink }}>{q.title}</span>
                  <span className="text-[12px] truncate w-full" style={{ color: C.muted }}>{q.text.split("\n")[0]}</span>
                </button>
              ))}
              <p className="m-0 px-3 pb-1 text-[11px]" style={{ color: C.muted }}>ההודעה נכנסת לתיבה ולא נשלחת. אפשר לערוך ואז לשלוח.</p>
            </>
          )}
          {editing && (
            <div className="flex flex-col gap-2 px-1 pb-1">
              {editing.map((q, i) => (
                <div key={q.id} className="rounded-xl p-2 flex flex-col gap-1.5" style={{ background: C.soft }}>
                  <div className="flex gap-1.5">
                    <input value={q.title} onChange={e => setEditing(ed => ed!.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} placeholder="שם קצר" aria-label="שם ההודעה" className="flex-1 min-w-0 h-10 rounded-lg px-2.5 text-sm bg-white" style={{ border: `1px solid ${C.line}` }} />
                    <button type="button" onClick={() => setEditing(ed => ed!.filter((_, k) => k !== i))} aria-label={`מחק את ${q.title || "ההודעה"}`} className="shrink-0 h-10 px-3 rounded-lg text-sm" style={{ color: "#B42318", border: "1px solid #F3B8B2", background: "#fff" }}>מחק</button>
                  </div>
                  <textarea value={q.text} onChange={e => setEditing(ed => ed!.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} rows={3} aria-label="נוסח ההודעה" className="rounded-lg px-2.5 py-2 text-sm bg-white resize-y" style={{ border: `1px solid ${C.line}` }} />
                </div>
              ))}
              <button type="button" onClick={() => setEditing(ed => [...ed!, { id: `q${Date.now()}`, title: "", text: "" }])} className="min-h-[40px] rounded-xl text-sm font-semibold" style={{ border: `1px dashed ${C.petrol}`, color: C.petrol }}>+ הודעה חדשה</button>
              <p className="m-0 text-[11px] leading-relaxed" style={{ color: C.muted }}>אפשר לכתוב בנוסח: {"{שם}"} לשם של הליד, {"{קישור הרשמה}"}, {"{דף צ'אטור}"}, ו{"{מסלולים}"} למחירים של היום.</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => void saveQuick()} className="flex-1 min-h-[44px] rounded-xl text-sm font-bold disabled:opacity-50" style={{ background: C.petrol, color: "#fff" }}>{busy ? "שומר…" : "שמור"}</button>
                <button type="button" onClick={() => setEditing(null)} className="min-h-[44px] px-4 rounded-xl text-sm" style={{ border: `1px solid ${C.line}`, color: C.ink, background: "#fff" }}>ביטול</button>
              </div>
            </div>
          )}
        </div>
      )}
      {note && <p className="m-0 text-xs" style={{ color: "#B42318" }}>{note}</p>}
      <div className="flex gap-2 items-end">
        {!recording && (
          <>
            <button type="button" onClick={() => void openQuick()} aria-label="הודעות מהירות" aria-expanded={quickOpen} title="הודעות מהירות" className={round} style={quickOpen ? { background: C.petrol, color: "#fff" } : { background: C.mist, color: C.petrol }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></svg>
            </button>
            <textarea ref={box} value={text} onChange={e => setText(e.target.value)} rows={1} placeholder={placeholder} aria-label="הודעה"
              className="flex-1 min-w-0 rounded-2xl px-3 py-2.5 text-[15px] resize-none bg-white" style={{ border: "1px solid #C7D8D5" }} />
          </>
        )}
        {text.trim() || !voice ? (
          <button type="button" disabled={busy || !text.trim()} onClick={() => void send()} aria-label="שלח" className={round} style={{ background: C.petrol, color: "#fff" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: "scaleX(-1)" }}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </button>
        ) : (
          <VoiceComposer onSend={sendVoice} onOpenChange={setRecording} busy={busy} accent={C.petrol} />
        )}
      </div>
    </div>
  );
}

/** A message's text, with its voice note or picture when it has one. */
export function MsgBody({ content, mediaUrl, mediaType, mine }: { content: string; mediaUrl?: string | null; mediaType?: string | null; mine?: boolean }) {
  // Media rows keep a placeholder text ("🎤 הודעה קולית", "[הודעה קולית]"); the player replaces it.
  const label = !!mediaUrl && (/^\[.*\]$/.test(content.trim()) || content.startsWith("🎤"));
  return (
    <>
      {mediaUrl && mediaType === "audio" && (mine ? <VoiceBubble src={mediaUrl} mine className="w-[230px] max-w-full" /> : <div className="rounded-xl bg-white px-1"><VoiceBubble src={mediaUrl} className="w-[230px] max-w-full" /></div>)}
      {mediaUrl && (mediaType === "image" || mediaType === "sticker") && <a href={mediaUrl} target="_blank" rel="noreferrer"><img src={mediaUrl} alt="תמונה מהשיחה" className="rounded-lg max-w-full max-h-64 object-cover" /></a>}
      {mediaUrl && mediaType && !["audio", "image", "sticker"].includes(mediaType) && <a href={mediaUrl} target="_blank" rel="noreferrer" className="text-sm underline">פתח קובץ</a>}
      {!label && content && <span className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{content}</span>}
    </>
  );
}
