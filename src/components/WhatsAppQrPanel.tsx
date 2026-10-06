"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Linking the business's WhatsApp — the owner does it alone, in under a minute.
 *
 * Yair, 6.10.2026: "סריקה קלילה וחיבור מהיר, לא דרך גרין" — the same flow he got
 * in RIL Pro: one button, a window with two tabs (scan a QR / type an 8-character
 * code), the number is opened on our own WhatsApp server automatically and the
 * window closes itself the moment the phone is linked. No request to Chator, no
 * waiting, no tokens.
 *
 * Used by the setup wizard (inline), /admin/settings/whatsapp (card + modal) and
 * the "WhatsApp disconnected" banner in AdminLayoutClient (modal).
 *
 * Server-side protocol (src/app/api/admin/whatsapp/*):
 *   POST connect {action:"start"}  — opens the device on our server (idempotent)
 *   GET  qr[?hold=1]               — state; a QR when unlinked (hold=1: state only)
 *   POST pairing-code {phone?}     — 8-character code for "link with phone number"
 *
 * On our server, asking for a QR *starts a new linking session* and drops the
 * previous one — so a scan (or a pairing code) dies if we ask again mid-way. The
 * hook therefore holds the QR it has for ~35s and only checks the state between
 * (every 4s), never asks for a QR while a pairing code is waiting to be typed,
 * and pauses after 8 minutes without a scan. Shared at module level so two
 * mounted panels (banner + settings) don't fight each other.
 */
export type QrState = {
  state?: string; connected?: boolean; qr?: string; type?: string; error?: string;
  paused?: boolean; provider?: "ours" | "green"; phone?: string | null; downSince?: string | null;
};

const QR_HOLD_MS = 35_000;
const QR_IDLE_MS = 8 * 60_000;
const STUCK_AFTER_MS = 4 * 60_000;   // still unlinked after this → tell Chator once (he can call before the owner gives up)
const PAIR_LOCK_S = 60;              // a second code kills the first — the button waits this long
const RESUME_EVENT = "wa-qr-resume";
const shared: { qr?: string; type?: string; at: number; pairingUntil: number } = { at: 0, pairingUntil: 0 };

export function useWhatsAppQr(active: boolean) {
  const [data, setData] = useState<QrState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let since = Date.now();
    let stuckReported = false;
    const resume = () => { since = Date.now(); shared.at = 0; clearTimeout(timer); tick(); };
    window.addEventListener(RESUME_EVENT, resume);
    async function tick() {
      if (cancelled) return;
      setLoading(true);
      try {
        const now = Date.now();
        const idle = now - since > QR_IDLE_MS && now >= shared.pairingUntil;
        const hold = idle || now < shared.pairingUntil || (!!shared.qr && now - shared.at < QR_HOLD_MS);
        const stuck = !stuckReported && now - since > STUCK_AFTER_MS;
        if (stuck) stuckReported = true;
        const qs = [hold ? "hold=1" : "", stuck ? "stuck=1" : ""].filter(Boolean).join("&");
        const res = await fetch(`/api/admin/whatsapp/qr${qs ? "?" + qs : ""}`, { cache: "no-store" });
        const d: QrState & { keep?: boolean; pollMs?: number } = await res.json();
        if (cancelled) return;
        const meta = { provider: d.provider, phone: d.phone, state: d.state, downSince: d.downSince };
        if (d.keep && idle) setData({ ...meta, connected: false, paused: true });
        else if (d.keep) setData({ ...meta, connected: false, qr: shared.qr, type: shared.type });
        else {
          if (d.qr) { shared.qr = d.qr; shared.type = d.type; shared.at = Date.now(); }
          setData(d);
        }
        setLoading(false);
        if (d.connected) { shared.qr = undefined; shared.at = 0; shared.pairingUntil = 0; }
        else timer = setTimeout(tick, idle ? 15000 : d.pollMs ?? 15000);
      } catch {
        if (cancelled) return;
        setData(shared.qr ? { qr: shared.qr, type: shared.type } : { error: "network" });
        setLoading(false);
        timer = setTimeout(tick, 15000);
      }
    }
    tick();
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener(RESUME_EVENT, resume); };
  }, [active]);

  const resume = useCallback(() => window.dispatchEvent(new Event(RESUME_EVENT)), []);
  return { data, loading, resume };
}

