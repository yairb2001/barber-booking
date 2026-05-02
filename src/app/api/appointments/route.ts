import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { minutesToTime, timeToMinutes } from "@/lib/utils";
import { sendMessage, confirmationText, hasFeature } from "@/lib/messaging";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-secret-change-in-production-please-set-AUTH_SECRET-env"
);

async function verifyOtpToken(token: string, phone: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (payload.type !== "otp") return false;
    // The phone in the token must match (after normalizing)
    const normalizedPhone = phone.replace(/\D/g, "").replace(/^0/, "972");
    return payload.phone === normalizedPhone;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    staffId, serviceId, date, startTime,
    customerPhone, customerName,
    referralSource,
    referrerPhone, // phone of the friend who referred — used when referralSource === "חבר הביא חבר"
    otpToken,      // short-lived JWT from /api/otp/verify
  } = body;

  if (!staffId || !serviceId || !date || !startTime || !customerPhone || !customerName) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // Verify OTP token — required for all customer-facing bookings
  if (!otpToken) {
    return NextResponse.json({ error: "נדרש אימות זהות — שלח קוד אימות" }, { status: 401 });
  }
  const tokenValid = await verifyOtpToken(otpToken, customerPhone);
  if (!tokenValid) {
    return NextResponse.json({ error: "קוד אימות לא תקף — בקש קוד חדש" }, { status: 401 });
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

  // If referred by a friend, look up the referrer customer record
  let referredById: string | undefined;
  if (referralSource === "חבר הביא חבר" && referrerPhone) {
    const referrer = await prisma.customer.findUnique({
      where: { businessId_phone: { businessId: staff.businessId, phone: referrerPhone } },
    });
    if (referrer) referredById = referrer.id;
  }

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        businessId: staff.businessId,
        phone: customerPhone,
        name: customerName,
        referralSource,
        referredById: referredById ?? null,
      },
    });
  } else if (referredById && !customer.referredById) {
    // Update referredById if not already set
    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: { referredById },
    });
  }

  // Always use UTC midnight so dates are consistent on all servers/timezones
  const dateObj = new Date(date + "T00:00:00.000Z");
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
    }, business.confirmationTemplate);
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
