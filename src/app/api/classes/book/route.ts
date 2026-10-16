import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { authSecret } from "@/lib/jwt-secret";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { bookSpot } from "@/lib/classes";
import { notifyClass } from "@/lib/class-messages";

/**
 * Public: take a spot in a group class (16.10.2026), verified by the WhatsApp
 * code like a booking. Full → a place in line. A shop that hasn't pressed
 * "הפעל" answers as a test and saves nothing; a blocked customer gets the same
 * "no longer available" as anyone who missed the last spot.
 */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "class-book", { max: 12, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  const { sessionId, customerName, customerPhone, otpToken } = body as Record<string, string>;
  if (!sessionId || !customerPhone) return NextResponse.json({ error: "חסרים פרטים" }, { status: 400 });
  const phone = normalizeIsraeliPhone(customerPhone) || customerPhone;
  const s = await prisma.classSession.findUnique({ where: { id: sessionId }, select: { businessId: true, business: { select: { activatedAt: true } } } });
  if (!s) return NextResponse.json({ error: "השיעור לא נמצא" }, { status: 404 });
  if (!s.business.activatedAt) return NextResponse.json({ test: true, status: "booked" });

  try {
    const { payload } = await jwtVerify(String(otpToken ?? ""), authSecret());
    if (payload.type !== "otp" || payload.phone !== phone || payload.businessId !== s.businessId) throw new Error("mismatch");
  } catch {
    return NextResponse.json({ error: "קוד אימות לא תקף — בקשו קוד חדש" }, { status: 401 });
  }

  let customer = await prisma.customer.findFirst({ where: { businessId: s.businessId, OR: [{ phone }, { phone: phone.replace(/^972/, "0") }] }, select: { id: true, isBlocked: true, deletedAt: true } });
  if (customer?.isBlocked && !customer.deletedAt) return NextResponse.json({ error: "השיעור הזה כבר לא זמין" }, { status: 409 });
  // A known customer (signed in by the saved session) may come without a name; a new one may not.
  if (!customer && !customerName?.trim()) return NextResponse.json({ error: "חסר שם" }, { status: 400 });
  if (!customer) customer = await prisma.customer.create({ data: { businessId: s.businessId, phone, name: customerName!.trim(), referralSource: "classes" }, select: { id: true, isBlocked: true, deletedAt: true } });
  else if (customer.deletedAt) customer = await prisma.customer.update({ where: { id: customer.id }, data: { deletedAt: null, ...(customerName?.trim() ? { name: customerName.trim() } : {}) }, select: { id: true, isBlocked: true, deletedAt: true } });

  const r = await bookSpot(sessionId, customer.id);
  if (!r.ok) {
    const error = r.reason === "already" ? (r.status === "waitlist" ? "כבר ברשימת ההמתנה לשיעור הזה" : "כבר רשומים לשיעור הזה") : r.reason === "past" ? "השיעור כבר התחיל" : "השיעור הזה כבר לא זמין";
    return NextResponse.json({ error }, { status: 409 });
  }
  await notifyClass(r.status === "booked" ? "class_booked" : "class_waitlist", { sessionId, customerId: customer.id, position: r.position });
  return NextResponse.json({ status: r.status, position: r.position ?? null });
}
