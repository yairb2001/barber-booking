import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const staffId = searchParams.get("staffId");
  const where: Record<string, unknown> = {};
  if (date) {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);
    where.date = { gte: start, lte: end };
  }
  if (staffId) where.staffId = staffId;
  const appointments = await prisma.appointment.findMany({
    where, include: { customer: true, staff: true, service: true },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  return NextResponse.json(appointments);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  // Find or create customer
  let customer = await prisma.customer.findUnique({
    where: { businessId_phone: { businessId: business.id, phone: body.phone } },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { businessId: business.id, phone: body.phone, name: body.customerName },
    });
  }

  const service = await prisma.service.findUnique({ where: { id: body.serviceId } });
  if (!service) return NextResponse.json({ error: "Service not found" }, { status: 400 });

  const startMins = body.startTime.split(":").map(Number).reduce((h: number, m: number, i: number) => i === 0 ? h + h * 60 : h + m, 0);
  const [sh, sm] = body.startTime.split(":").map(Number);
  const endTotalMins = sh * 60 + sm + service.durationMinutes;
  const endTime = `${String(Math.floor(endTotalMins / 60)).padStart(2, "0")}:${String(endTotalMins % 60).padStart(2, "0")}`;

  const appointment = await prisma.appointment.create({
    data: {
      businessId: business.id,
      customerId: customer.id,
      staffId: body.staffId,
      serviceId: body.serviceId,
      date: new Date(body.date),
      startTime: body.startTime,
      endTime,
      status: "confirmed",
      price: body.price ?? service.price,
      note: body.note || null,
    },
    include: { customer: true, staff: true, service: true },
  });
  return NextResponse.json(appointment, { status: 201 });
}
