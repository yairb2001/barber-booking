/**
 * Re-engagement cron — runs daily (or weekly).
 * Finds customers whose last visit was exactly reengageWeeks weeks ago (±3 day window)
 * and sends them a "we miss you" WhatsApp message.
 *
 * Secure with CRON_SECRET: GET /api/cron/reengage?secret=<CRON_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage, applyTemplate } from "@/lib/messaging";

export const dynamic = "force-dynamic";

const DEFAULT_REENGAGE_TEMPLATE =
`שלום {{name}} 👋

מזמן לא ראינו אותך אצלנו ב*{{business}}*!
נשמח לראותך שוב — קבע תור עכשיו 💈

{{booking_link}}`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret =
    searchParams.get("secret") ||
    req.headers.get("x-cron-secret") ||
    "";

  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const business = await prisma.business.findFirst();
  if (!business) return NextResponse.json({ ok: true, sent: 0 });

  if (!business.reengageEnabled) {
    return NextResponse.json({ ok: true, sent: 0, reason: "disabled" });
  }

  const weeksThreshold = business.reengageWeeks;
  const template       = business.reengageTemplate || DEFAULT_REENGAGE_TEMPLATE;
  const bookingLink    = process.env.NEXT_PUBLIC_BASE_URL
    ? `${process.env.NEXT_PUBLIC_BASE_URL}/book`
    : "https://your-domain.vercel.app/book";

  const now        = new Date();
  const targetDate = new Date(now.getTime() - weeksThreshold * 7 * 24 * 60 * 60 * 1000);
  const windowStart = new Date(targetDate.getTime() - 3  * 24 * 60 * 60 * 1000);
  const windowEnd   = new Date(targetDate.getTime() + 3  * 24 * 60 * 60 * 1000);

  // Customers whose lastVisitAt falls inside the re-engagement window
  const candidates = await prisma.customer.findMany({
    where: {
      businessId: business.id,
      isBlocked:  false,
      lastVisitAt: { gte: windowStart, lte: windowEnd },
    },
    select: { id: true, name: true, phone: true },
  });

  // De-duplicate: skip customers who already got a re-engage message in last 2 weeks
  const recentCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  let sent = 0;
  let skipped = 0;

  for (const customer of candidates) {
    const recentMsg = await prisma.messageLog.findFirst({
      where: {
        businessId:    business.id,
        customerPhone: customer.phone,
        kind:          "broadcast",
        createdAt:     { gte: recentCutoff },
      },
      select: { id: true },
    });

    if (recentMsg) { skipped++; continue; }

    const msgBody = applyTemplate(template, {
      name:         customer.name,
      business:     business.name,
      booking_link: bookingLink,
    });

    try {
      await sendMessage({
        businessId:    business.id,
        customerPhone: customer.phone,
        kind:          "broadcast",
        body:          msgBody,
      });
      sent++;
    } catch (e) {
      console.error("[reengage] send failed", customer.phone, e);
      skipped++;
    }
  }

  return NextResponse.json({
    ok: true,
    checked: candidates.length,
    sent,
    skipped,
  });
}
