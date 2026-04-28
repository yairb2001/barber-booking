import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date    = searchParams.get("date");
  const staffId = searchParams.get("staffId");

  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json([], { status: 200 });

  // Staff scoping: barbers only see their own waitlist entries
  const session = getRequestSession(req);
  const effectiveStaffId = (session && !session.isOwner && session.staffId)
    ? session.staffId
    : staffId;

  const where: Record<string, unknown> = {
    businessId: business.id,
    status: "waiting",
  };
  if (date) {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);
    where.date = { gte: start, lte: end };
  }
  if (effectiveStaffId) where.staffId = effectiveStaffId;

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

  // Staff scoping: barbers can only create waitlist entries for themselves
  const session = getRequestSession(req);
  const staffId = (session && !session.isOwner && session.staffId)
    ? session.staffId
    : (body.staffId || null);

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
      businessId:         business.id,
      customerId:         customer.id,
      staffId,
      serviceId:          body.serviceId,
      date:               new Date(body.date),
      isFlexible:         body.isFlexible || false,
      preferredTimeOfDay: body.preferredTimeOfDay || "any",
      status:             "waiting",
    },
    include: { customer: true, service: true },
  });
  return NextResponse.json(entry, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();

  // Staff scoping: barbers can only modify their own waitlist entries
  const session = getRequestSession(req);
  if (session && !session.isOwner && session.staffId) {
    const existing = await prisma.waitlist.findUnique({
      where: { id: body.id },
      select: { staffId: true },
    });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (existing.staffId !== session.staffId) {
      return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
    }
  }

  const entry = await prisma.waitlist.update({
    where: { id: body.id },
    data:  { status: body.status },
  });
  return NextResponse.json(entry);
}
