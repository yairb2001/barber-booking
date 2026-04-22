import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { minutesToTime, timeToMinutes } from "@/lib/utils";
import { sendMessage, confirmationText, hasFeature } from "@/lib/messaging";

export async function POST(request: Request) {
  const body = await request.json();
  const { staffId, serviceId, date, startTime, customerPhone, customerName, referralSource } = body;

  if (!staffId || !serviceId || !date || !startTime || !customerPhone || !customerName) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Get service details (with custom duration/price if exists)
  const staffService = await prisma.staffService.findUnique({
    where: { staffId_serviceId: { staffId, serviceId } },
    include: { service: true },
  });

  if (!staffService) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  const duration = staffService.customDuration || staffService.service.durationMinutes;
  const price = staffService.customPrice || staffService.service.price;
  const endTime = minutesToTime(timeToMinutes(startTime) + duration);

  // Get business (we need the business_id)
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { businessId: true },
  });

  if (!staff) {
    return NextResponse.json({ error: "Staff not found" }, { status: 404 });
  }

  // Find or create customer
  let customer = await prisma.customer.findUnique({
    where: {
      businessId_phone: {
        businessId: staff.businessId,
        phone: customerPhone,
      },
    },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        businessId: staff.businessId,
        phone: customerPhone,
        name: customerName,
        referralSource,
      },
    });
  }

  // Check if slot is still available
  const dateObj = new Date(date + "T00:00:00");
  const conflicting = await prisma.appointment.findFirst({
    where: {
      staffId,
      date: dateObj,
      status: { in: ["pending", "confirmed"] },
    },
  });

  // More precise check: see if the specific time overlaps
  const existingAppointments = await prisma.appointment.findMany({
    where: {
      staffId,
      date: dateObj,
      status: { in: ["pending", "confirmed"] },
    },
  });

  const overlap = existingAppointments.some((apt) => {
    const aptStart = timeToMinutes(apt.startTime);
    const aptEnd = timeToMinutes(apt.endTime);
    const newStart = timeToMinutes(startTime);
    const newEnd = timeToMinutes(endTime);
    return newStart < aptEnd && newEnd > aptStart;
  });

  if (overlap) {
    return NextResponse.json(
      { error: "הסלוט כבר תפוס, נסה שעה אחרת" },
      { status: 409 }
    );
  }

  // Create appointment
  const appointment = await prisma.appointment.create({
    data: {
      businessId: staff.businessId,
      customerId: customer.id,
      staffId,
      serviceId,
      date: dateObj,
      startTime,
      endTime,
      price,
      status: "confirmed",
      referralSource,
    },
    include: {
      staff: { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  // Update customer last visit
  await prisma.customer.update({
    where: { id: customer.id },
    data: { lastVisitAt: new Date() },
  });

  // Send WhatsApp confirmation (fire-and-forget)
  const business = await prisma.business.findUnique({ where: { id: staff.businessId } });
  if (business && hasFeature(business.features, "reminders")) {
    const dateLabel = dateObj.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
    const msgBody = confirmationText({
      customerName: customer.name,
      businessName: business.name,
      staffName: appointment.staff.name,
      serviceName: appointment.service.name,
      dateLabel,
      startTime,
      endTime,
      price,
      address: business.address,
    });
    sendMessage({
      businessId: staff.businessId,
      appointmentId: appointment.id,
      customerPhone,
      kind: "confirmation",
      body: msgBody,
    }).catch(err => console.error("confirmation send failed", err));
  }

  return NextResponse.json(appointment, { status: 201 });
}
