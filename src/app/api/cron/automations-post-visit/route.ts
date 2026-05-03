/**
 * GET /api/cron/automations-post-visit
 *
 * Daily/regular cron — fires post-visit automations (post_first_visit,
 * post_every_visit) for appointments whose endTime + delayMinutes has passed.
 *
 * Replaces the old immediate-on-completed trigger:
 * - Honors `settings.delayMinutes` (no longer fires instantly)
 * - Doesn't depend on the admin clicking "completed" — appointments are
 *   considered "done" once their endTime is in the past (and they aren't cancelled)
 *
 * Logic per appointment:
 * 1. Find appointments where (now - apptEnd) >= delayMinutes AND apptEnd was
 *    in the last 7 days (don't retroactively spam old data when an automation
 *    is just turned on).
 * 2. Skip cancelled appointments (cancelled_by_customer / cancelled_by_staff).
 * 3. Skip if a MessageLog with (appointmentId, kind) already exists.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";

export const dynamic = "force-dynamic";

function combineDateTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  // Date is stored UTC midnight; add Israeli time (UTC+2/+3)
  // Simpler: rebuild from local representation. The DB stores `date` as
  // UTC midnight of the day; we treat the time as local.
  const d = new Date(date);
  d.setUTCHours(h - 3, m, 0, 0); // approximate Israel offset; fine for delay logic
  return d;
}

export async function GET() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Pull all active post-visit automations (across all businesses)
  const automations = await prisma.automation.findMany({
    where: {
      type: { in: ["post_first_visit", "post_every_visit"] },
      active: true,
    },
  });

  if (automations.length === 0) {
    return NextResponse.json({ ok: true, fired: 0, skipped: 0, reason: "no automations" });
  }

  let fired = 0;
  let skipped = 0;

  for (const auto of automations) {
    let settings: Record<string, unknown>;
    try { settings = JSON.parse(auto.settings || "{}"); } catch { settings = {}; }
    const delayMinutes = Math.max(0, Number(settings.delayMinutes ?? (auto.type === "post_first_visit" ? 30 : 60)));

    // Time-window: appointments whose end+delay has passed in the last 7 days
    const cutoffEnd = new Date(now.getTime() - delayMinutes * 60 * 1000);

    const candidates = await prisma.appointment.findMany({
      where: {
        businessId: auto.businessId,
        status: { in: ["confirmed", "completed"] },
        date: { gte: sevenDaysAgo, lte: now },
      },
      include: { customer: true, staff: true, service: true },
      take: 500,
    });

    const business = await prisma.business.findUnique({ where: { id: auto.businessId } });
    if (!business) continue;

    for (const appt of candidates) {
      // Compute end timestamp from date + endTime
      const apptEnd = combineDateTime(appt.date, appt.endTime);
      if (apptEnd > cutoffEnd) { skipped++; continue; } // delay not yet passed
      if (apptEnd < sevenDaysAgo) { skipped++; continue; } // too old

      // Dedup: already sent for this appointment + kind
      const already = await prisma.messageLog.findFirst({
        where: {
          businessId: auto.businessId,
          appointmentId: appt.id,
          kind: auto.type,
          status: { not: "failed" },
        },
      });
      if (already) { skipped++; continue; }

      // Count completed appointments for the customer (treat past confirmed/completed as done)
      const completedCount = await prisma.appointment.count({
        where: {
          customerId: appt.customerId,
          businessId: auto.businessId,
          status: { in: ["confirmed", "completed"] },
          OR: [
            { date: { lt: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
            { AND: [
              { date: { equals: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
            ]},
          ],
        },
      });

      // ── post_first_visit ─────────────────────────────────────────────────────
      if (auto.type === "post_first_visit") {
        if (completedCount !== 1) { skipped++; continue; }

        const ctaType = (settings.ctaType as string) ?? "google_review";
        const ctaUrl  = (settings.ctaUrl  as string) ?? "";
        let ctaLine = "";
        if (ctaType === "google_review" && ctaUrl) ctaLine = `\n\n⭐ נשמח לביקורת קצרה בגוגל — זה עוזר לנו המון:\n${ctaUrl}`;
        else if (ctaType === "instagram"  && ctaUrl) ctaLine = `\n\n📸 עקוב אחרינו באינסטגרם:\n${ctaUrl}`;
        else if (ctaType === "custom"     && ctaUrl) ctaLine = `\n\n${ctaUrl}`;

        const template = (auto.template as string | null) ||
          `שלום {{name}} 👋\n\nתודה שביקרת אצלנו ב*{{business}}* לראשונה ✂️\nנהנינו מאוד לטפל בך 😊{{cta}}\n\nנתראה בפעם הבאה!`;

        const body = template
          .replace(/\{\{name\}\}/g, appt.customer.name)
          .replace(/\{\{business\}\}/g, business.name)
          .replace(/\{\{staff\}\}/g, appt.staff?.name ?? "")
          .replace(/\{\{service\}\}/g, appt.service?.name ?? "")
          .replace(/\{\{cta\}\}/g, ctaLine);

        await sendMessage({
          businessId: auto.businessId,
          appointmentId: appt.id,
          customerPhone: appt.customer.phone,
          kind: "post_first_visit",
          body,
        });
        fired++;
      }

      // ── post_every_visit ─────────────────────────────────────────────────────
      if (auto.type === "post_every_visit") {
        const segment   = (settings.segment   as string) ?? "regular_only";
        const minVisits = (settings.minVisits as number) ?? 2;

        if (segment === "regular_only" && completedCount < minVisits) { skipped++; continue; }
        if (segment === "new_only"     && completedCount !== 1)        { skipped++; continue; }

        const template = (auto.template as string | null) ||
          `שלום {{name}} 👋\n\nתודה שביקרת ב*{{business}}* ✂️\nנתראה בפעם הבאה! 😊`;

        const body = template
          .replace(/\{\{name\}\}/g, appt.customer.name)
          .replace(/\{\{business\}\}/g, business.name)
          .replace(/\{\{staff\}\}/g, appt.staff?.name ?? "")
          .replace(/\{\{service\}\}/g, appt.service?.name ?? "");

        await sendMessage({
          businessId: auto.businessId,
          appointmentId: appt.id,
          customerPhone: appt.customer.phone,
          kind: "post_every_visit",
          body,
        });
        fired++;
      }
    }
  }

  return NextResponse.json({ ok: true, fired, skipped });
}
