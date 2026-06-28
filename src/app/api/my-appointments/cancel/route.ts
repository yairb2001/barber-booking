import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jwtVerify } from "jose";
import { notifyWaitlistForCancellation } from "@/lib/waitlist-notify";
import { pushToStaff, pushToOwner } from "@/lib/native/push";
import { sendMessage, cancellationText } from "@/lib/messaging";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-secret-change-in-production-please-set-AUTH_SECRET-env"
);

/**
 * POST /api/my-appointments/cancel
 *
 * Customer-initiated cancellation of their own upcoming appointment.
 * Body: { appointmentId, phone, token }
 *   - token is the OTP JWT issued by /api/otp/verify (type "otp")
 *   - the appointment must belong to the customer whose phone matches the token
 *
 * Sets status to "cancelled_by_customer", notifies the barber/owner (native push)
 * and the waitlist that a slot opened up.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { appointmentId, phone, token } = body as {
    appointmentId?: string;
    phone?: string;
    token?: string;
  };

  if (!appointmentId || !phone || !token) {
    return NextResponse.json({ error: "appointmentId, phone and token required" }, { status: 400 });
  }

  // Normalize phone to E.164 (same as OTP flow)
  const normalized = phone.replace(/\D/g, "").replace(/^0/, "972");

  // Verify OTP token
  let tokenPayload: { phone?: unknown; businessId?: unknown; type?: unknown } = {};
  try {
    const { payload } = await jwtVerify(token, SECRET);
    tokenPayload = payload as typeof tokenPayload;
  } catch {
    return NextResponse.json({ error: "פג תוקף הסשן — יש להתחבר מחדש" }, { status: 401 });
  }

  if (tokenPayload.type !== "otp" || tokenPayload.phone !== normalized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Load the appointment together with its customer (to verify ownership by phone)
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true, status: true, date: true, startTime: true, staffId: true,
      businessId: true,
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  if (!appt) {
    return NextResponse.json({ error: "התור לא נמצא" }, { status: 404 });
  }

  // Ownership check — the appointment's customer phone must match the verified phone
  const custNorm = (appt.customer?.phone ?? "").replace(/\D/g, "").replace(/^0/, "972");
  if (custNorm !== normalized) {
    return NextResponse.json({ error: "אין הרשאה לבטל תור זה" }, { status: 403 });
  }

  // Already cancelled — idempotent success
  if (appt.status === "cancelled_by_customer" || appt.status === "cancelled_by_staff") {
    return NextResponse.json({ ok: true, alreadyCancelled: true });
  }

  // Block cancelling appointments that already happened.
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const aptDateStr = appt.date.toISOString().split("T")[0];
  if (aptDateStr < todayStr) {
    return NextResponse.json({ error: "לא ניתן לבטל תור שכבר עבר" }, { status: 400 });
  }
  if (aptDateStr === todayStr) {
    const [h, m] = appt.startTime.split(":").map(Number);
    const aptMinutes = h * 60 + m;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (aptMinutes < nowMinutes) {
      return NextResponse.json({ error: "לא ניתן לבטל תור שכבר עבר" }, { status: 400 });
    }
  }

  await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: "cancelled_by_customer" },
  });

  const dateLabel = appt.date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });

  // Notify the assigned barber + business owner (native push).
  {
    pushToStaff(appt.staffId, {
      title: "תור בוטל ע״י הלקוח ❌",
      body: `${appt.customer?.name ?? "לקוח"}\n${dateLabel} בשעה ${appt.startTime}`,
      data: { type: "appointment_cancelled", appointmentId: appt.id },
    }).catch(() => {});
    pushToOwner(appt.businessId, {
      title: "תור בוטל ע״י הלקוח ❌",
      body: `${appt.customer?.name ?? "לקוח"}\n${dateLabel} בשעה ${appt.startTime}`,
      data: { type: "appointment_cancelled", appointmentId: appt.id },
    }).catch(() => {});
  }

  // Tell the waitlist a slot opened up. Awaited — the freed-slot message is sent
  // immediately (not queued), so we must wait for it before the serverless
  // function returns and gets frozen.
  await notifyWaitlistForCancellation({
    businessId: appt.businessId,
    staffId:    appt.staffId,
    date:       appt.date,
    startTime:  appt.startTime,
  }).catch(console.error);

  // Confirm the cancellation to the CUSTOMER on WhatsApp so they know for sure
  // their appointment was cancelled. Awaited (not fire-and-forget) because on
  // Vercel serverless the function is frozen right after we return — a detached
  // promise would often be killed before the message actually sends.
  if (appt.customer?.phone) {
    try {
      const business = await prisma.business.findUnique({ where: { id: appt.businessId } });
      if (business) {
        const cancelBody = cancellationText({
          customerName: appt.customer.name,
          businessName: business.name,
          dateLabel,
          startTime: appt.startTime,
          bySelf: true, // customer cancelled their own appointment → "בוטל בהצלחה"
        }, business.appointmentSelfCancelledTemplate);
        await sendMessage({
          businessId:    appt.businessId,
          appointmentId: appt.id,
          customerPhone: appt.customer.phone,
          kind:          "appointment_cancelled",
          body:          cancelBody,
        });
      }
    } catch (err) {
      console.error("customer cancellation confirmation send failed", err);
    }
  }

  return NextResponse.json({ ok: true });
}
