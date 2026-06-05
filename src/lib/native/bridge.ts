/**
 * Native bridge — utility helpers for interacting with the Capacitor shell.
 *
 * When the admin app runs inside the iOS WebView (Capacitor), these helpers
 * give us access to native features (push, haptics, status bar). When it runs
 * inside a normal browser, they degrade gracefully to no-ops.
 *
 * All Capacitor imports are dynamic so the regular web bundle stays slim.
 */

export type NativePlatform = "ios" | "android" | "web";

let cachedPlatform: NativePlatform | null = null;

/** Returns the runtime platform. */
export async function getPlatform(): Promise<NativePlatform> {
  if (cachedPlatform) return cachedPlatform;
  if (typeof window === "undefined") return "web";
  try {
    const { Capacitor } = await import("@capacitor/core");
    cachedPlatform = (Capacitor.getPlatform() as NativePlatform) || "web";
  } catch {
    cachedPlatform = "web";
  }
  return cachedPlatform;
}

/** True when running inside the Capacitor iOS / Android shell. */
export async function isNative(): Promise<boolean> {
  const p = await getPlatform();
  return p === "ios" || p === "android";
}

/** Trigger a haptic tap (no-op on web). */
export async function hapticImpact(style: "light" | "medium" | "heavy" = "light"): Promise<void> {
  if (!(await isNative())) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    const styleMap = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: styleMap[style] });
  } catch { /* ignore */ }
}

/** Open the iOS share sheet (no-op on web). */
export async function nativeShare(opts: { title?: string; text?: string; url?: string }): Promise<void> {
  if (!(await isNative())) {
    // Web fallback
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try { await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share(opts); } catch { /* ignore */ }
    }
    return;
  }
  try {
    const { Share } = await import("@capacitor/share");
    await Share.share({ title: opts.title, text: opts.text, url: opts.url, dialogTitle: opts.title });
  } catch { /* ignore */ }
}

/**
 * Register for push notifications. Call once after login.
 * Returns the device token, or null if not granted / not native.
 */
export async function registerPush(): Promise<string | null> {
  if (!(await isNative())) return null;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return null;
    await PushNotifications.register();
    return new Promise(resolve => {
      const removeOk = PushNotifications.addListener("registration", token => {
        resolve(token.value);
        removeOk.then(l => l.remove());
      });
      const removeErr = PushNotifications.addListener("registrationError", () => {
        resolve(null);
        removeErr.then(l => l.remove());
      });
      // Safety timeout — never hang the UI
      setTimeout(() => resolve(null), 10000);
    });
  } catch {
    return null;
  }
}

/**
 * Listen for taps on a delivered push notification and deep-link the WebView
 * to the relevant admin screen. Call once on app start (after registerPush).
 *
 * The push payload carries a `data.type` set by the server:
 *   - "chat"        → open the chats inbox
 *   - "appointment" → open the calendar
 */
export async function handlePushTaps(): Promise<void> {
  if (!(await isNative())) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const data = (action.notification?.data ?? {}) as Record<string, string>;
      let target: string | null = null;
      if (data.type === "chat") target = "/admin/chats";
      else if (data.type === "appointment") target = "/admin";
      if (target && typeof window !== "undefined") {
        // Same-origin navigation inside the WebView.
        window.location.assign(target);
      }
    });
  } catch { /* ignore */ }
}

/** Set the status-bar style. Useful when entering dark sections. */
export async function setStatusBar(style: "light" | "dark", backgroundColor?: string): Promise<void> {
  if (!(await isNative())) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: style === "dark" ? Style.Dark : Style.Light });
    if (backgroundColor) await StatusBar.setBackgroundColor({ color: backgroundColor });
  } catch { /* ignore */ }
}

/** Get device info — used to identify the app variant in server logs. */
export async function getDeviceInfo(): Promise<{ platform: NativePlatform; appVersion?: string; model?: string }> {
  const platform = await getPlatform();
  if (platform === "web") return { platform };
  try {
    const { Device } = await import("@capacitor/device");
    const [info, appInfo] = await Promise.all([Device.getInfo(), import("@capacitor/app").then(m => m.App.getInfo()).catch(() => null)]);
    return {
      platform,
      model: info.model,
      appVersion: appInfo?.version,
    };
  } catch {
    return { platform };
  }
}
