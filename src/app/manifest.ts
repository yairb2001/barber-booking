import type { MetadataRoute } from "next";

// Web App Manifest — served at /manifest.webmanifest. Makes the site
// installable to the home screen and, with display "standalone", it opens
// WITHOUT any browser chrome (looks like a native app). Referenced from the
// root layout's metadata.manifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DOMINANT",
    short_name: "DOMINANT",
    description: "מערכת ניהול וזימון תורים",
    lang: "he",
    dir: "rtl",
    // Open straight into the management area — this app is the owner/barber
    // tool (notifications, calendar). In standalone mode there's no address bar
    // to reach /admin otherwise; unauthenticated hits redirect to /admin/login.
    // Scope stays "/" so in-app navigation to any page stays inside the PWA.
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0d9488",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
