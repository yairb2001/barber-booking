import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  sendMessage,
  hasFeature,
  applyTemplate,
  DEFAULT_24H_TEMPLATE,
  reminderVars,
} from "@/lib/messaging";

/**
 * Cron endpoint — runs daily at 07:00 UTC (= 10:00 Israel).
 * Sends 24h reminders for all confirmed appointments happening TOMORROW.
 *
 * Authorization: Vercel Cron adds `Authorization: Bearer <CRON_SECRET>` header.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Window: tomorrow 00:00 → 23:59
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const start = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0);
  const end   = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59);

  const appts = await prisma.appointment.findMany({
    where: {
      status: "confirmed",
      date: { gte: start, lte: end },
    },
    include: { customer: true, staff: true, service: true, business: true },
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const appt of appts) {
    // Skip if already sent
    const existing = await prisma.messageLog.findFirst({
      where: {
        appointmentId: appt.id,
        kind: "reminder_24h",
        status: { in: ["sent", "delivered", "read"] },
      },
    });
    if (existing) { skipped++; continue; }

    if (!hasFeature(appt.business.features, "reminders")) { skipped++; continue; }
    if (!hasFeature(appt.business.features, "reminder_24h")) { skipped++; continue; }

    const dateLabel = appt.date.toLocaleDateString("he-IL", {
      weekday: "long", day: "numeric", month: "long",
    });

    // Use custom template if set, otherwise fall back to default
    const template = appt.business.reminder24hTemplate || DEFAULT_24H_TEMPLATE;
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
      kind:  "reminder_24h",
      body,
    });

    if (result.ok) sent++;
    else errors.push(`${appt.id}: ${result.error}`);
  }

  return NextResponse.json({
    ok: true,
    checked: appts.length,
    sent,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
