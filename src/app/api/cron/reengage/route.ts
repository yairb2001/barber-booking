/**
 * Re-engagement cron — runs daily (or weekly).
 * Finds customers whose last visit was exactly reengageWeeks weeks ago (±3 day window)
 * and sends them a "we miss you" WhatsApp message.
 *
 * Secure with CRON_SECRET: GET /api/cron/reengage?secret=<CRON_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage, applyTemplate, firstName, formatBusinessName } from "@/lib/messaging";

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

  // MULTI-TENANT: process EVERY business with re-engagement enabled, each fully
  // scoped to its own customers/messages. Never operate on a single arbitrary
  // business (that would mix tenants).
  const businesses = await prisma.business.findMany({
    where: { reengageEnabled: true },
  });
  if (businesses.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: "disabled" });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://your-domain.vercel.app";
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  let totalSent = 0;
  let totalSkipped = 0;
  let totalChecked = 0;

  for (const business of businesses) {
    const weeksThreshold = business.reengageWeeks;
    const template       = business.reengageTemplate || DEFAULT_REENGAGE_TEMPLATE;
    // Each tenant has its own storefront under /<slug>; link straight to it.
    const bookingLink    = `${baseUrl}/${business.slug}/book`;

    const targetDate = new Date(now.getTime() - weeksThreshold * 7 * 24 * 60 * 60 * 1000);
    const windowStart = new Date(targetDate.getTime() - 3 * 24 * 60 * 60 * 1000);
    const windowEnd   = new Date(targetDate.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Customers whose lastVisitAt falls inside this business's re-engagement window
    const candidates = await prisma.customer.findMany({
      where: {
        businessId: business.id,
        isBlocked:  false,
        deletedAt:  null,
        lastVisitAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, name: true, phone: true },
    });
    totalChecked += candidates.length;

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

      if (recentMsg) { totalSkipped++; continue; }

      const msgBody = applyTemplate(template, {
        name:         firstName(customer.name),
        business:     formatBusinessName(business.name),
        booking_link: bookingLink,
      });

      try {
        await sendMessage({
          businessId:    business.id,
          customerPhone: customer.phone,
          kind:          "broadcast",
          body:          msgBody,
        });
        totalSent++;
      } catch (e) {
        console.error("[reengage] send failed", customer.phone, e);
        totalSkipped++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    businesses: businesses.length,
    checked: totalChecked,
    sent: totalSent,
    skipped: totalSkipped,
  });
}
