"use client";

import { useEffect, useState } from "react";
import { getPlatform, registerPush, setStatusBar, handlePushTaps, hideKeyboardAccessoryBar, type NativePlatform } from "./bridge";

/**
 * Hook that initialises the native shell on mount.
 *
 * - Sets the status bar to match the brand teal
 * - Registers the device for push notifications and POSTs the token to the
 *   server so reminders / urgent messages can hit the admin's lock screen
 *
 * Use inside the admin root layout. Returns the runtime platform so UI can
 * show / hide native-only chrome.
 */
export function useNativeShell(): { platform: NativePlatform | null } {
  const [platform, setPlatform] = useState<NativePlatform | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = await getPlatform();
      if (cancelled) return;
      setPlatform(p);
      if (p === "ios" || p === "android") {
        // Status bar — keep the teal background consistent with the app
        setStatusBar("light", "#0d9488").catch(() => {});

        // Remove the grey keyboard accessory bar (prev/next/done) above the keyboard
        hideKeyboardAccessoryBar().catch(() => {});

        // Deep-link when the user taps a delivered notification
        handlePushTaps().catch(() => {});

        // Register push and send token to server
        const token = await registerPush();
        if (token) {
          fetch("/api/admin/native/device", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, platform: p }),
          }).catch(() => {});
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { platform };
}
