import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Per-tenant customer manifest — /<slug>/manifest.webmanifest.
//
// NOTE: this is a plain Route Handler, not Next's `manifest.ts` file
// convention — that convention silently produces a 404 when nested under a
// dynamic segment like [slug] (confirmed empirically against Next 14.2.35;
// it only works at static route segments, e.g. src/app/admin/manifest.ts).
// A regular route.ts has no such limitation.
//
// Keeps "Add to Home Screen" scoped to that business's own storefront
// (start_url/scope "/<slug>") instead of bouncing to the root DOMINANT
// storefront or /admin. Falls back to generic branding if the slug doesn't
// resolve — the page itself 404s via [slug]/layout.tsx; this just avoids a
// hard crash on a stray direct hit to the manifest URL.
export async function GET(
  _req: Request,
  { params }: { params: { slug: string } }
) {
  const biz = await prisma.business.findUnique({
    where: { slug: params.slug },
    select: { name: true },
  });
  const name = biz?.name || "DOMINANT";

  return NextResponse.json(
    {
      name,
      short_name: name.slice(0, 12),
      description: "זימון תורים",
      lang: "he",
      dir: "rtl",
      start_url: `/${params.slug}`,
      scope: `/${params.slug}`,
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
