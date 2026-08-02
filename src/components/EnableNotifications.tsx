"use client";

import { useEffect, useState } from "react";

// VAPID public key (base64url) → Uint8Array, as pushManager.subscribe expects.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "loading" | "unsupported" | "needs-install" | "ready" | "enabling" | "enabled" | "denied" | "error";

function standalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** "Enable notifications" control. `compact` renders a slim inline variant for the banner. */
export default function EnableNotifications({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const [state, setState] = useState<State>("loading");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) { setState("unsupported"); return; }
      const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (iOS && !standalone()) { setState("needs-install"); return; }
      if (Notification.permission === "denied") { setState("denied"); return; }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const existing = reg && (await reg.pushManager.getSubscription());
        if (existing && Notification.permission === "granted") { setState("enabled"); return; }
      } catch { /* ignore */ }
      setState("ready");
    })();
  }, []);

  async function enable() {
    setErr(null); setState("enabling");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "ready"); return; }
      const { publicKey } = await fetch("/api/admin/native/web-push").then(r => r.json());
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const res = await fetch("/api/admin/native/web-push", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error("save failed");
      setState("enabled");
      onDone?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "שגיאה");
      setState("error");
    }
  }

  if (state === "loading") return null;

  if (state === "enabled") {
    return <div className={`inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 ${compact ? "" : "py-1"}`}>✓ ההתראות מופעלות</div>;
  }

  if (state === "unsupported") {
    return <p className="text-xs text-neutral-400">הדפדפן הזה לא תומך בהתראות פוש.</p>;
  }

  if (state === "needs-install") {
    return (
      <p className="text-xs text-neutral-500 leading-relaxed">
        כדי לקבל התראות באייפון: לחץ על <b>שיתוף</b> → <b>&quot;הוסף למסך הבית&quot;</b>, פתח את האפליקציה מהמסך, וחזור לכאן ללחוץ &quot;הפעל התראות&quot;.
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="text-xs text-red-500 leading-relaxed">
        ההתראות חסומות. יש להפעיל אותן ידנית בהגדרות המכשיר (הגדרות → התראות → DOMINANT).
      </p>
    );
  }

  // ready / enabling / error
  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={enable}
        disabled={state === "enabling"}
        className={`rounded-xl font-semibold text-white bg-teal-600 hover:bg-teal-700 transition disabled:opacity-50 ${compact ? "px-4 py-1.5 text-sm" : "w-full py-2.5 text-sm"}`}>
        {state === "enabling" ? "מפעיל…" : "🔔 הפעל התראות"}
      </button>
      {state === "error" && <p className="text-xs text-red-500">{err || "שגיאה — נסה שוב"}</p>}
    </div>
  );
}
