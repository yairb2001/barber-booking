import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";

// GET — all portfolio items for this business, grouped by staff
export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json([]);

  const staff = await prisma.staff.findMany({
    where: { businessId: business.id },
    orderBy: { sortOrder: "asc" },
    include: {
      portfolio: { orderBy: { sortOrder: "asc" } },
    },
  });

  return NextResponse.json(staff);
}

// POST — add a portfolio item
export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const body = await req.json();
  const { staffId, imageUrl, caption } = body;
  if (!staffId || !imageUrl) {
    return NextResponse.json({ error: "staffId and imageUrl are required" }, { status: 400 });
  }

  // Get next sortOrder for this staff
  const count = await prisma.portfolioItem.count({ where: { staffId } });

  const item = await prisma.portfolioItem.create({
    data: { staffId, imageUrl, caption: caption ?? null, sortOrder: count },
  });
  return NextResponse.json(item, { status: 201 });
}
