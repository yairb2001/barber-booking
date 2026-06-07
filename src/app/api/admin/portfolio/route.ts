import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

// GET — owner: all staff portfolios; barber: only own items
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json([]);

  if (session.isOwner) {
    const staff = await prisma.staff.findMany({
      where: { businessId: business.id },
      orderBy: { sortOrder: "asc" },
      include: { portfolio: { orderBy: { sortOrder: "asc" } } },
    });
    return NextResponse.json(staff);
  }

  // Barber — return only their own items, wrapped in a single-element array
  const staffRecord = await prisma.staff.findUnique({
    where: { id: session.staffId! },
    include: { portfolio: { orderBy: { sortOrder: "asc" } } },
  });
  if (!staffRecord) return NextResponse.json([]);
  return NextResponse.json([staffRecord]);
}

// POST — add a portfolio item
export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { imageUrl, caption } = body;

  // Owner can post for any staff; barber can only post for themselves
  const staffId = session.isOwner ? body.staffId : session.staffId;
  if (!staffId || !imageUrl) {
    return NextResponse.json({ error: "staffId and imageUrl are required" }, { status: 400 });
  }

  // Barbers can only post to their own portfolio
  if (!session.isOwner && staffId !== session.staffId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const count = await prisma.portfolioItem.count({ where: { staffId } });
  const item = await prisma.portfolioItem.create({
    data: { staffId, imageUrl, caption: caption ?? null, sortOrder: count },
  });
  return NextResponse.json(item, { status: 201 });
}
