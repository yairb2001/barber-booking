import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { resolveTheme } from "@/lib/themes";
import { fallbackBusiness } from "@/lib/tenant";
import { getReferralConfig, getReferralFriendSource, getReferralSources } from "@/lib/referral";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const businessId = searchParams.get("businessId");

  const business = slug
    ? await prisma.business.findUnique({ where: { slug }, select: {
        id: true, name: true, slug: true, logoUrl: true, coverImageUrl: true,
        phone: true, address: true, about: true, socialLinks: true,
        settings: true, bookingHorizonDays: true, facebookPixel: true,
      } })
    : businessId
      ? await prisma.business.findUnique({ where: { id: businessId }, select: {
          id: true, name: true, slug: true, logoUrl: true, coverImageUrl: true,
          phone: true, address: true, about: true, socialLinks: true,
          settings: true, bookingHorizonDays: true, facebookPixel: true,
        } })
      : await fallbackBusiness({
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
      facebookPixel: true,
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

  // Extract heroVideoUrl + whatsappPrefill from settings JSON
  let heroVideoUrl: string | null = null;
  let whatsappPrefill: string | null = null;
  let whatsappBubbleEnabled = true; // default ON when unset
  try {
    const settingsObj = business.settings ? JSON.parse(business.settings) : {};
    if (typeof settingsObj.heroVideoUrl === "string" && settingsObj.heroVideoUrl) {
      heroVideoUrl = settingsObj.heroVideoUrl;
    }
    if (typeof settingsObj.whatsappPrefill === "string" && settingsObj.whatsappPrefill.trim()) {
      whatsappPrefill = settingsObj.whatsappPrefill.trim();
    }
    whatsappBubbleEnabled = settingsObj.whatsappBubbleEnabled !== false;
  } catch { /* ignore */ }

  // Referral config the public booking flow needs. We expose ONLY the resolved
  // referral settings (never the raw settings blob), so the confirm page can
  // open the friend-picker for the owner's chosen source name.
  const referral = {
    ...getReferralConfig(business.settings),          // enabled, goal, giftLabel
    friendSource: getReferralFriendSource(business.settings),
    sources: getReferralSources(business.settings),
  };

  return NextResponse.json({
    ...business,
    settings: undefined, // strip raw settings — theme is exposed instead
    referral,      // resolved referral config (enabled/goal/giftLabel/friendSource)
    socialLinks,
    theme,         // full palette object: bg, brand, fontDisplay, etc.
    themeId: theme.id,
    // Backward compat: legacy fields still expected by some consumers
    brandColor: theme.brand,
    bgColor: theme.bg,
    // Hero video (optional)
    heroVideoUrl,
    // Pre-filled "book via WhatsApp" message (optional)
    whatsappPrefill,
    // Show the "book via WhatsApp" nudge bubble on the home page (default true)
    whatsappBubbleEnabled,
  });
}
