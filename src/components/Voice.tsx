"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Voice notes, WhatsApp-style: a bubble that plays a recording (real waveform,
 * 1×/1.5×/2×) and a composer that records OGG/Opus (mic → timer → preview →
 * send). Moved out of the shop chat (admin/chats) on 15.10.2026 so the
 * requests chat (admin/requests) records the same way.
 */
const fmtSec = (x: number) => (Number.isFinite(x) ? `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}` : "0:00");
const BAR_COUNT = 44;
const waveCache = new Map<string, number[]>();
/** Real waveform (44 RMS bars) decoded from the file; a deterministic stand-in when the file can't be decoded (CORS / codec). */
async function loadWave(src: string): Promise<number[]> {
  const cached = waveCache.get(src); if (cached) return cached;
  let bars: number[] | null = null;
  try {
    const buf = await (await fetch(src, { mode: "cors" })).arrayBuffer();
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const ctx = new Ctx();
    const audio = await ctx.decodeAudioData(buf.slice(0));
    const data = audio.getChannelData(0); const step = Math.max(1, Math.floor(data.length / BAR_COUNT));
    const rms: number[] = [];
    for (let i = 0; i < BAR_COUNT; i++) { let sum = 0; const from = i * step, to = Math.min(data.length, from + step); for (let j = from; j < to; j += 4) sum += data[j] * data[j]; rms.push(Math.sqrt(sum / Math.max(1, (to - from) / 4))); }
    const max = Math.max(...rms, 0.0001);
    bars = rms.map(v => Math.max(0.12, Math.min(1, Math.pow(v / max, 0.7))));
    ctx.close().catch(() => {});
  } catch { /* fall through */ }
  if (!bars) { let h = 0; for (const ch of src) h = (h * 31 + ch.charCodeAt(0)) >>> 0; bars = Array.from({ length: BAR_COUNT }, (_, i) => { h = (h * 1103515245 + 12345) >>> 0; return 0.18 + ((h >>> 8) % 1000) / 1000 * 0.75 * (0.6 + 0.4 * Math.sin(i / 3)); }); }
  waveCache.set(src, bars); return bars;
}
const PlayIcon = ({ className }: { className?: string }) => (<svg viewBox="0 0 24 24" className={className} fill="currentColor"><path d="M8 5v14l11-7z" /></svg>);
const PauseIcon = ({ className }: { className?: string }) => (<svg viewBox="0 0 24 24" className={className} fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z" /></svg>);
const MicIcon = ({ className }: { className?: string }) => (<svg viewBox="0 0 24 24" className={className} fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" /></svg>);
const SendIcon = ({ className }: { className?: string }) => (<svg viewBox="0 0 24 24" className={className} fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>);
const TrashIcon = ({ className }: { className?: string }) => (<svg viewBox="0 0 24 24" className={className} fill="currentColor"><path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z" /></svg>);
const RATES = [1, 1.5, 2] as const;

/** Incoming = white bubble, teal played part; mine = green bubble, dark played part. Tap the pill to cycle 1× → 1.5× → 2×. */
export function VoiceBubble({ src, mine, className = "w-[250px] sm:w-[270px]" }: { src: string; mine?: boolean; className?: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState<number>(1);
  const [bars, setBars] = useState<number[] | null>(null);
  useEffect(() => { let alive = true; loadWave(src).then(b => { if (alive) setBars(b); }); return () => { alive = false; }; }, [src]);
  const toggle = () => { const a = ref.current; if (!a) return; if (a.paused) { a.playbackRate = rate; a.play().catch(() => {}); setStarted(true); } else a.pause(); };
  const cycleRate = () => { const a = ref.current; const next = RATES[(RATES.indexOf(rate as 1 | 1.5 | 2) + 1) % RATES.length]; setRate(next); if (a) a.playbackRate = next; };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => { const a = ref.current; if (!a || !dur) return; const r = e.currentTarget.getBoundingClientRect(); const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); a.currentTime = p * dur; setT(a.currentTime); };
  const progress = dur ? Math.min(1, t / dur) : 0;
  const played = mine ? "bg-emerald-900/70" : "bg-teal-500";
  const unplayed = mine ? "bg-emerald-900/25" : "bg-slate-300";
  const wave = bars ?? Array.from({ length: BAR_COUNT }, () => 0.25);
  return (
    <div className={`flex items-center gap-2 py-0.5 ${className}`} dir="ltr">
      <audio ref={ref} src={src} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setT(0); }}
        onTimeUpdate={e => setT(e.currentTarget.currentTime)}
        onLoadedMetadata={e => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDur(d); }}
        onDurationChange={e => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDur(d); }} />
      <button onClick={toggle} aria-label={playing ? "השהה" : "נגן"} className={`w-8 h-8 shrink-0 flex items-center justify-center ${mine ? "text-emerald-900/80" : "text-slate-500"}`}>
        {playing ? <PauseIcon className="w-7 h-7" /> : <PlayIcon className="w-8 h-8" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="relative h-7 flex items-center gap-[2px] cursor-pointer select-none" onClick={seek}>
          {wave.map((h, i) => (
            <span key={i} className={`flex-1 rounded-full ${i / BAR_COUNT <= progress && (started || t > 0) ? played : unplayed}`} style={{ height: `${Math.round(h * 100)}%`, minWidth: 2 }} />
          ))}
          {(started || t > 0) && <span className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow ${mine ? "bg-emerald-900/80" : "bg-teal-500"}`} style={{ left: `calc(${progress * 100}% - 6px)` }} />}
        </div>
        <div className={`text-[11px] tabular-nums mt-0.5 ${mine ? "text-emerald-900/60" : "text-slate-500"}`}>{fmtSec(playing || t > 0 ? t : dur)}</div>
      </div>
      {started ? (
        <button onClick={cycleRate} className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold tabular-nums ${mine ? "bg-emerald-900/15 text-emerald-950" : "bg-slate-200 text-slate-700"}`} aria-label="מהירות ניגון">
          {rate === 1 ? "1×" : rate === 1.5 ? "1.5×" : "2×"}
        </button>
      ) : (
        <div className="relative shrink-0 w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-400">
          <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z" /></svg>
          <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center ${mine ? "bg-emerald-600" : "bg-teal-500"} text-white`}><MicIcon className="w-3 h-3" /></span>
        </div>
      )}
    </div>
  );
}

/** Mic button → recording (timer) → preview (play, delete, send). Records OGG/Opus so WhatsApp shows it as a voice note. */
export function VoiceComposer({ onSend, onOpenChange, busy, accent }: { onSend: (blob: Blob, durationSec: number) => Promise<boolean>; onOpenChange: (open: boolean) => void; busy: boolean; accent?: string }) {
  // The CRM paints the round buttons in its own color (20.10.2026); the shop's chat keeps teal.
  const tint = accent ? { background: accent } : undefined;
  const [state, setState] = useState<"idle" | "starting" | "recording" | "preview">("idle");
  const [secs, setSecs] = useState(0);
  const [preview, setPreview] = useState<{ blob: Blob; url: string; secs: number } | null>(null);
  const [err, setErr] = useState("");
  const recRef = useRef<{ stop: () => Promise<void>; close: () => void } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  useEffect(() => { onOpenChange(state !== "idle"); }, [state, onOpenChange]);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); recRef.current?.close(); }, []);

  async function start() {
    setErr(""); setState("starting"); cancelledRef.current = false;
    try {
      const mod = await import("opus-recorder");
      const Recorder = mod.default;
      const rec = new Recorder({ encoderPath: "/opus/encoderWorker.min.js", mimeType: "audio/ogg", numberOfChannels: 1, encoderSampleRate: 48000, encoderApplication: 2048, encoderBitRate: 32000, streamPages: false });
      const startedAt = Date.now();
      rec.ondataavailable = (data: Uint8Array) => {
        if (cancelledRef.current) return;
        const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: "audio/ogg" });
        const s = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        setPreview({ blob, url: URL.createObjectURL(blob), secs: s }); setState("preview");
      };
      recRef.current = rec;
      await rec.start();
      setSecs(0); setState("recording");
      timerRef.current = setInterval(() => setSecs(x => x + 1), 1000);
    } catch (e) {
      setState("idle");
      setErr(/NotAllowed|Permission|denied/i.test(String(e)) ? "אין הרשאה למיקרופון — אפשר אותו בדפדפן" : "ההקלטה לא נתמכת בדפדפן הזה");
    }
  }
  async function stop() { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; try { await recRef.current?.stop(); } catch { /* ignore */ } }
  async function cancel() { cancelledRef.current = true; await stop(); recRef.current?.close(); recRef.current = null; if (preview) URL.revokeObjectURL(preview.url); setPreview(null); setState("idle"); }
  async function send() { if (!preview) return; const ok = await onSend(preview.blob, preview.secs); if (ok) { URL.revokeObjectURL(preview.url); setPreview(null); setState("idle"); } }

  if (state === "idle" || state === "starting") return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      {err && <span className="text-[10px] text-red-500 max-w-[160px] text-right">{err}</span>}
      <button type="button" onClick={start} disabled={state === "starting"} aria-label="הקלט הודעה קולית" style={tint} className="w-10 h-10 rounded-full bg-teal-600 hover:bg-teal-700 text-white flex items-center justify-center shadow disabled:opacity-50">
        <MicIcon className="w-5 h-5" />
      </button>
    </div>
  );
  if (state === "recording") return (
    <div className="flex-1 flex items-center gap-3 border border-slate-200 rounded-xl px-3 py-2 bg-white" dir="ltr">
      <button onClick={cancel} aria-label="בטל" className="text-slate-400 hover:text-red-500"><TrashIcon className="w-5 h-5" /></button>
      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
      <span className="text-sm tabular-nums text-slate-700">{fmtSec(secs)}</span>
      <span className="flex-1 text-xs text-slate-400 text-right" dir="rtl">מקליט… לחץ ■ לסיום</span>
      <button onClick={stop} aria-label="סיים הקלטה" className="w-9 h-9 rounded-full bg-red-500 text-white flex items-center justify-center"><span className="w-3.5 h-3.5 bg-white rounded-sm" /></button>
    </div>
  );
  return (
    <div className="flex-1 flex items-center gap-2 border border-slate-200 rounded-xl px-2 py-1.5 bg-white" dir="ltr">
      <button onClick={cancel} aria-label="מחק" className="text-slate-400 hover:text-red-500 shrink-0"><TrashIcon className="w-5 h-5" /></button>
      {preview && <div className="flex-1 min-w-0"><VoiceBubble src={preview.url} /></div>}
      <button type="button" onClick={send} disabled={busy} aria-label="שלח הקלטה" style={tint} className="w-10 h-10 rounded-full bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white flex items-center justify-center shrink-0"><SendIcon className="w-5 h-5" /></button>
    </div>
  );
}
