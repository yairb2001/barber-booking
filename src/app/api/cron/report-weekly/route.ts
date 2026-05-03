import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { buildWeeklyReportManager, buildWeeklyReportStaff } from "@/lib/messaging/reports";

/**
 * Cron endpoint — runs Sunday morning (06:00 UTC = 09:00 IST summer / 08:00 winter).
 *
 * For each business:
 *   1. Send weekly summary to manager (Business.phone)
 *   2. Send personal weekly summary to each Staff with phone != null
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
    select: {
      id: true, name: true, phone: true,
      staff: {
        where: { phone: { not: null }, isAvailable: true },
        select: { id: true, name: true, phone: true },
      },
    },
  });

  let sentManager = 0;
  let sentStaff = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const biz of businesses) {
    // Manager
    if (biz.phone) {
      try {
        const body = await buildWeeklyReportManager(biz.id);
        const result = await sendMessage({
          businessId: biz.id,
          customerPhone: biz.phone,
          kind: "report_weekly",
          body,
        });
        if (result.ok) sentManager++;
        else errors.push(`${biz.name} (manager): ${result.error}`);
      } catch (e: unknown) {
        errors.push(`${biz.name} (manager): ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      skipped++;
    }

    // Each staff member
    for (const st of biz.staff) {
      if (!st.phone) { skipped++; continue; }
      // Skip duplicate to manager phone (e.g. owner is also a staff member)
      if (biz.phone && st.phone === biz.phone) { skipped++; continue; }
      try {
        const body = await buildWeeklyReportStaff(biz.id, st.id);
        const result = await sendMessage({
          businessId: biz.id,
          customerPhone: st.phone,
          kind: "report_weekly",
          body,
        });
        if (result.ok) sentStaff++;
        else errors.push(`${biz.name} / ${st.name}: ${result.error}`);
      } catch (e: unknown) {
        errors.push(`${biz.name} / ${st.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    businesses: businesses.length,
    sentManager,
    sentStaff,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
  });
}
