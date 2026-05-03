import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { buildDailyReport } from "@/lib/messaging/reports";

/**
 * Cron endpoint — runs at 19:00 UTC Sun-Fri (= 22:00 IST in summer / 21:00 IST in winter).
 * Sends a daily summary to each business's manager (Business.phone).
 *
 * Authorization: Vercel Cron adds `Authorization: Bearer <CRON_SECRET>` header.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const businesses = await prisma.business.findMany({
    where: { phone: { not: null } },
    select: { id: true, name: true, phone: true },
  });

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const biz of businesses) {
    if (!biz.phone) { skipped++; continue; }
    try {
      const body = await buildDailyReport(biz.id);
      const result = await sendMessage({
        businessId: biz.id,
        customerPhone: biz.phone,
        kind: "report_daily",
        body,
      });
      if (result.ok) sent++;
      else errors.push(`${biz.name}: ${result.error}`);
    } catch (e: unknown) {
      errors.push(`${biz.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    businesses: businesses.length,
    sent,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
