import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

export async function GET(req: NextRequest) {
  // Barbers also need to read services (for the new appointment modal)
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const services = await prisma.service.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json(services);
}

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
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
      showDuration: body.showDuration ?? true,
      sortOrder: body.sortOrder ?? 0,
    },
  });
  return NextResponse.json(service, { status: 201 });
}
