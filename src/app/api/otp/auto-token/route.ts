/**
 * POST /api/otp/auto-token
 *
 * Exchanges a long-lived `bk_session` cookie (set after first OTP verification)
 * for a fresh short-lived OTP token — so returning customers can skip the SMS
 * step entirely.
 *
 * Returns:
 *   { ok: true, token: string, phone: string }   — phone is in display format (05...)
 *   { error: string }  with status 401           — session missing or expired
 *
 * Also renews the session cookie (sliding 40-day window).
 */

import { NextRequest, NextResponse } from "next/server";
import { authSecret } from "@/lib/jwt-secret";
import { jwtVerify, SignJWT } from "jose";
import { prisma } from "@/lib/prisma";


const OTP_TOKEN_TTL = 60 * 30; // 30 minutes — same as regular OTP

export async function POST(req: NextRequest) {
  const sessionCookie = req.cookies.get("bk_session")?.value;
  if (!sessionCookie) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }

  let phone: string;
  let businessId: string;

  try {
    const { payload } = await jwtVerify(sessionCookie, authSecret());
    if (payload.type !== "customer_session") {
      return NextResponse.json({ error: "invalid session type" }, { status: 401 });
    }
    phone      = payload.phone      as string;
    businessId = payload.businessId as string;
  } catch {
    return NextResponse.json({ error: "session expired or invalid" }, { status: 401 });
  }

  // Issue a fresh short-lived OTP token (same format as /api/otp/verify)
  const token = await new SignJWT({ phone, businessId, type: "otp" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OTP_TOKEN_TTL}s`)
    .sign(authSecret());

  // Renew the session cookie (sliding window)
  const newSession = await new SignJWT({ phone, businessId, type: "customer_session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("40d")
    .sign(authSecret());

  // Convert stored phone (972...) → display format (05...)
  const displayPhone = phone.startsWith("972") ? "0" + phone.slice(3) : phone;

  // Canonical name: phone is the identity → always return the originally
  // registered name (Customer.phone may be stored as 0... or 972...)
  const phoneVariants = Array.from(new Set([phone, displayPhone]));
  const existingCustomer = await prisma.customer.findFirst({
    where: { businessId, phone: { in: phoneVariants } },
    select: { name: true, referralSource: true },
  });

  const response = NextResponse.json({
    ok: true,
    token,
    phone: displayPhone,
    name: existingCustomer?.name || null,
    // If we already know how this customer found us, the booking form can
    // skip the "how did you hear about us?" question entirely.
    referralSource: existingCustomer?.referralSource || null,
  });
  response.cookies.set("bk_session", newSession, {
    httpOnly: true,
    // "lax" so returning customers stay signed in across top-level navigations
    // (e.g. reopening the shop from WhatsApp). Must match the value set in
    // /api/otp/verify — see the note there.
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 40, // 40 days
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