/** Opens the business's number on our server (idempotent). Returns the error text when it can't. */
export async function startOurServerConnection(): Promise<{ ok: boolean; error?: string; connected?: boolean }> {
  try {
    const r = await fetch("/api/admin/whatsapp/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.ok ? { ok: true, connected: !!j.connected } : { ok: false, error: j.error || "לא הצלחנו לפתוח את החיבור, נסה שוב בעוד רגע" };
  } catch { return { ok: false, error: "שגיאת רשת" }; }
}

const STEPS_QR = ["פותחים וואטסאפ בטלפון של העסק", "הגדרות ← מכשירים מקושרים ← קישור מכשיר", "מכוונים את המצלמה לקוד שכאן"];
const STEPS_CODE = ["פותחים וואטסאפ בטלפון של העסק", "הגדרות ← מכשירים מקושרים ← קישור מכשיר", "למטה: \"קישור באמצעות מספר טלפון\" ומקלידים את הקוד"];

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
          <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold inline-flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The linking box: QR or 8-character code. `onLinked` fires once, ~1s after the
 * phone links (a moment of "מחובר!" first). Kept in a ref so a new callback on
 * every render can't restart anything.
 */
export function ConnectBox({ onLinked }: { onLinked?: () => void }) {
  const { data, loading, resume } = useWhatsAppQr(true);
  const [mode, setMode] = useState<"qr" | "code">("qr");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [codeAt, setCodeAt] = useState(0);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const linkedRef = useRef(onLinked);
  useEffect(() => { linkedRef.current = onLinked; }, [onLinked]);
  useEffect(() => { if (data?.phone && !phone) setPhone(data.phone); }, [data?.phone, phone]);

  useEffect(() => {
    if (!data?.connected || doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    const t = setTimeout(() => linkedRef.current?.(), 1200);
    return () => clearTimeout(t);
  }, [data?.connected]);

  // countdown for the pairing-code lock
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [code]);
  const codeLock = code ? Math.max(0, PAIR_LOCK_S - Math.floor(((now || codeAt) - codeAt) / 1000)) : 0;

  async function getCode() {
    if (codeBusy || codeLock > 0) return;
    setCodeBusy(true); setCodeErr(null);
    try {
      const r = await fetch("/api/admin/whatsapp/pairing-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phone.trim() || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.code) setCodeErr(j.error || "לא התקבל קוד, נסה שוב בעוד רגע");
      else { const t = Date.now(); setCode(j.code); setCodeAt(t); setNow(t); shared.pairingUntil = t + 170_000; }
    } catch { setCodeErr("שגיאת רשת"); }
    setCodeBusy(false);
  }

  const ours = data?.provider !== "green";

  if (done) {
    return (
      <div className="py-10 text-center space-y-2">
        <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 text-emerald-600 inline-flex items-center justify-center text-3xl">✓</div>
        <p className="text-lg font-bold text-slate-900">מחובר!</p>
        <p className="text-sm text-slate-500">הסוכן, התזכורות והאישורים יוצאים מעכשיו מהמספר של העסק.</p>
      </div>
    );
  }

  if (data?.error && !data.qr) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-4 text-sm text-red-700 text-center">
        לא הצלחנו להביא קוד ({data.error === "network" ? "שגיאת רשת" : data.error}). נסה שוב בעוד רגע.
      </div>
    );
  }

  if (data?.paused) {
    return (
      <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-6 text-center space-y-3">
        <p className="text-sm text-slate-600">עברו 8 דקות בלי חיבור, אז עצרנו.</p>
        <button type="button" onClick={() => { shared.pairingUntil = 0; setMode("qr"); resume(); }} className="rounded-xl bg-emerald-600 text-white text-sm font-semibold px-5 h-10">נסה שוב</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ours && (
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl text-sm">
          <button type="button" onClick={() => { shared.pairingUntil = 0; setMode("qr"); }} className={`h-9 rounded-lg font-medium ${mode === "qr" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>סריקת קוד</button>
          <button type="button" onClick={() => setMode("code")} className={`h-9 rounded-lg font-medium ${mode === "code" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>קוד במספרים</button>
        </div>
      )}

      {mode === "qr" ? (
        <>
          <div className="aspect-square w-full max-w-[280px] mx-auto bg-slate-50 rounded-2xl flex items-center justify-center overflow-hidden border border-slate-100">
            {data?.qr
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={data.qr} alt="קוד לחיבור וואטסאפ" className="w-full h-full object-contain" />
              : <p className="text-sm text-slate-400 animate-pulse">{loading || !data ? "מכין קוד…" : "ממתין לקוד…"}</p>}
          </div>
          <Steps items={STEPS_QR} />
          {ours && <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">פתחת את המערכת על אותו טלפון? אי אפשר לסרוק את המסך של עצמו. עבור ל&quot;קוד במספרים&quot;.</p>}
        </>
      ) : (
        <>
          <div className="space-y-2">
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="מספר הוואטסאפ של העסק (05…)" dir="ltr" inputMode="tel"
              className="w-full border border-slate-200 rounded-xl px-3 h-11 text-sm text-center" />
            <button type="button" onClick={getCode} disabled={!phone.trim() || codeBusy || codeLock > 0}
              className="w-full bg-emerald-600 text-white rounded-xl h-11 text-sm font-semibold disabled:opacity-40">
              {codeBusy ? "מבקש קוד…" : codeLock > 0 ? `קוד חדש אפשר בעוד ${codeLock} שניות` : code ? "קבל קוד חדש" : "קבל קוד"}
            </button>
          </div>
          {code && (
            <div className="bg-emerald-50 rounded-2xl py-4 text-center">
              <p className="text-[11px] text-emerald-700 mb-1">הקלד בטלפון את הקוד:</p>
              <p className="text-3xl font-mono font-bold tracking-[0.25em] text-slate-900" dir="ltr">{code.slice(0, 4)}-{code.slice(4)}</p>
              <p className="text-[11px] text-emerald-700 mt-1">הקוד תקף כשתי דקות</p>
            </div>
          )}
          {codeErr && <p className="text-xs text-red-600">{codeErr}</p>}
          <Steps items={STEPS_CODE} />
        </>
      )}
      <p className="text-[11px] text-slate-400 text-center">המסך יתעדכן לבד ברגע שהחיבור יצליח</p>
    </div>
  );
}

export function ConnectModal({ title = "חיבור הטלפון", onClose, children }: { title?: string; onClose: () => void; children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center sm:p-3" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[92vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-base font-bold text-slate-900">{title}</p>
          <button type="button" onClick={onClose} aria-label="סגור" className="w-9 h-9 rounded-full hover:bg-slate-100 inline-flex items-center justify-center text-slate-500">✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function StatusDot({ tone }: { tone: "ok" | "warn" | "bad" | "idle" }) {
  const cls = { ok: "bg-emerald-500", warn: "bg-amber-400", bad: "bg-red-500", idle: "bg-slate-300" }[tone];
  return (
    <span className="relative inline-flex w-2.5 h-2.5 shrink-0">
      {tone === "ok" && <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-60 animate-ping" />}
      <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${cls}`} />
    </span>
  );
}

/**
 * The settings card: what the state is in words, and the next action as one
 * button. `provisioned` = the business already has a device on our server (or a
 * Green instance); otherwise the button first opens one, then shows the box.
 */
export function WhatsAppConnectCard({ provisioned, onChanged }: { provisioned: boolean; onChanged?: () => void }) {
  const [status, setStatus] = useState<{ state: "loading" | "authorized" | "notAuthorized" | "error"; error?: string; downSince?: string | null }>({ state: "loading" });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [hasDevice, setHasDevice] = useState(provisioned);
  useEffect(() => { setHasDevice(provisioned); }, [provisioned]);

  const check = useCallback(async () => {
    if (!hasDevice) { setStatus({ state: "notAuthorized" }); return; }
    try {
      const r = await fetch("/api/admin/whatsapp/qr?hold=1", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setStatus({ state: "error", error: j.error });
      else setStatus({ state: j.connected ? "authorized" : "notAuthorized", downSince: j.downSince ?? null });
    } catch { setStatus({ state: "error", error: "network" }); }
  }, [hasDevice]);
  useEffect(() => { void check(); }, [check]);

  async function connect() {
    setBusy(true); setNote(null); setMenu(false);
    if (!hasDevice) {
      const r = await startOurServerConnection();
      if (!r.ok) { setBusy(false); setNote(r.error || "לא הצלחנו לפתוח את החיבור"); return; }
      setHasDevice(true);
    }
    setBusy(false);
    setOpen(true);
  }

  async function act(action: "logout" | "reconnect", confirmText: string) {
    if (!confirm(confirmText)) return;
    setBusy(true); setNote(null); setMenu(false);
    try {
      const r = await fetch("/api/admin/whatsapp/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) setNote(j.error || "הפעולה נכשלה");
    } catch { setNote("שגיאת רשת"); }
    setBusy(false);
    void check();
    onChanged?.();
  }

  const linked = status.state === "authorized";
  const view = status.state === "loading" ? { tone: "idle" as const, title: "בודק חיבור…", sub: "" }
    : status.state === "error" ? { tone: "bad" as const, title: "אין תשובה מהשרת", sub: "נסה \"רענן ובדוק\" בתפריט שבצד" }
    : !hasDevice ? { tone: "bad" as const, title: "לא מחובר", sub: "סריקה אחת מהטלפון של העסק, לוקח פחות מדקה" }
    : !linked ? { tone: "bad" as const, title: "לא מחובר", sub: "צריך לחבר את הטלפון, לוקח פחות מדקה" }
    : { tone: "ok" as const, title: "מחובר ופעיל", sub: "הסוכן, התזכורות והאישורים יוצאים מהמספר של העסק" };

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-3">
      <div className="flex items-start gap-2.5">
        <span className="text-2xl leading-none">📲</span>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-neutral-800">הוואטסאפ של העסק</h2>
          <div className="flex items-center gap-2 mt-1">
            <StatusDot tone={view.tone} />
            <p className="text-sm font-semibold text-slate-900">{view.title}</p>
          </div>
          {view.sub && <p className="text-xs text-slate-500 mt-0.5">{view.sub}</p>}
        </div>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setMenu(m => !m)} aria-label="עוד פעולות" className="w-9 h-9 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center justify-center text-slate-600">⋯</button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="absolute left-0 top-10 z-20 w-44 bg-white rounded-xl shadow-lg border border-slate-100 py-1 text-sm">
                <button type="button" onClick={() => { setMenu(false); setStatus({ state: "loading" }); void check(); }} className="w-full text-right px-3 py-2 hover:bg-slate-50">רענן ובדוק</button>
                <button type="button" onClick={connect} className="w-full text-right px-3 py-2 hover:bg-slate-50">חבר מחדש</button>
                {linked && <button type="button" onClick={() => act("reconnect", "לחדש את החיבור לשרת? לוקח כמה שניות.")} className="w-full text-right px-3 py-2 hover:bg-slate-50">חדש חיבור</button>}
                {linked && <button type="button" onClick={() => act("logout", "לנתק את הטלפון מהמערכת? אחרי זה צריך לסרוק שוב.")} className="w-full text-right px-3 py-2 hover:bg-red-50 text-red-600">נתק טלפון</button>}
              </div>
            </>
          )}
        </div>
      </div>
      {!linked && status.state !== "loading" && (
        <button type="button" onClick={connect} disabled={busy} className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50">
          {busy ? "רגע…" : "חבר את הטלפון"}
        </button>
      )}
      {hasDevice && !linked && status.state === "notAuthorized" && status.downSince && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          מנותק מאז {new Date(status.downSince).toLocaleString("he-IL", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}. הלקוחות לא מקבלים מענה אוטומטי ותזכורות לא יוצאות.
        </p>
      )}
      <p className="text-[11px] text-slate-400">כשהחיבור נופל, תקבל התראה בפוש ובהודעת וואטסאפ מהמספר של Chator, וגם אנחנו נדע.</p>
      {note && <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{note}</p>}
      {open && (
        <ConnectModal onClose={() => { setOpen(false); void check(); }}>
          <ConnectBox onLinked={() => { setOpen(false); void check(); onChanged?.(); }} />
        </ConnectModal>
      )}
    </div>
  );
}
