import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const business = await prisma.business.findFirst({
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      coverImageUrl: true,
      brandColor: true,
      bgColor: true,
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

  // Parse theme from settings JSON (default: "light")
  let theme = "light";
  try {
    if (business.settings) {
      const s = JSON.parse(business.settings);
      if (s.theme) theme = s.theme;
    }
  } catch { /* ignore */ }

  return NextResponse.json({ ...business, settings: undefined, socialLinks, theme });
}
