import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json(null);
  return NextResponse.json({
    ...business,
    socialLinks: business.socialLinks ? JSON.parse(business.socialLinks) : {},
    settings: business.settings ? JSON.parse(business.settings) : {},
  });
}

export async function PATCH(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const body = await req.json();
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  const updated = await prisma.business.update({
    where: { id: business.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.address !== undefined && { address: body.address }),
      ...(body.about !== undefined && { about: body.about }),
      ...(body.logoUrl !== undefined && { logoUrl: body.logoUrl }),
      ...(body.coverImageUrl !== undefined && { coverImageUrl: body.coverImageUrl }),
      ...(body.brandColor !== undefined && { brandColor: body.brandColor }),
      ...(body.secondaryColor !== undefined && { secondaryColor: body.secondaryColor }),
      ...(body.bgColor !== undefined && { bgColor: body.bgColor }),
      ...(body.textColor !== undefined && { textColor: body.textColor }),
      ...(body.socialLinks !== undefined && {
        socialLinks: JSON.stringify(body.socialLinks),
      }),
      ...(body.settings !== undefined && {
        settings: JSON.stringify(body.settings),
      }),
      // WhatsApp / messaging
      ...(body.whatsappNumber !== undefined && { whatsappNumber: body.whatsappNumber }),
      ...(body.messagingProvider !== undefined && { messagingProvider: body.messagingProvider }),
      ...(body.greenApiInstanceId !== undefined && { greenApiInstanceId: body.greenApiInstanceId }),
      ...(body.greenApiToken !== undefined && { greenApiToken: body.greenApiToken }),
      ...(body.features !== undefined && { features: JSON.stringify(body.features) }),
      // Reminder templates (null = use built-in default)
      ...(body.reminder24hTemplate !== undefined && {
        reminder24hTemplate: body.reminder24hTemplate || null,
      }),
      ...(body.reminder2hTemplate !== undefined && {
        reminder2hTemplate: body.reminder2hTemplate || null,
      }),
      // Booking calendar
      ...(body.bookingHorizonDays !== undefined && {
        bookingHorizonDays: Number(body.bookingHorizonDays) || 30,
      }),
      ...(body.minBookingLeadMinutes !== undefined && {
        minBookingLeadMinutes: Math.max(0, Number(body.minBookingLeadMinutes) || 0),
      }),
      // Re-engagement automation
      ...(body.reengageEnabled !== undefined && { reengageEnabled: Boolean(body.reengageEnabled) }),
      ...(body.reengageWeeks   !== undefined && { reengageWeeks:   Number(body.reengageWeeks) || 6 }),
      ...(body.reengageTemplate !== undefined && {
        reengageTemplate: body.reengageTemplate || null,
      }),
    },
  });
  return NextResponse.json(updated);
}
