import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  enqueueMessage,
  hasFeature,
  applyTemplate,
  DEFAULT_2H_TEMPLATE,
  reminderVars,
} from "@/lib/messaging";
import { getBusinessNow, addDaysISO, appointmentInstant } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * 2-hour reminder SWEEP (optional, frequent).
 *
 * The daily `/api/cron/reminders` scan already enqueues 2h reminders for
 * appointments booked in advance. This endpoint exists to catch SAME-DAY
 * bookings made *after* that morning scan: point an external scheduler at it
 * every few minutes and it will enqueue any still-missing 2h reminder, with a
 * precise `scheduledFor = appointmentInstant − 2h`. The drip-queue then sends
 * it at the right minute (immediately, if the appointment is already <2h away).
 *
 * De-duplicated against existing `reminder_2h` logs, so it can safely overlap
 * with the daily scan and with its own previous runs.
 *
 * Authorization: `Authorization: Bearer <CRON_SECRET>`, `?secret=`, or
 * `x-cron-secret` header.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret =
    searchParams.get("secret") ||
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const todayISO = getBusinessNow().date;

  // Scan today's + tomorrow's appointments so an appointment booked late at
  // night for early tomorrow is still covered. (De-dup keeps this cheap.)
  const start = new Date(todayISO + "T00:00:00.000Z");
  const end   = new Date(addDaysISO(todayISO, 1) + "T23:59:59.999Z");

  const appts = await prisma.appointment.findMany({
    where: { status: "confirmed", date: { gte: start, lte: end } },
    include: { customer: true, staff: true, service: true, business: true },
  });

  let enqueued = 0;
  let skipped  = 0;

  for (const appt of appts) {
    if (!hasFeature(appt.business.features, "reminders"))    { skipped++; continue; }
    if (!hasFeature(appt.business.features, "reminder_2h")) { skipped++; continue; }

    const instant = appointmentInstant(appt.date, appt.startTime);
    // Only relevant while the appointment is still upcoming.
    if (instant.getTime() <= now.getTime()) { skipped++; continue; }

    const existing = await prisma.messageLog.findFirst({
      where: { appointmentId: appt.id, kind: "reminder_2h", status: { not: "failed" } },
      select: { id: true },
    });
    if (existing) { skipped++; continue; }

    const dateLabel = appt.date.toLocaleDateString("he-IL", {
      weekday: "long", day: "numeric", month: "long",
    });

    const template = appt.business.reminder2hTemplate || DEFAULT_2H_TEMPLATE;
    const body = applyTemplate(template, reminderVars({
      customerName: appt.customer.name,
      businessName: appt.business.name,
      staffName:    appt.staff.name,
      startTime:    appt.startTime,
      dateLabel,
      address:      appt.business.address,
    }));

    const scheduledFor = new Date(instant.getTime() - 2 * 60 * 60 * 1000);

    await enqueueMessage({
      businessId:    appt.businessId,
      appointmentId: appt.id,
      customerPhone: appt.customer.phone,
      kind:  "reminder_2h",
      body,
      scheduledFor,
    });
    enqueued++;
  }

  return NextResponse.json({ ok: true, enqueued, skipped });
}
