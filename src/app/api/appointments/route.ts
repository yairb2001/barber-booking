import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { minutesToTime, timeToMinutes } from "@/lib/utils";
import { sendMessage, confirmationText, hasFeature, applyTemplate, firstName, cancelLine, DEFAULT_FIRST_BOOKING_TEMPLATE } from "@/lib/messaging";
import { pushToStaff, pushToOwner } from "@/lib/native/push";
import { getReferralConfig, getReferralFriendSource } from "@/lib/referral";
import { notifyWaitlistForCancellation } from "@/lib/waitlist-notify";
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
    // When the customer already has an upcoming appointment we stop and ask them
    // (in the UI) whether they want this as an EXTRA appointment ("additional")
    // or to cancel the existing one(s) and book this instead ("cancel").
    existingDecision, // undefined | "additional" | "cancel"
  } = body as typeof body & { existingDecision?: "additional" | "cancel" };

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

  // Load the business early — we need its settings to resolve which referral
  // source is the (owner-renamable) "friend" source.
  const business = await prisma.business.findUnique({ where: { id: staff.businessId } });
  const friendSource = getReferralFriendSource(business?.settings ?? null);

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

  if (friendSource && referralSource === friendSource) {
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
  // Match the whole UTC day as a RANGE — some legacy rows stored the start time
  // inside `date` (e.g. T10:30:00Z); an exact-midnight match would miss them and
  // allow a double-booking onto an already-taken slot.
  const dayEnd = new Date(dateObj.getTime() + 24 * 60 * 60 * 1000);

  // Get existing appointments for the day and check for a time overlap
  const existingAppointments = await prisma.appointment.findMany({
    where: {
      staffId,
      date: { gte: dateObj, lt: dayEnd },
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

  // ── Existing-appointment guard ───────────────────────────────────────────────
  // If this customer already has upcoming appointment(s), don't silently create a
  // second one. The UI must ask: keep the existing AND add this ("additional"),
  // or cancel the existing one(s) and book this instead ("cancel"). A brand-new
  // customer (just created above) has none, so this is a no-op for them.
  const nowUtc = new Date();
  const todayMidnightUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate()));
  const upcomingAppts = await prisma.appointment.findMany({
    where: {
      customerId: customer.id,
      businessId: staff.businessId,
      status: { in: ["pending", "confirmed"] },
      date: { gte: todayMidnightUtc },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    include: {
      staff:   { select: { name: true } },
      service: { select: { name: true } },
    },
  });

  if (upcomingAppts.length > 0 && existingDecision !== "additional" && existingDecision !== "cancel") {
    // Ask the customer what to do — the UI shows a choice dialog.
    return NextResponse.json({
      existingAppointment: true,
      appointments: upcomingAppts.map(a => ({
        id:          a.id,
        dateLabel:   a.date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" }),
        startTime:   a.startTime,
        staffName:   a.staff?.name ?? "",
        serviceName: a.service?.name ?? "",
      })),
    }, { status: 409 });
  }

  // Customer chose to cancel the existing appointment(s) and rebook → cancel them
  // now (stamp cancelledAt so they surface in the admin notifications feed) and
  // tell the waitlist their slots opened up.
  if (existingDecision === "cancel" && upcomingAppts.length > 0) {
    for (const a of upcomingAppts) {
      await prisma.appointment.update({
        where: { id: a.id },
        data:  { status: "cancelled_by_customer", cancelledAt: new Date() },
      });
      await notifyWaitlistForCancellation({
        businessId: staff.businessId,
        staffId:    a.staffId,
        date:       a.date,
        startTime:  a.startTime,
      }).catch(console.error);
    }
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
      source: "customer", // customer booked via the public site
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

  // Side-effect notifications (push + WhatsApp). On Vercel serverless the
  // function is frozen once we return the response, so a true fire-and-forget
  // promise often gets killed mid-flight (we saw many messages stuck in
  // "queued"). Collect every notification here and await them all just before
  // returning so they actually complete. Each is individually guarded, and the
  // GreenAPI send is capped by a 12s timeout, so this can't hang the booking.
  const notifyTasks: Promise<unknown>[] = [];

  // Native push to the assigned barber — "you have a new appointment".
  // Also notify the business owner/manager (who has the app installed).
  {
    const pushDateLabel = dateObj.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
    notifyTasks.push(pushToStaff(staffId, {
      title: "תור חדש נקבע 📅",
      body: `${customer.name} — ${appointment.service.name}\n${pushDateLabel} בשעה ${startTime}`,
      data: { type: "appointment", appointmentId: appointment.id, date },
    }).catch(() => {}));
    notifyTasks.push(pushToOwner(staff.businessId, {
      title: "תור חדש נקבע 📅",
      body: `${customer.name} אצל ${appointment.staff.name} — ${appointment.service.name}\n${pushDateLabel} בשעה ${startTime}`,
      data: { type: "appointment", appointmentId: appointment.id, date },
    }).catch(() => {}));
  }

  // Send WhatsApp confirmation (fire-and-forget)
  // For first-time customers: use the special first_booking welcome template.
  // For returning customers: use the regular confirmation template.
  // (business was loaded earlier — see friend-source resolution above)
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

    // Link to the customer's "my appointments" page, where they can view/cancel.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
    const cancelLink = `${baseUrl}/book/my-appointments`;

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
        cancel_link:  cancelLink,
        cancel_line:  cancelLine(cancelLink),
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
        cancel_link:  cancelLink,
        cancel_line:  cancelLine(cancelLink),
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
        cancelLink,
      }, business.confirmationTemplate);
      msgKind = "confirmation";
    }

    notifyTasks.push(sendMessage({
      businessId: staff.businessId,
      appointmentId: appointment.id,
      customerPhone,
      kind: msgKind,
      body: msgBody,
    }).catch(err => console.error("confirmation send failed", err)));
  }

  // Send thank-you to the referrer (fire-and-forget) — only when the referral
  // program is switched on by the owner.
  const referralConfig = getReferralConfig(business?.settings ?? null);
  if (referrerRecord && business && referralConfig.enabled) {
    // How many friends has the referrer now brought in (including this one)?
    const referralCount = await prisma.customer.count({
      where: { businessId: staff.businessId, referredById: referrerRecord.id },
    });
    const { goal, giftLabel } = referralConfig;
    const reached = referralCount >= goal;
    const remaining = Math.max(0, goal - referralCount);
    const progressLine = reached
      ? `🎉 הבאת ${referralCount} חברים — מגיעה לך ${giftLabel}! דבר/י איתנו 💈`
      : `הבאת *${referralCount}* מתוך *${goal}* — עוד ${remaining} ${remaining === 1 ? "חבר" : "חברים"} ו${giftLabel} עליך! 💈`;
    const thankYouBody =
      `שלום ${referrerRecord.name} 🙌\n\n` +
      `${customer.name} קבע תור ב*${business.name}* ✂️ והזכיר את שמך כמי שהמליץ!\n\n` +
      `תודה על ההמלצה — אנחנו מעריכים אותך 🤩\n` +
      progressLine;
    notifyTasks.push(sendMessage({
      businessId: staff.businessId,
      customerPhone: referrerRecord.phone,
      kind: "referral_thankyou",
      body: thankYouBody,
    }).catch(err => console.error("referral thank-you send failed", err)));
  }

  // Await all notifications so they finish before the serverless function is
  // frozen — otherwise the WhatsApp confirmation often never gets sent.
  await Promise.allSettled(notifyTasks);

  // If this customer is on the waitlist for the SAME day they just booked, that
  // entry is now redundant — they got their appointment. Surface it so the UI
  // can ask whether to remove them from the waitlist. (Waitlist entries for
  // OTHER days are left alone — they may still want those.)
  const sameDayWaitlist = await prisma.waitlist.findMany({
    where: {
      customerId: customer.id,
      businessId: staff.businessId,
      status: { in: ["waiting", "notified"] },
      date: { gte: dateObj, lt: dayEnd },
    },
    select: { id: true, date: true },
  });

  return NextResponse.json({
    ...appointment,
    waitlistEntries: sameDayWaitlist.map(w => ({
      id: w.id,
      dateLabel: w.date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" }),
    })),
  }, { status: 201 });
}
