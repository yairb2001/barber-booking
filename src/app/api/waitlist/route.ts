import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMessage, hasFeature } from "@/lib/messaging";

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
  const { phone, name, staffId, serviceId, date, isFlexible, preferredTimeOfDay } = body;

  if (!phone || !serviceId || !date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const business = await prisma.business.findFirst({
    include: { staff: { where: staffId ? { id: staffId } : { id: "" }, select: { name: true } } },
  });
  if (!business) return NextResponse.json({ error: "No business" }, { status: 400 });

  // Fetch staff name separately (business include above is for messaging only)
  const biz = await prisma.business.findFirst();
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });

  const staffRecord = staffId
    ? await prisma.staff.findUnique({ where: { id: staffId }, select: { name: true } })
    : null;

  const serviceRecord = await prisma.service.findUnique({
    where: { id: serviceId }, select: { name: true },
  });

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

  // ── Send WhatsApp confirmation (fire-and-forget) ───────────────────────────
  if (hasFeature(biz.features, "reminders")) {
    const dateLabel = dateObj.toLocaleDateString("he-IL", {
      weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jerusalem",
    });
    const timeLabel = preferredTimeOfDay === "morning"   ? "בוקר (09:00–12:00)"
                    : preferredTimeOfDay === "afternoon" ? "צהריים (12:00–17:00)"
                    : preferredTimeOfDay === "evening"   ? "ערב (17:00–20:00)"
                    : "כל שעה";
    const staffLine = staffRecord ? `\n💈 אצל ${staffRecord.name}` : "";
    const msgBody = [
      `שלום ${customer.name} 👋`,
      ``,
      `נרשמת לרשימת ההמתנה ב*${biz.name}* ✂️`,
      `📅 ${dateLabel}`,
      `🕒 שעה מועדפת: ${timeLabel}${staffLine}`,
      ``,
      `ברגע שיתפנה תור — נשלח לך הודעה מיידית! 🔔`,
    ].join("\n");

    sendMessage({
      businessId: biz.id,
      customerPhone: customer.phone,
      kind: "manual",
      body: msgBody,
    }).catch(err => console.error("waitlist confirmation send failed", err));
  }

  return NextResponse.json(entry, { status: 201 });
}
