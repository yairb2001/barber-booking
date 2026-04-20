import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const staff = await prisma.staff.findMany({
    include: {
      schedules: true,
      staffServices: { include: { service: true } },
    },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json(staff);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  const staff = await prisma.staff.create({
    data: {
      businessId: business.id,
      name: body.name,
      phone: body.phone || null,
      avatarUrl: body.avatarUrl || null,
      role: body.role || "barber",
      isAvailable: body.isAvailable ?? true,
      inQuickPool: body.inQuickPool ?? false,
      sortOrder: body.sortOrder ?? 0,
    },
  });
  return NextResponse.json(staff, { status: 201 });
}
