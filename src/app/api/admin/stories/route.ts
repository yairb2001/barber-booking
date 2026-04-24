import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json([]);

  const stories = await prisma.story.findMany({
    where: { businessId: business.id },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(stories);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  const story = await prisma.story.create({
    data: {
      businessId: business.id,
      mediaUrl: body.mediaUrl,
      caption: body.caption ?? null,
      sortOrder: body.sortOrder ?? 0,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
  });
  return NextResponse.json(story, { status: 201 });
}
