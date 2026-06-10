import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushToOwner } from "@/lib/native/push";
import { resolveBusiness } from "@/lib/tenant";

/**
 * Public endpoint — customers join the waitlist.
 * No auth required (public-facing).
 *
 * POST body:
 *   phone, name, staffId, serviceId, date (YYYY-MM-DD),
 *   isFlexible (bool), preferredTimeOfDay ("morning" | "afternoon" | "evening" | "any")
 */
export async function POST(request: Request) {
  const body = await request.json();
  const { phone, name, staffId, serviceId, date, isFlexible, preferredTimeOfDay, businessId } = body;

  if (!phone || !serviceId || !date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Resolve business: explicit body businessId, else ?slug=/?businessId= from
  // the URL (backward-compat: no param → findFirst for DOMINANT).
  const biz = businessId
    ? await prisma.business.findUnique({ where: { id: businessId } })
    : await resolveBusiness(request);
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });

  // Find or create customer
  let customer = await prisma.customer.findUnique({
    where: { businessId_phone: { businessId: biz.id, phone } },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { businessId: biz.id, phone, name: name || phone },
    });
  }

  const dateObj = new Date(date + "T00:00:00.000Z");

  // Avoid duplicate waitlist entries for the same person/staff/service/date
  const existing = await prisma.waitlist.findFirst({
    where: {
      businessId: biz.id,
      customerId: customer.id,
      staffId: staffId || null,
      serviceId,
      date: dateObj,
      status: { in: ["waiting", "notified"] },
    },
  });
  if (existing) {
    return NextResponse.json(existing, { status: 200 });
  }

  const entry = await prisma.waitlist.create({
    data: {
      businessId: biz.id,
      customerId: customer.id,
      staffId: staffId || null,
      serviceId,
      date: dateObj,
      isFlexible: isFlexible ?? true,
      preferredTimeOfDay: preferredTimeOfDay || "any",
      status: "waiting",
    },
    include: { customer: true, service: true },
  });

  // NOTE: We intentionally do NOT send a WhatsApp confirmation on registration.
  // Waitlist members are only messaged when a slot actually frees up
  // (see src/lib/waitlist-notify.ts — cancellations, day re-open, break removed,
  //  hours added, and customer self-cancel via the WhatsApp agent).

  // Notify the business owner/manager (native app) — someone joined the waitlist.
  {
    const dateLabel = dateObj.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem" });
    pushToOwner(biz.id, {
      title: "הצטרפות לרשימת המתנה ⏳",
      body: `${entry.customer.name} — ${entry.service.name}\n${dateLabel}`,
      data: { type: "waitlist", waitlistId: entry.id },
    }).catch(() => {});
  }

  return NextResponse.json(entry, { status: 201 });
}
