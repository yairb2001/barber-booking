/**
 * Rolling reminder sweep — enqueues any MISSING 24h / 2h reminder for
 * appointments in the next ~26 hours. Runs piggybacked on the drip-queue tick
 * (every ~10 min), on top of the nightly /api/cron/reminders scan.
 *
 * Why: the nightly scan (01:00) only looks at "tomorrow". A booking made at
 * 10:00 for tomorrow 18:00 is 32h away — missed by last night's scan and, by
 * the next one, already "today". Those appointments got no 24h reminder (and,
 * with confirmations on, no "reply 1" ask). The sweep closes that gap.
 *
 * De-dup is by (appointmentId, kind) on MessageLog, same as the nightly scan,
 * so the two can overlap freely. A 24h reminder is only enqueued when its
 * send time is at least 3h after the booking was made — otherwise the booking
 * confirmation the customer just received is reminder enough.
 */
import { prisma } from "@/lib/prisma";
import {
  enqueueMessage, hasFeature, applyTemplate, reminderVars,
  DEFAULT_24H_TEMPLATE, DEFAULT_24H_NEW_TEMPLATE, DEFAULT_24H_RETURNING_TEMPLATE, DEFAULT_2H_TEMPLATE,
} from "@/lib/messaging";
import { appointmentInstant } from "@/lib/utils";
import { confirmationsEnabled, withConfirmAsk } from "@/lib/confirmations";
import { customerManageLink } from "@/lib/customer-link";

const CANCELLED = ["cancelled_by_customer", "cancelled_by_staff", "no_show"];
const H = 3_600_000;

export async function sweepReminders(now = new Date()): Promise<{ enqueued24: number; enqueued2: number }> {
  // Appointments whose calendar day is today or tomorrow (UTC-midnight rows).
  const dayStart = new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const dayEnd = new Date(dayStart.getTime() + 2 * 86_400_000 - 1);

  const appts = await prisma.appointment.findMany({
    where: { status: "confirmed", date: { gte: dayStart, lte: dayEnd } },
    include: { customer: true, staff: true, service: true, business: true },
  });
  if (!appts.length) return { enqueued24: 0, enqueued2: 0 };

  const logs = await prisma.messageLog.findMany({
    where: { appointmentId: { in: appts.map(a => a.id) }, kind: { in: ["reminder_24h", "reminder_2h"] }, status: { not: "failed" } },
    select: { appointmentId: true, kind: true },
  });
  const has = new Set(logs.map(l => `${l.appointmentId}:${l.kind}`));

  let enqueued24 = 0, enqueued2 = 0;
  for (const appt of appts) {
    if (!appt.customer.phone) continue;
    if (!hasFeature(appt.business.features, "reminders")) continue;
    const start = appointmentInstant(appt.date, appt.startTime).getTime();
    if (start <= now.getTime()) continue;
    const askConfirm = confirmationsEnabled(appt.business.settings) && !appt.confirmedAt;
    const dateLabel = appt.date.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
    const vars = reminderVars({
      customerName: appt.customer.name, businessName: appt.business.name, staffName: appt.staff.name,
      startTime: appt.startTime, dateLabel, address: appt.business.address, cancelLink: await customerManageLink(appt.businessId, appt.customer.phone, appt.business.slug),
    });

    // 24h
    if (hasFeature(appt.business.features, "reminder_24h") && !has.has(`${appt.id}:reminder_24h`)) {
      const sendAt = start - 24 * H;
      const bookedAt = appt.createdAt.getTime();
      if (sendAt > now.getTime() - 15 * 60_000 && sendAt >= bookedAt + 3 * H) {
        const priorVisits = await prisma.appointment.count({
          where: { customerId: appt.customerId, businessId: appt.businessId, id: { not: appt.id }, date: { lt: appt.date }, status: { notIn: CANCELLED } },
        });
        const template = priorVisits === 0 ? (appt.business.reminder24hNewTemplate || DEFAULT_24H_NEW_TEMPLATE)
          : priorVisits === 1 ? (appt.business.reminder24hReturningTemplate || DEFAULT_24H_RETURNING_TEMPLATE)
          : (appt.business.reminder24hTemplate || DEFAULT_24H_TEMPLATE);
        let body = applyTemplate(template, vars);
        if (askConfirm) body = withConfirmAsk(body);
        await enqueueMessage({ businessId: appt.businessId, appointmentId: appt.id, customerPhone: appt.customer.phone, kind: "reminder_24h", body, scheduledFor: new Date(Math.max(sendAt, now.getTime())) });
        has.add(`${appt.id}:reminder_24h`);
        enqueued24++;
      }
    }

    // 2h
    if (hasFeature(appt.business.features, "reminder_2h") && !has.has(`${appt.id}:reminder_2h`)) {
      const sendAt = start - 2 * H;
      const bookedAt = appt.createdAt.getTime();
      // Skip when the booking itself is less than 2.5h old at send time — the
      // confirmation just went out.
      if (sendAt > now.getTime() - 15 * 60_000 && sendAt >= bookedAt + 30 * 60_000) {
        const body = applyTemplate(appt.business.reminder2hTemplate || DEFAULT_2H_TEMPLATE, vars);
        await enqueueMessage({ businessId: appt.businessId, appointmentId: appt.id, customerPhone: appt.customer.phone, kind: "reminder_2h", body, scheduledFor: new Date(Math.max(sendAt, now.getTime())) });
        has.add(`${appt.id}:reminder_2h`);
        enqueued2++;
      }
    }
  }
  return { enqueued24, enqueued2 };
}
