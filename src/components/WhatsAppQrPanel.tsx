"use client";

import { useEffect, useState } from "react";

// Shared by the inline "reconnect" card in /admin/settings and the global
// disconnect-banner modal in AdminLayoutClient — same GreenAPI polling +
// QR/connected/error rendering, previously implemented twice and drifting.
export type QrState = { state?: string; connected?: boolean; qr?: string; type?: string; error?: string };

// On our own server, asking for a QR *starts a new linking session* and drops the
// previous one — so a scan (or a pairing code) dies if we ask again mid-way. The
// hook therefore holds the QR it has for ~35s and only checks the state meanwhile,
// and never asks for a QR while a pairing code is waiting to be typed. Shared at
// module level so two mounted panels (banner + settings) don't fight each other.
const QR_HOLD_MS = 35_000;
const shared: { qr?: string; type?: string; at: number; pairingUntil: number } = { at: 0, pairingUntil: 0 };

/** Polls /api/admin/whatsapp/qr while `active` until connected (pace set by the server: fast state checks on our server, ~15s on Green). */
export function useWhatsAppQr(active: boolean) {
  const [data, setData] = useState<QrState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (cancelled) return;
      setLoading(true);
      try {
        const now = Date.now();
        const hold = now < shared.pairingUntil || (!!shared.qr && now - shared.at < QR_HOLD_MS);
        const res = await fetch(`/api/admin/whatsapp/qr${hold ? "?hold=1" : ""}`, { cache: "no-store" });
        const d: QrState & { keep?: boolean; pollMs?: number } = await res.json();
        if (cancelled) return;
        if (d.keep) setData({ state: d.state, connected: false, qr: shared.qr, type: shared.type });
        else {
          if (d.qr) { shared.qr = d.qr; shared.type = d.type; shared.at = Date.now(); }
          setData(d);
        }
        setLoading(false);
        if (d.connected) { shared.qr = undefined; shared.at = 0; shared.pairingUntil = 0; }
        else timer = setTimeout(tick, d.pollMs ?? 15000);
      } catch {
        if (cancelled) return;
        setData(shared.qr ? { qr: shared.qr, type: shared.type } : { error: "network" });
        setLoading(false);
        timer = setTimeout(tick, 15000);
      }
    }
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active]);

  return { data, loading };
}

/** "Can't scan?" fallback for businesses on our server: WhatsApp's "link with phone
 *  number" flow. Asks the API for a code bound to the business's number and shows it. */
export function PairingCodeFallback() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function getCode() {
    setBusy(true); setError(null); setCode(null); setOpen(true);
    try {
      const r = await fetch("/api/admin/whatsapp/pairing-code", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.code) setError(j.error || "לא התקבל קוד, נסה שוב בעוד רגע");
      else { setCode(j.code); shared.pairingUntil = Date.now() + 170_000; }
    } catch { setError("שגיאת רשת"); }
    setBusy(false);
  }
  return (
    <div className="mt-4 text-center">
      {!open ? (
        <button type="button" onClick={getCode} className="text-sm font-medium text-teal-700 underline underline-offset-2">לא מצליח לסרוק? קישור באמצעות מספר הטלפון</button>
      ) : (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-4">
          <p className="text-xs text-slate-600 mb-2">בטלפון: מכשירים מקושרים ← קישור מכשיר ← <b>קישור באמצעות מספר הטלפון</b> ← הקלידו את הקוד:</p>
          {busy ? <div className="text-slate-400 text-sm py-2">מכין קוד…</div>
            : code ? <div className="font-mono text-2xl tracking-[0.3em] font-bold text-slate-800 py-2" dir="ltr">{code.slice(0, 4)}-{code.slice(4)}</div>
            : error ? <div className="text-sm text-red-600 py-2">{error}</div> : null}
          <div className="flex items-center justify-center gap-3 mt-1">
            <button type="button" onClick={getCode} disabled={busy} className="text-xs text-teal-700 underline underline-offset-2 disabled:opacity-50">קוד חדש</button>
            <button type="button" onClick={() => { shared.pairingUntil = 0; shared.at = 0; setOpen(false); }} className="text-xs text-slate-400">חזרה ל‑QR</button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">הקוד תקף כמה דקות. הקוד קשור למספר של העסק כפי שהוגדר במערכת.</p>
        </div>
      )}
    </div>
  );
}

/** Connected / QR / error / loading states — the part that was byte-for-byte duplicated. */
export function WhatsAppQrBody({ data, loading, errorHint }: { data: QrState | null; loading: boolean; errorHint: string }) {
  if (data?.connected) {
    return (
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-5 text-center">
        <div className="text-3xl mb-1">✓</div>
        <p className="text-sm font-semibold text-emerald-800">ה-WhatsApp מחובר ופעיל</p>
        <p className="text-[11px] text-emerald-600 mt-1">המספר מקושר — הודעות יישלחו כרגיל.</p>
      </div>
    );
  }
  if (data?.qr) {
    return (
      <div className="text-center">
        <div className="inline-block rounded-xl border border-neutral-200 p-3 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.qr} alt="WhatsApp QR" width={240} height={240} className="block" />
        </div>
        <p className="text-sm font-medium text-neutral-700 mt-3">סרקו את הקוד מ-WhatsApp במכשיר העסק</p>
        <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
          WhatsApp ← הגדרות ← מכשירים מקושרים ← קישור מכשיר.
          <br />הקוד מתחדש אוטומטית — אם פג, ימתין קוד חדש.
        </p>
      </div>
    );
  }
  if (data?.error) {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 text-center">
        לא הצלחנו לטעון את החיבור ({data.error}). {errorHint}
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-6 text-sm text-slate-500 text-center">
      {loading ? "טוען חיבור..." : "ממתין לחיבור..."}
    </div>
  );
}
