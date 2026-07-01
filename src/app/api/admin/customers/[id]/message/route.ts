import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { sendProactiveMessage } from "@/lib/messaging";

// POST /api/admin/customers/[id]/message
// Body: { message: string }
//
// Sends a one-off WhatsApp message to a single customer through the system
// (kind "manual"). Tenant-scoped: the customer must belong to the caller's
// business; barbers may only message customers they've personally served.
export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const { id } = ctx.params;

  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { businessId: true, phone: true, name: true, isBlocked: true, deletedAt: true },
  });
  if (!customer) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Tenant isolation: never message a customer from another business.
  if (customer.businessId !== session.businessId) {
    return NextResponse.json({ error: "אין הרשאה ללקוח זה" }, { status: 403 });
  }

  // Staff scoping: barbers can only message customers they've served.
  if (!session.isOwner && session.staffId) {
    const hasAppt = await prisma.appointment.count({
      where: { customerId: id, staffId: session.staffId },
    });
    if (hasAppt === 0) {
      return NextResponse.json({ error: "אין הרשאה ללקוח זה" }, { status: 403 });
    }
  }

  const { message } = await req.json().catch(() => ({}));
  if (!message || !String(message).trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (!customer.phone) {
    return NextResponse.json({ error: "ללקוח אין מספר טלפון" }, { status: 400 });
  }

  const result = await sendProactiveMessage({
    businessId: customer.businessId,
    customerPhone: customer.phone,
    kind: "manual",
    body: String(message).trim(),
    customerName: customer.name,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error || "שליחה נכשלה" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
