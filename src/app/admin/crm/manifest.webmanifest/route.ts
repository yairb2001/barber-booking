import { NextResponse } from "next/server";

// CRM home-screen shortcut: same app and same login as /admin, it just opens
// straight into the CRM. Scope stays /admin so "חזרה למספרה" stays in-app.
// Its own icon (10.10.2026): big "CRM", small "chator", so it is not mixed up
// with the management app on the home screen.
export async function GET() {
  return NextResponse.json(
    {
      name: "Chator CRM",
      short_name: "CRM",
      description: "CRM של צ'אטור",
      lang: "he",
      dir: "rtl",
      id: "/admin/crm",
      start_url: "/admin/crm",
      scope: "/admin",
      display: "standalone",
      orientation: "portrait",
      background_color: "#F4F7F6",
      theme_color: "#0B3A3C",
      icons: [
        { src: "/chator/crm-icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/chator/crm-icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/chator/crm-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } }
  );
}
