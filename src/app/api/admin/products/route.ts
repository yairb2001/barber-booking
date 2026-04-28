import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const items = await prisma.product.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const body = await req.json();
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  const item = await prisma.product.create({
    data: {
      businessId: business.id,
      name: body.name,
      description: body.description || null,
      price: parseFloat(body.price),
      imageUrl: body.imageUrl || null,
      isVisible: body.isVisible ?? true,
      sortOrder: body.sortOrder ?? 0,
    },
  });
  return NextResponse.json(item, { status: 201 });
}
