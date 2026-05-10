import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { sendMessage, confirmationText, hasFeature } from "@/lib/messaging";
import { timeToMinutes } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const staffIdParam = searchParams.get("staffId");

  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  const where: Record<string, unknown> = {};
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
  // If logged in as barber → force filter to own appointments only
  if (session && !session.isOwner && session.staffId) {
    where.staffId = session.staffId;
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
  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  // If barber → can only create appointments for themselves
  const staffId = (!session?.isOwner && session?.staffId) ? session.staffId : body.staffId;

  // Find or create customer
  let customer = await prisma.customer.findUnique({
    where: { businessId_phone: { businessId: business.id, phone: body.phone } },
  });
  if (!customer) {
    // For new customers, capture referral attribution (parity with /book/confirm flow)
    let referredById: string | null = null;
    if (body.referrerPhone && typeof body.referrerPhone === "string") {
      const cleanPhone = body.referrerPhone.replace(/\s/g, "");
      const referrer = await prisma.customer.findUnique({
        where: { businessId_phone: { businessId: business.id, phone: cleanPhone } },
        select: { id: true },
      });
      if (referrer) referredById = referrer.id;
    }
    customer = await prisma.customer.create({
      data: {
        businessId: business.id,
        phone: body.phone,
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

  // Conflict check (unless explicitly bypassed with override: true)
  if (!body.override) {
    const existing = await prisma.appointment.findMany({
      where: {
        staffId,
        date: dateObj,
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

  // ── Confirmation (future appointments only, non-walk-in) ─────────────────────
  if (!body.walkIn && isUpcoming && hasFeature(business.features, "reminders")) {
    const dateLabel = appointment.date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
    const confirmBody = confirmationText({
      customerName: appointment.customer.name,
      businessName: business.name,
      staffName: appointment.staff.name,
      serviceName: appointment.service.name,
      dateLabel,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      price: appointment.price,
      address: business.address,
    }, business.confirmationTemplate);
    sendMessage({
      businessId: business.id,
      appointmentId: appointment.id,
      customerPhone: appointment.customer.phone,
      kind: "confirmation",
      body: confirmBody,
    }).catch(err => console.error("confirmation send failed", err));
  }

  // ── Walk-in thank-you — always sent, regardless of whether time has passed ────
  // Sent immediately (not via cron) so the customer gets it right away.
  // The cron's MessageLog dedup prevents double-send if it runs later.
  if (!!body.walkIn) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
    const bookingLink = `${baseUrl}/book`;
    const walkInBody =
      `שלום ${appointment.customer.name} 👋\n\n` +
      `תודה שביקרת ב*${business.name}* ✂️\n` +
      `שמחנו לארח אותך ולגזור לך!\n\n` +
      `📅 לקביעת תור הבא:\n${bookingLink}\n\n` +
      `אפשר למצוא אותנו בוואצאפ עם המילים:\n` +
      `*מספרה* | *תספורת* | *ספר*\n\n` +
      `נתראה בפעם הבאה 💈`;
    console.log("[walk-in] sending thank-you to", appointment.customer.phone);
    sendMessage({
      businessId: business.id,
      appointmentId: appointment.id,
      customerPhone: appointment.customer.phone,
      kind: "walk_in",
      body: walkInBody,
    }).then(r => {
      if (!r.ok) console.error("[walk-in] send failed:", r.error);
      else console.log("[walk-in] sent ok");
    }).catch(err => console.error("[walk-in] exception:", err));
  }

  return NextResponse.json(appointment, { status: 201 });
}
