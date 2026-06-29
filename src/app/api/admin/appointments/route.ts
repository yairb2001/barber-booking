import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getEffectivePermissions, getSessionBusiness } from "@/lib/session";
import { sendMessage, confirmationText, hasFeature, applyTemplate, firstName, cancelLine, formatBusinessName, DEFAULT_WALK_IN_TEMPLATE, DEFAULT_FIRST_BOOKING_TEMPLATE } from "@/lib/messaging";
import { timeToMinutes } from "@/lib/utils";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  // Tenant isolation: every admin read MUST be bound to the logged-in business.
  // Without this, findMany() below returns appointments from ALL businesses.
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const staffIdParam = searchParams.get("staffId");

  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  const where: Record<string, unknown> = { businessId: session.businessId };
  if (from && to) {
    // Date range query — used by dashboard for monthly views
    where.date = {
      gte: new Date(from + "T00:00:00.000Z"),
      lte: new Date(to   + "T23:59:59.999Z"),
    };
  } else if (date) {
    // Single-day query — used by the calendar
    const start = new Date(date + "T00:00:00.000Z");
    const end   = new Date(date + "T23:59:59.999Z");
    where.date = { gte: start, lte: end };
  }

  // Permission enforcement: a barber WITHOUT "view all calendars" is locked to
  // their own column — they can never read other barbers' appointments, even if
  // a staffId param for someone else is supplied. Owners and permitted barbers
  // may filter freely by staffId.
  const perms = await getEffectivePermissions(req);
  if (!perms.isOwner && !perms.canViewAllCalendars && perms.staffId) {
    where.staffId = perms.staffId;
  } else if (staffIdParam) {
    where.staffId = staffIdParam;
  }

  const appointments = await prisma.appointment.findMany({
    where, include: { customer: true, staff: true, service: true },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  return NextResponse.json(appointments);
}

export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  const body = await req.json();
  const business = await getSessionBusiness(req);
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  // Whose calendar does this appointment land on?
  //  - Owner → the requested staffId (books for anyone).
  //  - Sub-manager (barber with "view all calendars") → the requested staffId
  //    too, so booking into another barber's column actually lands there.
  //  - Regular barber → forced to their own staffId (can only book for self).
  const perms = await getEffectivePermissions(req);
  const canBookForOthers = perms.isOwner || perms.canViewAllCalendars;
  const staffId = (!canBookForOthers && session?.staffId) ? session.staffId : body.staffId;

  // Find or create customer. Normalize the phone to E.164 (972...) so a number
  // pasted from the phone's contacts (with "+", spaces, dashes, or invisible
  // Unicode directional marks) is stored cleanly — otherwise later phone-based
  // lookups (swap replies, agent recognition, chat linking) silently miss it.
  const customerPhone = normalizeIsraeliPhone(body.phone) || String(body.phone || "").trim();
  let customer = await prisma.customer.findUnique({
    where: { businessId_phone: { businessId: business.id, phone: customerPhone } },
  });
  if (!customer) {
    // For new customers, capture referral attribution (parity with /book/confirm flow)
    let referredById: string | null = null;
    if (body.referrerPhone && typeof body.referrerPhone === "string") {
      const cleanPhone = normalizeIsraeliPhone(body.referrerPhone) || body.referrerPhone.replace(/\s/g, "");
      const referrer = await prisma.customer.findUnique({
        where: { businessId_phone: { businessId: business.id, phone: cleanPhone } },
        select: { id: true },
      });
      if (referrer) referredById = referrer.id;
    }
    customer = await prisma.customer.create({
      data: {
        businessId: business.id,
        phone: customerPhone,
        name: body.customerName,
        referralSource: body.referralSource || null,
        referredById,
      },
    });
  }

  const service = await prisma.service.findUnique({ where: { id: body.serviceId } });
  if (!service) return NextResponse.json({ error: "Service not found" }, { status: 400 });

  // Duration can come from request (custom) or fall back to the service default
  const duration = Number(body.durationMinutes) > 0 ? Number(body.durationMinutes) : service.durationMinutes;

  const [sh, sm] = body.startTime.split(":").map(Number);
  const startMins    = sh * 60 + sm;
  const endTotalMins = startMins + duration;
  const endTime = `${String(Math.floor(endTotalMins / 60)).padStart(2, "0")}:${String(endTotalMins % 60).padStart(2, "0")}`;

  const dateObj = new Date(body.date.split("T")[0] + "T00:00:00.000Z");
  // Match the whole UTC day as a RANGE so legacy rows that stored the start time
  // inside `date` are still caught by the conflict check (avoids double-booking).
  const dayEnd = new Date(dateObj.getTime() + 24 * 60 * 60 * 1000);

  // Conflict check (unless explicitly bypassed with override: true)
  if (!body.override) {
    const existing = await prisma.appointment.findMany({
      where: {
        staffId,
        date: { gte: dateObj, lt: dayEnd },
        status: { in: ["pending", "confirmed"] },
      },
      select: { id: true, startTime: true, endTime: true, customer: { select: { name: true } } },
    });
    const conflict = existing.find(apt => {
      const aStart = timeToMinutes(apt.startTime);
      const aEnd   = timeToMinutes(apt.endTime);
      return startMins < aEnd && endTotalMins > aStart;
    });
    if (conflict) {
      return NextResponse.json(
        {
          error: `השעה הזו כבר תפוסה ע״י ${conflict.customer.name} (${conflict.startTime}–${conflict.endTime}). להמשיך בכל זאת?`,
          conflict: true,
        },
        { status: 409 }
      );
    }
  }

  const appointment = await prisma.appointment.create({
    data: {
      businessId: business.id,
      customerId: customer.id,
      staffId,
      serviceId: body.serviceId,
      date: dateObj,
      startTime: body.startTime,
      endTime,
      status: "confirmed",
      price: body.price ?? service.price,
      note: body.note || null,
      walkIn: !!body.walkIn,
      source: "admin", // staff added it in the calendar — don't notify
    },
    include: { customer: true, staff: true, service: true },
  });

  // Send WhatsApp confirmation only when the appointment is genuinely in the future.
  // Walk-in: the customer is physically present — no need for a "your appointment is booked" message.
  // Past/same-time: admin is recording an appointment that already happened — don't spam the customer.
  //
  // We approximate Israel time as UTC+2 (conservative; 1h off in summer — acceptable for this check).
  const dateStr = body.date.split("T")[0]; // "YYYY-MM-DD"
  const apptTimestamp = new Date(
    `${dateStr}T${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}:00+02:00`
  ).getTime();
  const isUpcoming = apptTimestamp > Date.now();

  // ── Confirmation ─────────────────────────────────────────────────────────────
  // Sent when the booker asked to notify the customer (default true from the
  // admin modal) OR — for programmatic callers without the flag — when the
  // appointment is genuinely upcoming. `notifyCustomer: false` lets a barber
  // record a past/quiet appointment without messaging the customer.
  // Collect notifications and await before returning — on Vercel serverless a
  // fire-and-forget send is often killed once the response is sent (messages
  // were getting stuck in "queued"). The GreenAPI send is timeout-capped.
  const notifyTasks: Promise<unknown>[] = [];
  const wantsNotify = body.notifyCustomer !== false && (body.notifyCustomer === true || isUpcoming);
  if (!body.walkIn && wantsNotify && hasFeature(business.features, "reminders")) {
    const dateLabel = appointment.date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });

    // First-booking detection — even when the ADMIN books for a new customer,
    // send the special new-customer welcome (parity with the /book self-booking flow).
    const apptCount = await prisma.appointment.count({
      where: { customerId: customer.id, businessId: business.id },
    });
    const isFirstBooking = apptCount === 1;

    let msgBody: string;
    let msgKind: "confirmation" | "first_booking";

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
    const cancelLink = `${baseUrl}/book/my-appointments`;

    if (isFirstBooking) {
      const tmpl = business.firstBookingTemplate || DEFAULT_FIRST_BOOKING_TEMPLATE;
      msgBody = applyTemplate(tmpl, {
        name:         firstName(appointment.customer.name),
        business:     formatBusinessName(business.name),
        date:         dateLabel,
        time:         appointment.startTime,
        end_time:     appointment.endTime,
        staff:        appointment.staff.name,
        service:      appointment.service.name,
        price:        String(appointment.price),
        address_line: business.address ? `\n📍 ${business.address}` : "",
        cancel_link:  cancelLink,
        cancel_line:  cancelLine(cancelLink),
      });
      msgKind = "first_booking";
    } else {
      msgBody = confirmationText({
        customerName: appointment.customer.name,
        businessName: business.name,
        staffName: appointment.staff.name,
        serviceName: appointment.service.name,
        dateLabel,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        price: appointment.price,
        address: business.address,
        cancelLink,
      }, business.confirmationTemplate);
      msgKind = "confirmation";
    }

    notifyTasks.push(sendMessage({
      businessId: business.id,
      appointmentId: appointment.id,
      customerPhone: appointment.customer.phone,
      kind: msgKind,
      body: msgBody,
    }).catch(err => console.error("confirmation send failed", err)));
  }

  // ── Walk-in thank-you — always sent, regardless of whether time has passed ────
  // Sent immediately so the customer gets it right away.
  // Uses the custom walk_in template if the owner configured one, otherwise the default.
  if (!!body.walkIn) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
    const bookingLink = `${baseUrl}/book`;
    const tmpl = business.walkInTemplate || DEFAULT_WALK_IN_TEMPLATE;
    const walkInBody = applyTemplate(tmpl, {
      name:         firstName(appointment.customer.name),
      business:     formatBusinessName(business.name),
      booking_link: bookingLink,
    });
    console.log("[walk-in] sending thank-you to", appointment.customer.phone);
    notifyTasks.push(sendMessage({
      businessId: business.id,
      appointmentId: appointment.id,
      customerPhone: appointment.customer.phone,
      kind: "walk_in",
      body: walkInBody,
    }).then(r => {
      if (!r.ok) console.error("[walk-in] send failed:", r.error);
      else console.log("[walk-in] sent ok");
    }).catch(err => console.error("[walk-in] exception:", err)));
  }

  // Await all sends so they complete before the function is frozen.
  await Promise.allSettled(notifyTasks);

  return NextResponse.json(appointment, { status: 201 });
}
