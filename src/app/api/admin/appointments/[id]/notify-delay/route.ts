import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwnStaffOrOwner } from "@/lib/session";
import { sendProactiveMessage, delayNotificationText } from "@/lib/messaging";

/**
 * POST /api/admin/appointments/[id]/notify-delay
 *
 * Sends a WhatsApp message to the customer letting them know the barber
 * is running late by a given number of minutes.
 *
 * Body: { delayMinutes: number }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const delayMinutes = body?.delayMinutes;
  if (!delayMinutes || typeof delayMinutes !== "number" || delayMinutes <= 0) {
    return NextResponse.json({ error: "delayMinutes חייב להיות מספר חיובי" }, { status: 400 });
  }

  const appt = await prisma.appointment.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      staff: true,
    },
  });
  if (!appt) return NextResponse.json({ error: "תור לא נמצא" }, { status: 404 });
  // Tenant isolation: never message a customer / send on another business's account.
  if (appt.businessId !== session.businessId) {
    return NextResponse.json({ error: "אין הרשאה לתור זה" }, { status: 403 });
  }

  // Owner can notify for any appointment; a barber only for their own.
  const guard = requireOwnStaffOrOwner(req, appt.staffId);
  if (guard) return guard;

  const business = await prisma.business.findUnique({ where: { id: appt.businessId } });
  if (!business) return NextResponse.json({ error: "no business" }, { status: 500 });

  const text = delayNotificationText(
    {
      customerName:    appt.customer.name,
      businessName:    business.name,
      appointmentTime: appt.startTime,
      delayMinutes,
    },
    business.delayNotificationTemplate,
  );

  const result = await sendProactiveMessage({
    businessId:    business.id,
    appointmentId: appt.id,
    customerPhone: appt.customer.phone,
    kind:          "delay_notification",
    body:          text,
    customerName:  appt.customer.name,
  });

  // Surface real send failures to the client (HTTP 502) instead of a silent 200.
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "send_failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
