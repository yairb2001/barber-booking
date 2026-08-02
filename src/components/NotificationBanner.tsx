"use client";

import { useEffect, useState } from "react";
import EnableNotifications from "./EnableNotifications";

function standalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

const DISMISS_KEY = "notif_prompt_dismissed";

// One-time gentle nudge to enable notifications — shown only INSIDE the installed
// home-screen app (where iOS actually allows the permission prompt), when it
// hasn't been granted/denied yet and the user hasn't dismissed it.
export default function NotificationBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) return;
    if (!standalone()) return;
    if (Notification.permission !== "default") return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div className="shrink-0 bg-teal-50 border-b border-teal-200 px-4 py-2.5 flex items-center justify-between gap-3">
      <div className="text-sm text-teal-800 font-medium">🔔 להפעיל התראות על תורים ופניות חדשות?</div>
      <div className="flex items-center gap-2 shrink-0">
        <EnableNotifications compact onDone={() => setShow(false)} />
        <button
          onClick={() => { try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ } setShow(false); }}
          className="text-teal-400 hover:text-teal-700 text-lg leading-none px-1"
          aria-label="סגור">✕</button>
      </div>
    </div>
  );
}
