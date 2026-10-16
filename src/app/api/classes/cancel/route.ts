import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { authSecret } from "@/lib/jwt-secret";
import { prisma } from "@/lib/prisma";
import { cancelSpot, canCancelUntil } from "@/lib/classes";
import { notifyClass } from "@/lib/class-messages";

/**
 * POST /api/classes/cancel — the customer gives up her spot in a class (16.10.2026).
 * Body: { bookingId, phone, token } — token is the OTP JWT from /api/otp/verify.
 * Respects the class's cancel window; a freed spot goes to the first in line, who is told.
 */
export async function POST(req: NextRequest) {
  const { bookingId, phone, token } = (await req.json().catch(() => ({}))) as { bookingId?: string; phone?: string; token?: string };
  if (!bookingId || !phone || !token) return NextResponse.json({ error: "bookingId, phone and token required" }, { status: 400 });
  const normalized = phone.replace(/\D/g, "").replace(/^0/, "972");
  try {
    const { payload } = await jwtVerify(token, authSecret());
    if (payload.type !== "otp" || payload.phone !== normalized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "פג תוקף הסשן — יש להתחבר מחדש" }, { status: 401 });
  }
  const b = await prisma.classBooking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true, sessionId: true, customer: { select: { phone: true } }, session: { select: { date: true, startTime: true, classType: { select: { cancelHours: true } } } } },
  });
  if (!b) return NextResponse.json({ error: "ההרשמה לא נמצאה" }, { status: 404 });
  if ((b.customer.phone ?? "").replace(/\D/g, "").replace(/^0/, "972") !== normalized) return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  if (b.status !== "booked" && b.status !== "waitlist") return NextResponse.json({ ok: true, alreadyCancelled: true });
  const hours = b.session.classType.cancelHours;
  // Leaving the waitlist is always allowed; a taken spot only until the cancel window.
  if (b.status === "booked" && !canCancelUntil(b.session.date.toISOString().slice(0, 10), b.session.startTime, hours)) {
    return NextResponse.json({ error: `אפשר לבטל עד ${hours} שעות לפני השיעור. לביטול מאוחר יותר צריך לפנות לעסק.` }, { status: 409 });
  }
  const r = await cancelSpot(b.id);
  if (r.promoted) await notifyClass("class_promoted", { sessionId: b.sessionId, customerId: r.promoted.customerId });
  return NextResponse.json({ ok: true });
}
