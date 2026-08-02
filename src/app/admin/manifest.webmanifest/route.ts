import { NextResponse } from "next/server";

// Admin-only manifest, served at /admin/manifest.webmanifest.
//
// NOTE: this is a plain Route Handler, not Next's `manifest.ts` file
// convention. That convention has a nesting bug (confirmed empirically
// against Next 14.2.35): when a nested segment (e.g. admin/) has its own
// manifest.ts file, Next's static-file resolver stomps the segment's
// EXPLICIT `metadata.manifest` string at merge time, always re-resolving
// back to the root's /manifest.webmanifest — so the <link rel="manifest">
// tag silently pointed at the wrong (customer) manifest even though this
// route itself served correct JSON. A plain route.ts has no such conflict:
// it isn't auto-detected as "static metadata", so the explicit
// metadata.manifest string in admin/layout.tsx wins cleanly.
//
// Kept separate from the customer manifest (src/app/manifest.ts) so "Add to
// Home Screen" from inside the management area installs an app that opens
// straight into /admin, while a customer installing from the storefront is
// unaffected.
export async function GET() {
  return NextResponse.json(
    {
      name: "DOMINANT ניהול",
      short_name: "ניהול",
      description: "ממשק ניהול למספרה",
      lang: "he",
      dir: "rtl",
      start_url: "/admin",
      scope: "/admin",
      display: "standalone",
      orientation: "portrait",
      background_color: "#ffffff",
      theme_color: "#0d9488",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } }
  );
}
