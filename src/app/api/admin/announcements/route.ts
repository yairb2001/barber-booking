import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getSessionBusiness, requireOwner } from "@/lib/session";

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const items = await prisma.announcement.findMany({
    where: { businessId: session.businessId },
    orderBy: [{ isPinned: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const body = await req.json();
  const business = await getSessionBusiness(req);
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  const item = await prisma.announcement.create({
    data: {
      businessId: business.id,
      title: body.title,
      content: body.content || null,
      isPinned: body.isPinned ?? false,
      sortOrder: body.sortOrder ?? 0,
    },
  });
  return NextResponse.json(item, { status: 201 });
}
