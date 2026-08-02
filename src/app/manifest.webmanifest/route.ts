import { NextResponse } from "next/server";

// Web App Manifest for the CUSTOMER storefront (legacy root — no slug),
// served at /manifest.webmanifest and referenced from the root layout's
// metadata.manifest. Makes the site installable to the home screen and, with
// display "standalone", it opens WITHOUT any browser chrome (looks like a
// native app).
//
// NOTE: this is a plain Route Handler, not Next's `manifest.ts` file
// convention. That convention has a bug (confirmed empirically against
// Next 14.2.35): a manifest.ts file ANYWHERE in the app — even just at the
// root — makes Next globally resolve <link rel="manifest"> to that root
// file's URL on EVERY page, silently overriding any nested layout's
// explicit metadata.manifest string (admin's, a tenant's, etc). A plain
// route.ts isn't auto-detected as "static metadata", so it doesn't hijack
// anything — each layout's explicit metadata.manifest string then wins
// cleanly, which is what actually makes the three-manifest split below work.
//
// This is one of THREE manifests in the app, each opening into the right
// place when "Add to Home Screen" is used from that surface:
//   - here:                        customer storefront → start_url "/"
//   - src/app/admin/manifest.webmanifest/route.ts:  management area → "/admin"
//   - src/app/[slug]/manifest.webmanifest/route.ts: a tenant's storefront → "/<slug>"
export async function GET() {
  return NextResponse.json(
    {
      name: "DOMINANT",
      short_name: "DOMINANT",
      description: "זימון תורים - DOMINANT Barbershop",
      lang: "he",
      dir: "rtl",
      start_url: "/",
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
    },
    { headers: { "Content-Type": "application/manifest+json" } }
  );
}
