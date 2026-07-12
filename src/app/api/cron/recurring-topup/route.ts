import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateOccurrences, FOREVER_HORIZON_WEEKS } from "@/lib/recurring";

/**
 * Cron endpoint — keeps "forever" recurring rules (endDate == null) rolling forward.
 * For each active open-ended rule it materialises occurrences up to
 * FOREVER_HORIZON_WEEKS ahead of today. generateOccurrences is idempotent, so
 * already-created dates are skipped and only the new tail is added.
 *
 * Authorization: Vercel Cron adds `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rules = await prisma.recurringAppointment.findMany({
    where: { active: true, endDate: null },
    select: { id: true },
  });

  const todayUTC = new Date(new Date().toISOString().split("T")[0] + "T00:00:00.000Z");
  const windowEnd = new Date(todayUTC);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + FOREVER_HORIZON_WEEKS * 7);

  let created = 0;
  let skipped = 0;
  for (const r of rules) {
    const res = await generateOccurrences(r.id, todayUTC, windowEnd);
    created += res.created;
    skipped += res.skipped;
  }

  return NextResponse.json({ ok: true, rules: rules.length, created, skipped });
}
