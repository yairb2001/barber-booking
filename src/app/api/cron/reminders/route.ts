import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  enqueueMessage,
  hasFeature,
  applyTemplate,
  DEFAULT_24H_TEMPLATE,
  DEFAULT_24H_NEW_TEMPLATE,
  DEFAULT_24H_RETURNING_TEMPLATE,
  DEFAULT_2H_TEMPLATE,
  reminderVars,
} from "@/lib/messaging";
import { getBusinessNow, addDaysISO, appointmentInstant } from "@/lib/utils";

export const dynamic = "force-dynamic";

const CANCELLED_STATUSES = ["cancelled_by_customer", "cancelled_by_staff"];

/**
 * Daily reminder-scan cron. Runs early in the morning (before any shop opens).
 *
 * Instead of BLASTING every reminder at once (which risks a WhatsApp ban), this
 * only ENQUEUES each reminder into MessageLog with a precise `scheduledFor`
 * timestamp. The drip-queue cron (`/api/cron/drip-queue`, hit every minute by an
 * external scheduler) then sends each one at its exact target time, at most
 * ~1 message/minute per business — so every customer gets their reminder exactly
 * 24h (and 2h) before their appointment, staggered and ban-safe.
 *
 *   • 24h reminders → for TOMORROW's confirmed appointments
 *   • 2h  reminders → for TODAY's confirmed appointments (advance bookings).
 *     Same-day bookings made after this scan are caught by the optional
 *     `/api/cron/reminders-2h` sweep if it's wired to the external scheduler.
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

  // Use the Israel calendar day (appointments are stored at UTC-midnight of the
  // Israel day, so we must derive "today"/"tomorrow" in the business timezone).
  const todayISO    = getBusinessNow().date;
  const tomorrowISO = addDaysISO(todayISO, 1);

  const dayRange = (iso: string) => ({
    start: new Date(iso + "T00:00:00.000Z"),
    end:   new Date(iso + "T23:59:59.999Z"),
  });

  let enqueued24 = 0;
  let enqueued2  = 0;
  let skipped    = 0;

  // ── 24h reminders: tomorrow's appointments ─────────────────────────────────
  {
    const { start, end } = dayRange(tomorrowISO);
    const appts = await prisma.appointment.findMany({
      where: { status: "confirmed", date: { gte: start, lte: end } },
      include: { customer: true, staff: true, service: true, business: true },
    });

    for (const appt of appts) {
      if (!hasFeature(appt.business.features, "reminders"))     { skipped++; continue; }
      if (!hasFeature(appt.business.features, "reminder_24h")) { skipped++; continue; }

      // De-dup: skip if a 24h reminder already exists for this appointment
      // (any non-failed status — scheduled / sending / sent / delivered / read).
      const existing = await prisma.messageLog.findFirst({
        where: { appointmentId: appt.id, kind: "reminder_24h", status: { not: "failed" } },
        select: { id: true },
      });
      if (existing) { skipped++; continue; }

      const dateLabel = appt.date.toLocaleDateString("he-IL", {
        weekday: "long", day: "numeric", month: "long",
      });

      // Template by prior-visit count: 0 → new, 1 → returning, 2+ → regular.
      const priorVisits = await prisma.appointment.count({
        where: {
          customerId: appt.customerId,
          businessId: appt.businessId,
          id:     { not: appt.id },
          date:   { lt: appt.date },
          status: { notIn: CANCELLED_STATUSES },
        },
      });

      let template: string;
      if (priorVisits === 0)      template = appt.business.reminder24hNewTemplate || DEFAULT_24H_NEW_TEMPLATE;
      else if (priorVisits === 1) template = appt.business.reminder24hReturningTemplate || DEFAULT_24H_RETURNING_TEMPLATE;
      else                        template = appt.business.reminder24hTemplate || DEFAULT_24H_TEMPLATE;

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
      const body = applyTemplate(template, reminderVars({
        customerName: appt.customer.name,
        businessName: appt.business.name,
        staffName:    appt.staff.name,
        startTime:    appt.startTime,
        dateLabel,
        address:      appt.business.address,
        cancelLink:   `${baseUrl}/book/my-appointments`,
      }));

      // Fire exactly 24h before the appointment instant.
      const scheduledFor = new Date(appointmentInstant(appt.date, appt.startTime).getTime() - 24 * 60 * 60 * 1000);

      await enqueueMessage({
        businessId:    appt.businessId,
        appointmentId: appt.id,
        customerPhone: appt.customer.phone,
        kind:  "reminder_24h",
        body,
        scheduledFor,
      });
      enqueued24++;
    }
  }

  // ── 2h reminders: today's appointments (advance bookings) ──────────────────
  {
    const { start, end } = dayRange(todayISO);
    const appts = await prisma.appointment.findMany({
      where: { status: "confirmed", date: { gte: start, lte: end } },
      include: { customer: true, staff: true, service: true, business: true },
    });

    for (const appt of appts) {
      if (!hasFeature(appt.business.features, "reminders"))    { skipped++; continue; }
      if (!hasFeature(appt.business.features, "reminder_2h")) { skipped++; continue; }

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

      // Fire exactly 2h before the appointment instant.
      const scheduledFor = new Date(appointmentInstant(appt.date, appt.startTime).getTime() - 2 * 60 * 60 * 1000);

      await enqueueMessage({
        businessId:    appt.businessId,
        appointmentId: appt.id,
        customerPhone: appt.customer.phone,
        kind:  "reminder_2h",
        body,
        scheduledFor,
      });
      enqueued2++;
    }
  }

  return NextResponse.json({
    ok: true,
    enqueued24h: enqueued24,
    enqueued2h:  enqueued2,
    skipped,
  });
}
