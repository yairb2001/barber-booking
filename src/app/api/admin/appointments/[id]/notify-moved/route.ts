import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";
import { sendMessage, appointmentMovedText } from "@/lib/messaging";

/**
 * POST /api/admin/appointments/[id]/notify-moved
 *
 * Sends a WhatsApp to the customer telling them their appointment was moved.
 * Used after a successful drag-to-move when the admin opts in to notify.
 * No body required — pulls the appointment's current state and renders the
 * `appointment_moved` template.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = requireOwner(req);
  if (guard) return guard;

  const appt = await prisma.appointment.findUnique({
    where: { id: params.id },
    include: { customer: true, staff: true, service: true },
  });
  if (!appt) return NextResponse.json({ error: "התור לא נמצא" }, { status: 404 });

  const business = await prisma.business.findUnique({ where: { id: appt.businessId } });
  if (!business) return NextResponse.json({ error: "no business" }, { status: 500 });

  const dateLabel = appt.date.toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const body = appointmentMovedText({
    customerName: appt.customer.name,
    businessName: business.name,
    newDateLabel: dateLabel,
    newTime: appt.startTime,
    newStaffName: appt.staff.name,
    serviceName: appt.service.name,
  }, business.appointmentMovedTemplate);

  const result = await sendMessage({
    businessId: business.id,
    appointmentId: appt.id,
    customerPhone: appt.customer.phone,
    kind: "appointment_moved",
    body,
  });

  return NextResponse.json(result);
}
