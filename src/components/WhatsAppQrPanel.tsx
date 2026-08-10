"use client";

import { useEffect, useState } from "react";

// Shared by the inline "reconnect" card in /admin/settings and the global
// disconnect-banner modal in AdminLayoutClient — same GreenAPI polling +
// QR/connected/error rendering, previously implemented twice and drifting.
export type QrState = { state?: string; connected?: boolean; qr?: string; type?: string; error?: string };

/** Polls /api/admin/whatsapp/qr while `active`, re-polling every ~15s (the QR rotates) until connected. */
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
        const res = await fetch("/api/admin/whatsapp/qr", { cache: "no-store" });
        const d: QrState = await res.json();
        if (cancelled) return;
        setData(d);
        setLoading(false);
        if (!d.connected) timer = setTimeout(tick, 15000); // QR rotates — re-poll
      } catch {
        if (cancelled) return;
        setData({ error: "network" });
        setLoading(false);
        timer = setTimeout(tick, 15000);
      }
    }
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active]);

  return { data, loading };
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
