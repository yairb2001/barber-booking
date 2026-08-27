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
import { sendMessage, firstName } from "@/lib/messaging";

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
    const excludeWithFutureAppt = (settings.excludeWithFutureAppt as boolean) ?? true;
    const segment               = (settings.segment               as string)  ?? "all";

    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - inactiveWeeks * 7);

    // Fence off the pre-existing backlog: only customers who *cross* the
    // inactivity threshold after this automation was (last) activated should
    // ever get a message. Without activatedAt we can't establish that floor
    // safely, so skip rather than risk blasting everyone who already qualifies.
    if (!auto.activatedAt) continue;
    const activationFloor = new Date(auto.activatedAt);
    activationFloor.setDate(activationFloor.getDate() - inactiveWeeks * 7);

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

    // Dedup: skip phones that already got a reengage message in this same window
    const recentLogs = await prisma.messageLog.findMany({
      where: {
        businessId: auto.businessId,
        kind: "reengage",
        createdAt: { gte: cutoffDate },
        status: { not: "failed" },
      },
      select: { customerPhone: true },
    });
    const recentPhones = new Set(recentLogs.map(l => l.customerPhone));
    customers = customers.filter(c => !recentPhones.has(c.phone));

    const template = auto.template ||
      `שלום {{name}} 👋\n\nהתגעגענו אליך ב*{{business}}* ✂️\nבוא נקבע תור ונשמח לראות אותך שוב 😊\n\nלקביעת תור: {{booking_url}}`;

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://barber-booking-indol.vercel.app";
    const bookingUrl = `${baseUrl}${auto.business.slug ? `/${auto.business.slug}` : ""}/book`;

    for (const customer of customers) {
      const body = template
        .replace(/\{\{name\}\}/g,        firstName(customer.name))
        .replace(/\{\{business\}\}/g,    auto.business.name)
        .replace(/\{\{booking_url\}\}/g, bookingUrl);

      sendMessage({
        businessId: auto.businessId,
        customerPhone: customer.phone,
        kind: "reengage",
        body,
      }).catch(console.error);

      // Also log it into the customer's actual chat thread — sendMessage only
      // delivers over WhatsApp and logs to MessageLog, it never touches
      // ConversationMessage. Without this, the booking agent has no idea a
      // re-engagement nudge went out, so a reply like "כן, אשמח" or "מה יש
      // פנוי?" a few minutes later looks like it came out of nowhere instead
      // of being an answer to this message (Yair, 2026-08-14).
      (async () => {
        let conversation = await prisma.conversation.findFirst({
          where: { businessId: auto.businessId, phone: customer.phone, agentType: { not: "owner" } },
          orderBy: { createdAt: "desc" },
        });
        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: { businessId: auto.businessId, phone: customer.phone, agentType: "customer", status: "active" },
          });
        }
        await prisma.conversationMessage.create({
          data: { conversationId: conversation.id, role: "assistant", content: body },
        });
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });
      })().catch(err => console.error("[reengage] failed to log to conversation history", err));

      results.push({
        businessId: auto.businessId,
        customerId: customer.id,
        phone: customer.phone,
      });
    }
  }

  return NextResponse.json({ sent: results.length, results });
}

// Allow POST as well (e.g. Vercel Cron uses POST)
export { GET as POST };
