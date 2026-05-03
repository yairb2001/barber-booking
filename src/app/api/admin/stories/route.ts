import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session?.businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const business = await prisma.business.findFirst({ where: { id: session.businessId } });
  if (!business) return NextResponse.json([]);

  const stories = await prisma.story.findMany({
    where: { businessId: business.id },
    orderBy: { sortOrder: "asc" },
    include: { staff: { select: { id: true, name: true, avatarUrl: true } } },
  });
  return NextResponse.json(stories);
}

export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session?.businessId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const business = await prisma.business.findFirst({ where: { id: session.businessId } });
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  // Barber → always their own staffId; owner → accepts staffId from body (or null)
  const staffId = session.isOwner
    ? (body.staffId ?? null)
    : (session.staffId ?? null);

  const story = await prisma.story.create({
    data: {
      businessId: business.id,
      staffId,
      mediaUrl: body.mediaUrl,
      caption: body.caption ?? null,
      sortOrder: body.sortOrder ?? 0,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
    include: { staff: { select: { id: true, name: true, avatarUrl: true } } },
  });
  return NextResponse.json(story, { status: 201 });
}
