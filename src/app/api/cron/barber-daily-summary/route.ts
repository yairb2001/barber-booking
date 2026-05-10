/**
 * GET /api/cron/barber-daily-summary
 *
 * Runs at 19:00 Israel time every day (17:00 UTC in summer / 16:00 UTC in winter).
 * Sends each barber (who has a phone number) a WhatsApp with their appointment list for today.
 *
 * Authorization: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` header.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // "Today" in Israel time — the cron fires at ~06:00 IST so we use UTC date.
  // Date is stored in DB as UTC midnight of the appointment day.
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // local midnight
  const todayEnd   = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

  const businesses = await prisma.business.findMany({
    select: { id: true, name: true },
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const biz of businesses) {
    // Fetch all staff with phones for this business
    const staffList = await prisma.staff.findMany({
      where: { businessId: biz.id, phone: { not: null } },
      select: { id: true, name: true, phone: true },
    });

    for (const member of staffList) {
      if (!member.phone) { skipped++; continue; }

      // Fetch today's appointments for this barber
      const appts = await prisma.appointment.findMany({
        where: {
          businessId: biz.id,
          staffId: member.id,
          date: { gte: todayStart, lte: todayEnd },
          status: { in: ["pending", "confirmed"] },
        },
        include: { customer: true, service: true },
        orderBy: { startTime: "asc" },
      });

      if (appts.length === 0) {
        skipped++;
        continue; // No appointments today — don't spam with an empty message
      }

      // Build appointment list
      const lines = appts.map(a =>
        `🕒 ${a.startTime}–${a.endTime}  ${a.customer.name}  (${a.service.name})`
      ).join("\n");

      const dayLabel = todayStart.toLocaleDateString("he-IL", {
        weekday: "long", day: "numeric", month: "long",
      });

      const body =
        `📅 *יומן ל${dayLabel}*\n` +
        `${biz.name} ✂️\n\n` +
        `שלום ${member.name} 👋\n` +
        `הנה הלקוחות שלך היום:\n\n` +
        lines +
        `\n\n` +
        `סך הכל: ${appts.length} תורים\n` +
        `יום עבודה מוצלח! 💈`;

      try {
        const result = await sendMessage({
          businessId: biz.id,
          customerPhone: member.phone,
          kind: "barber_daily_summary",
          body,
        });
        if (result.ok) sent++;
        else errors.push(`${member.name}: ${result.error}`);
      } catch (e: unknown) {
        errors.push(`${member.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
