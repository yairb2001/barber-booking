import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { resolveTheme } from "@/lib/themes";

export const dynamic = "force-dynamic";

export async function GET() {
  const business = await prisma.business.findFirst({
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      coverImageUrl: true,
      phone: true,
      address: true,
      about: true,
      socialLinks: true,
      settings: true,
      bookingHorizonDays: true,
    },
  });

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  // Parse socialLinks from JSON string
  const socialLinks = business.socialLinks
    ? JSON.parse(business.socialLinks)
    : {};

  // Resolve full theme palette from settings
  const theme = resolveTheme(business.settings);

  return NextResponse.json({
    ...business,
    settings: undefined, // strip raw settings — theme is exposed instead
    socialLinks,
    theme,         // full palette object: bg, brand, fontDisplay, etc.
    themeId: theme.id,
    // Backward compat: legacy fields still expected by some consumers
    brandColor: theme.brand,
    bgColor: theme.bg,
  });
}
