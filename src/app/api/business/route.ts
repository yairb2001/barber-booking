import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const business = await prisma.business.findFirst({
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      coverImageUrl: true,
      brandColor: true,
      phone: true,
      address: true,
      about: true,
      socialLinks: true,
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

  return NextResponse.json({ ...business, socialLinks });
}
