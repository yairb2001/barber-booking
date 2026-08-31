/**
 * Re-engagement cron endpoint.
 * Hit this daily (e.g. via Vercel Cron or an external scheduler) to fire
 * re-engagement messages to inactive customers.
 *
 * Optionally protect with a CRON_SECRET header:
 *   Authorization: Bearer <CRON_SECRET>
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueMessage, firstName } from "@/lib/messaging";
import { getBusinessNow } from "@/lib/utils";

// Ban-safety: never blast every due customer at once (same reasoning as
// broadcast — see src/app/api/admin/messaging/broadcast/route.ts). Enqueue
// each reengage message with a staggered scheduledFor instead of sending it
// inline; the drip-queue cron (`/api/cron/drip-queue`) drains the queue at a
// safe pace (Yair, 2026-08-28: saw ~20 reengage messages fire in the same
// minute).
const REENGAGE_INTERVAL_SEC = 60; // ~1 message per minute

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Fail closed: require CRON_SECRET to be configured AND to match.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const automations = await prisma.automation.findMany({
    where: { type: "reengage", active: true },
    include: { business: true },
  });

  if (!automations.length) return NextResponse.json({ sent: 0 });

  const now = new Date();
  const results: { businessId: string; customerId: string; phone: string }[] = [];

  for (const auto of automations) {
    let settings: Record<string, unknown>;
    try { settings = JSON.parse(auto.settings || "{}"); } catch { settings = {}; }

    const inactiveWeeks         = (settings.inactiveWeeks         as number)  ?? 6;
    // Second and final nudge, sent once if the customer still hasn't come back.
    // No nudge ever goes out after this one (Yair, 2026-08-28: was re-sending
    // every `inactiveWeeks` indefinitely — see the per-customer count below).
    const finalNudgeWeeks       = (settings.finalNudgeWeeks       as number)  ?? inactiveWeeks * 2;
    const excludeWithFutureAppt = (settings.excludeWithFutureAppt as boolean) ?? true;
    const segment               = (settings.segment               as string)  ?? "all";

    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - inactiveWeeks * 7);

    const finalCutoffDate = new Date(now);
    finalCutoffDate.setDate(finalCutoffDate.getDate() - finalNudgeWeeks * 7);

    // Fence off the pre-existing backlog: only customers who *cross* the
    // inactivity threshold after this automation was (last) activated should
    // ever get a message. Without activatedAt we can't establish that floor
    // safely, so skip rather than risk blasting everyone who already qualifies.
    if (!auto.activatedAt) continue;
    const activationFloor = new Date(auto.activatedAt);
    activationFloor.setDate(activationFloor.getDate() - inactiveWeeks * 7);

    // customer.lastVisitAt is stamped at BOOKING time (see customer-agent.ts /
    // admin+public booking routes), not at the actual visit date — the "mark
    // completed" flow that used to bump it to appointment.date was removed
    // from the UI, so it never fires anymore. For a shop that books ~3 weeks
    // ahead, that means lastVisitAt reflects when the appointment was BOOKED,
    // which can be weeks earlier than when the customer actually came in —
    // making them look more inactive than they are. Sync it forward (never
    // backward) to the latest non-cancelled appointment that has already
    // happened, right before computing who's actually inactive (Yair,
    // 2026-08-31: customers who visited ~a week ago still got "we miss you").
    const todayStart = new Date(`${getBusinessNow().date}T00:00:00.000Z`);
    await prisma.$executeRaw`
      UPDATE customers c
      SET last_visit_at = sub.max_date
      FROM (
        SELECT customer_id, MAX(date) AS max_date
        FROM appointments
        WHERE business_id = ${auto.businessId} AND status IN ('confirmed', 'completed') AND date < ${todayStart}
        GROUP BY customer_id
      ) sub
      WHERE c.id = sub.customer_id
        AND c.business_id = ${auto.businessId}
        AND (c.last_visit_at IS NULL OR c.last_visit_at < sub.max_date)
    `;

    // Customers who haven't visited since cutoff, but were still "active"
    // (i.e. hadn't crossed the threshold yet) when the automation turned on.
    let customers = await prisma.customer.findMany({
      where: {
        businessId: auto.businessId,
        isBlocked: false,
        deletedAt: null,
        phone: { not: "" },
        lastVisitAt: { lte: cutoffDate, gte: activationFloor, not: null },
      },
      include: {
        _count: {
          select: {
            appointments: {
              where: { status: "completed", businessId: auto.businessId },
            },
          },
        },
      },
    });

    // Segment filter
    if (segment === "new_only")
      customers = customers.filter(c => c._count.appointments === 1);
    else if (segment === "regular_only")
      customers = customers.filter(c => c._count.appointments >= 2);

    // Exclude customers who already have a future appointment
    if (excludeWithFutureAppt) {
      const futureAppts = await prisma.appointment.findMany({
        where: {
          businessId: auto.businessId,
          date: { gt: now },
          status: { in: ["pending", "confirmed"] },
        },
        select: { customerId: true },
        distinct: ["customerId"],
      });
      const futureIds = new Set(futureAppts.map(a => a.customerId));
      customers = customers.filter(c => !futureIds.has(c.id));
    }

    // Dedup + cap: at most 2 nudges per inactivity stretch (one at
    // `inactiveWeeks`, one final one at `finalNudgeWeeks`), then never again
    // until the customer actually comes back (which bumps lastVisitAt and
    // restarts the count at 0). The previous version only checked "did they
    // get one within the last `inactiveWeeks`?", which re-fired forever every
    // `inactiveWeeks` for as long as the customer stayed away (Yair,
    // 2026-08-28: saw repeat sends to the same people).
    const priorSends = await prisma.messageLog.findMany({
      where: {
        businessId: auto.businessId,
        kind: "reengage",
        status: { not: "failed" },
        customerPhone: { in: customers.map(c => c.phone) },
      },
      select: { customerPhone: true, createdAt: true },
    });
    const sendCountSinceVisit = new Map<string, number>();
    for (const customer of customers) {
      const count = priorSends.filter(
        l => l.customerPhone === customer.phone && customer.lastVisitAt && l.createdAt > customer.lastVisitAt,
      ).length;
      sendCountSinceVisit.set(customer.id, count);
    }
    customers = customers.filter(c => {
      const count = sendCountSinceVisit.get(c.id) ?? 0;
      if (count === 0) return true; // first nudge — already past `inactiveWeeks` via the query above
      if (count === 1) return c.lastVisitAt! <= finalCutoffDate; // final nudge only once truly at `finalNudgeWeeks`
      return false; // already got both nudges this stretch
    });

    const template = auto.template ||
      `שלום {{name}} 👋\n\nהתגעגענו אליך ב*{{business}}* ✂️\nבוא נקבע תור ונשמח לראות אותך שוב 😊\n\nלקביעת תור: {{booking_url}}`;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
    const bookingUrl = `${baseUrl}${auto.business.slug ? `/${auto.business.slug}` : ""}/book`;

    customers.forEach((customer, i) => {
      const body = template
        .replace(/\{\{name\}\}/g,        firstName(customer.name))
        .replace(/\{\{business\}\}/g,    auto.business.name)
        .replace(/\{\{booking_url\}\}/g, bookingUrl);

      // Ban-safety: enqueue with a staggered scheduledFor instead of sending
      // inline. The drip-queue cron drains this at a safe pace and (see
      // deliverMessageLog) mirrors it into the conversation thread once it
      // actually goes out, so a later reply still has context.
      const scheduledFor = new Date(now.getTime() + i * REENGAGE_INTERVAL_SEC * 1000);
      enqueueMessage({
        businessId: auto.businessId,
        customerPhone: customer.phone,
        kind: "reengage",
        body,
        scheduledFor,
      }).catch(err => console.error("[reengage] failed to enqueue", err));

      results.push({
        businessId: auto.businessId,
        customerId: customer.id,
        phone: customer.phone,
      });
    });
  }

  return NextResponse.json({ sent: results.length, results });
}

// Allow POST as well (e.g. Vercel Cron uses POST)
export { GET as POST };
