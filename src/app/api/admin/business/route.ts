import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json(null);
  return NextResponse.json({
    ...business,
    socialLinks: business.socialLinks ? JSON.parse(business.socialLinks) : {},
    settings: business.settings ? JSON.parse(business.settings) : {},
  });
}

export async function PATCH(req: NextRequest) {
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
    },
  });
  return NextResponse.json(updated);
}
