import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage, reminder24hText, hasFeature } from "@/lib/messaging";

/**
 * Cron endpoint — run hourly. Sends 24h reminders for appointments happening
 * roughly 24 hours from now (±1 hour window).
 *
 * Authorization: Vercel Cron adds `Authorization: Bearer <CRON_SECRET>` header.
 * Locally you can call it directly.
 */
export async function GET(req: NextRequest) {
  // Optional: verify Vercel Cron secret
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Target window: appointments happening 23-25 hours from now
  const targetMin = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const targetMax = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  // Find all appointments in the window that don't have a reminder_24h sent yet
  const appts = await prisma.appointment.findMany({
    where: {
      status: "confirmed",
      date: {
        gte: new Date(targetMin.getFullYear(), targetMin.getMonth(), targetMin.getDate()),
        lte: new Date(targetMax.getFullYear(), targetMax.getMonth(), targetMax.getDate(), 23, 59, 59),
      },
    },
    include: { customer: true, staff: true, service: true, business: true },
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const appt of appts) {
    // Combine date + startTime to get actual moment
    const [h, m] = appt.startTime.split(":").map(Number);
    const apptMoment = new Date(appt.date);
    apptMoment.setHours(h, m, 0, 0);

    // Only send if actual time is in 23-25h window
    const diffMs = apptMoment.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours < 23 || diffHours > 25) { skipped++; continue; }

    // Skip if already sent
    const existing = await prisma.messageLog.findFirst({
      where: { appointmentId: appt.id, kind: "reminder_24h", status: { in: ["sent", "delivered", "read"] } },
    });
    if (existing) { skipped++; continue; }

    if (!hasFeature(appt.business.features, "reminders")) { skipped++; continue; }

    const dateLabel = apptMoment.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
    const body = reminder24hText({
      customerName: appt.customer.name,
      businessName: appt.business.name,
      staffName: appt.staff.name,
      startTime: appt.startTime,
      dateLabel,
      address: appt.business.address,
    });

    const result = await sendMessage({
      businessId: appt.businessId,
      appointmentId: appt.id,
      customerPhone: appt.customer.phone,
      kind: "reminder_24h",
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
