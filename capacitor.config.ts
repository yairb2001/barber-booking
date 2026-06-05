import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cutor.app",
  appName: "Cutor",
  // We don't bundle the Next.js app — the WebView loads the live Vercel URL.
  // `webDir` still needs to exist so Capacitor can sync; we create a minimal
  // placeholder in `public/native-shell/`.
  webDir: "public/native-shell",
  server: {
    // Load the live admin app directly. Auth cookies, API routes, and SSR
    // all keep working from Vercel.
    url: "https://barber-booking-indol.vercel.app/admin",
    cleartext: false,
    // iOS will only allow this domain (and subdomains) — anything else
    // opens externally in Safari.
    allowNavigation: [
      "barber-booking-indol.vercel.app",
      "*.vercel.app",
    ],
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#0d9488",
    // Hide the WKWebView scroll bounce so it feels more native
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#0d9488",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      iosSpinnerStyle: "small",
      spinnerColor: "#ffffff",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0d9488",
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
