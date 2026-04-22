import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const staffId = searchParams.get("staffId");

  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json([], { status: 200 });

  const where: Record<string, unknown> = {
    businessId: business.id,
    status: "waiting",
  };
  if (date) {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);
    where.date = { gte: start, lte: end };
  }
  if (staffId) where.staffId = staffId;

  const waitlist = await prisma.waitlist.findMany({
    where,
    include: { customer: true, service: true, staff: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(waitlist);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  let customer = await prisma.customer.findUnique({
    where: { businessId_phone: { businessId: business.id, phone: body.phone } },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { businessId: business.id, phone: body.phone, name: body.name || body.phone },
    });
  }

  const entry = await prisma.waitlist.create({
    data: {
      businessId: business.id,
      customerId: customer.id,
      staffId: body.staffId || null,
      serviceId: body.serviceId,
      date: new Date(body.date),
      isFlexible: body.isFlexible || false,
      status: "waiting",
    },
    include: { customer: true, service: true },
  });
  return NextResponse.json(entry, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const entry = await prisma.waitlist.update({
    where: { id: body.id },
    data: { status: body.status },
  });
  return NextResponse.json(entry);
}
