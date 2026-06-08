import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { minutesToTime, timeToMinutes } from "@/lib/utils";
import { sendMessage, confirmationText, hasFeature, applyTemplate, firstName, DEFAULT_FIRST_BOOKING_TEMPLATE } from "@/lib/messaging";
import { pushToStaff, pushToOwner } from "@/lib/native/push";
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
    referrerPhone, // legacy: phone of the friend who referred
    referrerId,    // preferred: customer ID of the friend who referred (from autocomplete)
    note,          // optional customer note for this appointment
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
  let referrerRecord: { id: string; name: string; phone: string } | null = null;

  if (referralSource === "חבר הביא חבר") {
    if (referrerId) {
      // Preferred path: look up by ID (from autocomplete selection)
      referrerRecord = await prisma.customer.findUnique({
        where: { id: referrerId },
        select: { id: true, name: true, phone: true },
      });
    } else if (referrerPhone) {
      // Legacy path: look up by phone
      referrerRecord = await prisma.customer.findUnique({
        where: { businessId_phone: { businessId: staff.businessId, phone: referrerPhone } },
        select: { id: true, name: true, phone: true },
      });
    }
    if (referrerRecord) referredById = referrerRecord.id;
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
      note: (typeof note === "string" && note.trim()) ? note.trim() : null,
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

  // Native push to the assigned barber — "you have a new appointment".
  // Also notify the business owner/manager (who has the app installed).
  {
    const pushDateLabel = dateObj.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
    pushToStaff(staffId, {
      title: "תור חדש נקבע 📅",
      body: `${customer.name} — ${appointment.service.name}\n${pushDateLabel} בשעה ${startTime}`,
      data: { type: "appointment", appointmentId: appointment.id, date },
    }).catch(() => {});
    pushToOwner(staff.businessId, {
      title: "תור חדש נקבע 📅",
      body: `${customer.name} אצל ${appointment.staff.name} — ${appointment.service.name}\n${pushDateLabel} בשעה ${startTime}`,
      data: { type: "appointment", appointmentId: appointment.id, date },
    }).catch(() => {});
  }

  // Send WhatsApp confirmation (fire-and-forget)
  // For first-time customers: use the special first_booking welcome template.
  // For returning customers: use the regular confirmation template.
  const business = await prisma.business.findUnique({ where: { id: staff.businessId } });
  if (business && hasFeature(business.features, "reminders")) {
    const dateLabel = dateObj.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });

    // Count all their appointments at this business (the one we just created counts too,
    // so isFirstBooking = true when total == 1)
    const apptCount = await prisma.appointment.count({
      where: { customerId: customer.id, businessId: staff.businessId },
    });
    const isFirstBooking = apptCount === 1;

    let msgBody: string;
    let msgKind: "confirmation" | "first_booking";

    if (isFirstBooking && business.firstBookingTemplate !== null) {
      // Owner has customised the first-booking template → use it
      const tmpl = business.firstBookingTemplate || DEFAULT_FIRST_BOOKING_TEMPLATE;
      msgBody = applyTemplate(tmpl, {
        name:         firstName(customer.name),
        business:     business.name,
        date:         dateLabel,
        time:         startTime,
        end_time:     endTime,
        staff:        appointment.staff.name,
        service:      appointment.service.name,
        price:        String(price),
        address_line: business.address ? `\n📍 ${business.address}` : "",
      });
      msgKind = "first_booking";
    } else if (isFirstBooking) {
      // No custom template yet → still send the default first-booking message
      msgBody = applyTemplate(DEFAULT_FIRST_BOOKING_TEMPLATE, {
        name:         firstName(customer.name),
        business:     business.name,
        date:         dateLabel,
        time:         startTime,
        end_time:     endTime,
        staff:        appointment.staff.name,
        service:      appointment.service.name,
        price:        String(price),
        address_line: business.address ? `\n📍 ${business.address}` : "",
      });
      msgKind = "first_booking";
    } else {
      // Returning customer — regular confirmation
      msgBody = confirmationText({
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
      msgKind = "confirmation";
    }

    sendMessage({
      businessId: staff.businessId,
      appointmentId: appointment.id,
      customerPhone,
      kind: msgKind,
      body: msgBody,
    }).catch(err => console.error("confirmation send failed", err));
  }

  // Send thank-you to the referrer (fire-and-forget)
  if (referrerRecord && business) {
    const thankYouBody =
      `שלום ${referrerRecord.name} 🙌\n\n` +
      `${customer.name} קבע תור ב*${business.name}* ✂️ והזכיר את שמך כמי שהמליץ!\n\n` +
      `תודה על ההמלצה — אנחנו מעריכים אותך 🤩\n` +
      `כל 2 חברים שתביא — מוצר במתנה | 3 חברים — תספורת חינם 💈`;
    sendMessage({
      businessId: staff.businessId,
      customerPhone: referrerRecord.phone,
      kind: "referral_thankyou",
      body: thankYouBody,
    }).catch(err => console.error("referral thank-you send failed", err));
  }

  return NextResponse.json(appointment, { status: 201 });
}
