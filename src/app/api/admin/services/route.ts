import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const services = await prisma.service.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(services);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  const service = await prisma.service.create({
    data: {
      businessId: business.id,
      name: body.name,
      description: body.description || null,
      price: parseFloat(body.price),
      durationMinutes: parseInt(body.durationMinutes),
      isVisible: body.isVisible ?? true,
      sortOrder: body.sortOrder ?? 0,
    },
  });
  return NextResponse.json(service, { status: 201 });
}
