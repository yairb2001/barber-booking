import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { bookSpot, cancelSpot, cancelSession } from "@/lib/classes";
import { notifyClass } from "@/lib/class-messages";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

/**
 * The owner on one session: add someone (existing customer or by phone), take
 * someone out (the first in line moves up and is told), mark who came, or
 * cancel the session (everyone in it is told).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const s = await prisma.classSession.findFirst({ where: { id: params.id, businessId: session.businessId }, select: { id: true } });
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  if (body.action === "add") {
    let customerId: string | null = typeof body.customerId === "string" ? body.customerId : null;
    if (customerId && !(await prisma.customer.findFirst({ where: { id: customerId, businessId: session.businessId }, select: { id: true } }))) customerId = null;
    if (!customerId) {
      const phone = normalizeIsraeliPhone(String(body.phone ?? ""));
      const name = String(body.name ?? "").trim();
      if (!phone || !name) return NextResponse.json({ error: "צריך שם וטלפון" }, { status: 400 });
      const c = await prisma.customer.findFirst({ where: { businessId: session.businessId, OR: [{ phone }, { phone: phone.replace(/^972/, "0") }] }, select: { id: true } })
        ?? await prisma.customer.create({ data: { businessId: session.businessId, phone, name }, select: { id: true } });
      customerId = c.id;
    }
    const r = await bookSpot(s.id, customerId);
    if (!r.ok) return NextResponse.json({ error: r.reason === "already" ? "כבר רשום לשיעור הזה" : r.reason === "past" ? "השיעור כבר התחיל" : "השיעור לא פעיל" }, { status: 409 });
    if (body.notify !== false) await notifyClass(r.status === "booked" ? "class_booked" : "class_waitlist", { sessionId: s.id, customerId, position: r.position });
    return NextResponse.json(r);
  }
  if (body.action === "remove" && typeof body.bookingId === "string") {
    const own = await prisma.classBooking.findFirst({ where: { id: body.bookingId, sessionId: s.id }, select: { id: true } });
    if (!own) return NextResponse.json({ error: "not found" }, { status: 404 });
    const r = await cancelSpot(own.id);
    if (r.promoted) await notifyClass("class_promoted", { sessionId: s.id, customerId: r.promoted.customerId });
    return NextResponse.json(r);
  }
  if (body.action === "mark" && typeof body.bookingId === "string" && ["attended", "no_show", "booked"].includes(body.status)) {
    await prisma.classBooking.updateMany({ where: { id: body.bookingId, sessionId: s.id }, data: { status: body.status } });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "cancel") {
    const { customerIds } = await cancelSession(s.id);
    for (const c of customerIds) await notifyClass("class_cancelled", { sessionId: s.id, customerId: c });
    return NextResponse.json({ ok: true, notified: customerIds.length });
  }
  return NextResponse.json({ error: "bad action" }, { status: 400 });
}
