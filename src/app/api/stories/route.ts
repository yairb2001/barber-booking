import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json([]);

  const now = new Date();
  const stories = await prisma.story.findMany({
    where: {
      businessId: business.id,
      isActive: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(stories);
}
