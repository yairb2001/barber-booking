import { NextResponse } from "next/server";
import { authSecret } from "@/lib/jwt-secret";
import { prisma } from "@/lib/prisma";
import { jwtVerify } from "jose";
import { pushToOwner } from "@/lib/native/push";
import { resolveBusiness } from "@/lib/tenant";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";


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

  // Find or create customer — normalize to E.164 (972...) so we never create a
  // second record for a number the client sent as "0..." (or vice versa). Look
  // up BOTH formats to catch any legacy record.
  const normPhone = normalizeIsraeliPhone(phone) || String(phone || "").replace(/\D/g, "");
  const localPhone = normPhone.startsWith("972") ? "0" + normPhone.slice(3) : normPhone;
  let customer = await prisma.customer.findFirst({
    where: { businessId: biz.id, phone: { in: [normPhone, localPhone] } },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { businessId: biz.id, phone: normPhone, name: name || normPhone },
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

/**
 * DELETE /api/waitlist?id=...&phone=...&token=...
 *
 * Customer-initiated removal from the waitlist. Requires the OTP JWT (type
 * "otp", same one used by /api/my-appointments) and verifies the entry belongs
 * to the customer whose phone matches the token before deleting it.
 */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const phone = searchParams.get("phone");
  const token = searchParams.get("token");

  if (!id || !phone || !token) {
    return NextResponse.json({ error: "id, phone and token required" }, { status: 400 });
  }

  // Normalize phone to E.164 (same as OTP flow)
  const normalized = phone.replace(/\D/g, "").replace(/^0/, "972");

  // Verify OTP token
  let tokenPayload: { phone?: unknown; type?: unknown } = {};
  try {
    const { payload } = await jwtVerify(token, authSecret());
    tokenPayload = payload as typeof tokenPayload;
  } catch {
    return NextResponse.json({ error: "פג תוקף הסשן — יש להתחבר מחדש" }, { status: 401 });
  }
  if (tokenPayload.type !== "otp" || tokenPayload.phone !== normalized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Ownership check — the entry's customer phone must match the verified phone
  const entry = await prisma.waitlist.findUnique({
    where: { id },
    select: { id: true, customer: { select: { phone: true } } },
  });
  if (!entry) return NextResponse.json({ ok: true, alreadyGone: true });

  const custNorm = (entry.customer?.phone ?? "").replace(/\D/g, "").replace(/^0/, "972");
  if (custNorm !== normalized) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  await prisma.waitlist.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
