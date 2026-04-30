import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";
import { sendMessage, delayNotificationText } from "@/lib/messaging";

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
  const guard = requireOwner(req);
  if (guard) return guard;

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

  const result = await sendMessage({
    businessId:    business.id,
    appointmentId: appt.id,
    customerPhone: appt.customer.phone,
    kind:          "delay_notification",
    body:          text,
  });

  return NextResponse.json({ ok: result.ok, error: result.error });
}
