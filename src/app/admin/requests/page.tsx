"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { VoiceBubble, VoiceComposer } from "@/components/Voice";
import { screenFor } from "@/lib/admin-screens";

/**
 * Requests and improvements (15.10.2026, Yair: "צאט של בקשות מה חסר לך או מה
 * היית רוצה לשנות, תכתוב או תקליט בפירוט, עוברים על זה כל יום"). One thread
 * per shop with Chator: anyone on the team writes or records, Chator answers here.
 */
type Item = { id: string; fromChator: boolean; author: string | null; body: string | null; audioUrl: string | null; audioSecs: number | null; at: string; done: boolean };
const when = (iso: string) => new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });

// A screen of the system (with or without the site's address) → a button to it;
// any other web address → a link (15.10.2026, Yair: "קישורים לא עובדים... לחצן קיצור דרך").
const SCREEN_RE = /(?:https?:\/\/[^\s/]+)?(\/admin(?:\/[^\s,)"'״]*)?)/g;
const URL_RE = /(https?:\/\/[^\s]+)/g;

function Body({ text, mine }: { text: string; mine: boolean }) {
  const paths: string[] = [];
  const rest = text
    .replace(SCREEN_RE, (_m, path: string) => { const p = path.replace(/[.:]+$/, ""); if (!paths.includes(p)) paths.push(p); return ""; })
    .split("\n").map(l => l.replace(/[ \t]+$/, "").replace(/:\s*$/, ":")).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  return (
    <>
      {rest && (
        <p className="whitespace-pre-line [overflow-wrap:anywhere]">
          {rest.split(URL_RE).map((part, i) => (i % 2 === 1
            ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline">{part}</a>
            : <span key={i}>{part}</span>))}
        </p>
      )}
      {paths.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {paths.map(p => (
            <Link key={p} href={p} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold ${mine ? "bg-white/20 text-white" : "bg-teal-600 text-white"}`}>
              {screenFor(p)?.name ?? "פתח את המסך"} ←
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

export default function RequestsPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement | null>(null);

  // Loading marks Chator's replies read: the menu badge refreshes now ("center:read").
  const load = useCallback(() => fetch("/api/admin/requests", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => { if (j) { setItems(j.items); window.dispatchEvent(new Event("center:read")); } }).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [items?.length]);

  async function sendText() {
    if (!text.trim()) return;
    setBusy(true); setError("");
    const r = await fetch("/api/admin/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) { const j = await r.json(); setText(""); setItems(a => [...(a ?? []), j.item]); }
    else setError((await r?.json().catch(() => ({})))?.error || "לא נשלח, נסה שוב");
  }
  const sendVoice = useCallback(async (blob: Blob, secs: number) => {
    setBusy(true); setError("");
    const fd = new FormData();
    fd.append("file", blob, "request.ogg"); fd.append("secs", String(secs));
    const r = await fetch("/api/admin/requests", { method: "POST", body: fd }).catch(() => null);
    setBusy(false);
    if (r?.ok) { const j = await r.json(); setItems(a => [...(a ?? []), j.item]); return true; }
    setError((await r?.json().catch(() => ({})))?.error || "ההקלטה לא נשלחה, נסה שוב");
    return false;
  }, []);

  return (
    <div className="h-full flex flex-col bg-slate-50" dir="rtl">
      <div className="shrink-0 px-4 pt-5 pb-3 sm:px-8 bg-white border-b border-slate-200">
        <h1 className="text-xl font-bold text-slate-900">💡 בקשות ושיפורים</h1>
        <p className="text-sm text-slate-500 mt-1">מה חסר לך במערכת, או מה היית רוצה לשנות? כתוב או הקלט בפירוט. אנחנו עוברים על הכל כל יום.</p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 sm:px-8">
        <div className="max-w-2xl mx-auto space-y-2">
          {items === null && <p className="text-center text-sm text-slate-400 py-10">טוען…</p>}
          {items?.length === 0 && (
            <div className="text-center text-sm text-slate-500 py-10 leading-relaxed">
              עוד אין בקשות.<br />למשל: &quot;הייתי רוצה שכל ספר יראה רק את היומן שלו&quot; או &quot;חסר לי דוח של לקוחות שלא חזרו&quot;.
            </div>
          )}
          {items?.map(m => (
            <div key={m.id} className={`flex ${m.fromChator ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[14px] shadow-sm ${m.fromChator ? "bg-white border border-slate-200 text-slate-800" : "bg-teal-600 text-white"}`}>
                <div className={`text-[11px] font-semibold mb-0.5 ${m.fromChator ? "text-teal-700" : "text-white/80"}`}>{m.fromChator ? "צ׳אטור" : m.author || "אתה"}</div>
                {m.audioUrl && <div className="min-w-[210px]"><VoiceBubble src={m.audioUrl} mine={!m.fromChator} /></div>}
                {m.body && <Body text={m.body} mine={!m.fromChator} />}
                <div className={`text-[10px] mt-1 ${m.fromChator ? "text-slate-400" : "text-white/70"}`}>{when(m.at)}{!m.fromChator && m.done ? " · ✓ טופל" : ""}</div>
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
      </div>

      <div className="shrink-0 bg-white border-t border-slate-200 px-3 pt-2 pb-[max(10px,env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto">
          {error && <p className="text-xs text-red-600 mb-1.5">{error}</p>}
          <div className="flex items-end gap-2">
            {!voiceOpen && (
              <>
                <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="מה חסר לך, או מה לשנות? כמה שיותר בפירוט" className="flex-1 min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-[15px] resize-none focus:outline-none focus:ring-2 focus:ring-teal-500" />
                {text.trim() && (
                  <button type="button" onClick={() => void sendText()} disabled={busy} className="shrink-0 h-10 px-4 rounded-full bg-teal-600 text-white text-sm font-semibold disabled:opacity-50">{busy ? "…" : "שלח"}</button>
                )}
              </>
            )}
            {!text.trim() && <VoiceComposer onSend={sendVoice} onOpenChange={setVoiceOpen} busy={busy} />}
          </div>
        </div>
      </div>
    </div>
  );
}
