import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { resolveTheme } from "@/lib/themes";

export const dynamic = "force-dynamic";

/**
 * GET /api/businesses
 *
 * Public discovery endpoint — returns all active businesses for the mobile app
 * listing screen.  No auth required.
 *
 * Returns:
 *   [{ id, slug, name, logoUrl, coverImageUrl, address, brandColor, about }]
 */
export async function GET() {
  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      logoUrl: true,
      coverImageUrl: true,
      address: true,
      about: true,
      brandColor: true,
      settings: true,
    },
    orderBy: { name: "asc" },
  });

  const result = businesses.map((b) => {
    // Resolve brand color from theme settings (same logic as /api/business)
    const theme = resolveTheme(b.settings);
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      logoUrl: b.logoUrl,
      coverImageUrl: b.coverImageUrl,
      address: b.address,
      about: b.about,
      brandColor: theme.brand ?? b.brandColor ?? "#D4AF37",
    };
  });

  return NextResponse.json(result);
}
