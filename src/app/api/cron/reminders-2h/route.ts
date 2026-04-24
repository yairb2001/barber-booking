import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  sendMessage,
  hasFeature,
  applyTemplate,
  DEFAULT_2H_TEMPLATE,
  reminderVars,
} from "@/lib/messaging";

/**
 * Cron endpoint — should run every hour.
 * Sends a "2 hours before" reminder for appointments whose startTime falls in
 * the window [now + 1h50m, now + 2h10m], giving a ±10 min tolerance so every
 * appointment is covered exactly once per hourly run.
 *
 * Scheduling:
 *   Vercel Pro:  add `{ "path": "/api/cron/reminders-2h", "schedule": "0 * * * *" }` to vercel.json
 *   Vercel Hobby / external: point any hourly HTTP scheduler to this URL with
 *     `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Authorization: `Authorization: Bearer <CRON_SECRET>` header.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Window: appointments starting between now+1h50m and now+2h10m
  const windowStart = new Date(now.getTime() + (110) * 60 * 1000); // +1h50m
  const windowEnd   = new Date(now.getTime() + (130) * 60 * 1000); // +2h10m

  // Convert to HH:MM strings for comparison with stored startTime
  function toHHMM(d: Date): string {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const startTimeMin = toHHMM(windowStart);
  const startTimeMax = toHHMM(windowEnd);

  // Determine which date(s) the window covers
  // If the window doesn't cross midnight we only need today; if it does, also tomorrow
  const dates: Date[] = [];
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  dates.push(todayMidnight);
  if (windowStart.getDate() !== windowEnd.getDate()) {
    dates.push(new Date(windowEnd.getFullYear(), windowEnd.getMonth(), windowEnd.getDate()));
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const dateBase of dates) {
    const dayStart = new Date(dateBase.getFullYear(), dateBase.getMonth(), dateBase.getDate(), 0, 0, 0);
    const dayEnd   = new Date(dateBase.getFullYear(), dateBase.getMonth(), dateBase.getDate(), 23, 59, 59);

    const appts = await prisma.appointment.findMany({
      where: {
        status: "confirmed",
        date: { gte: dayStart, lte: dayEnd },
        startTime: { gte: startTimeMin, lte: startTimeMax },
      },
      include: { customer: true, staff: true, service: true, business: true },
    });

    for (const appt of appts) {
      // Skip if already sent a 2h reminder for this appointment
      const existing = await prisma.messageLog.findFirst({
        where: {
          appointmentId: appt.id,
          kind: "reminder_2h",
          status: { in: ["sent", "delivered", "read"] },
        },
      });
      if (existing) { skipped++; continue; }

      if (!hasFeature(appt.business.features, "reminders")) { skipped++; continue; }
      if (!hasFeature(appt.business.features, "reminder_2h")) { skipped++; continue; }

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

      const result = await sendMessage({
        businessId:    appt.businessId,
        appointmentId: appt.id,
        customerPhone: appt.customer.phone,
        kind:  "reminder_2h",
        body,
      });

      if (result.ok) sent++;
      else errors.push(`${appt.id}: ${result.error}`);
    }
  }

  return NextResponse.json({
    ok: true,
    window: { from: startTimeMin, to: startTimeMax },
    sent,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
