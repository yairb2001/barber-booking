import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SignJWT } from "jose";
import { resolveBusiness } from "@/lib/tenant";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-secret-change-in-production-please-set-AUTH_SECRET-env"
);
// OTP token is short-lived: valid for 30 minutes (enough to complete the booking)
const OTP_TOKEN_TTL = 60 * 30;

// POST /api/otp/verify
// Body: { phone: string, code: string, businessId?: string }
// Returns: { ok: true, token: string } — a short-lived JWT for booking
export async function POST(req: NextRequest) {
  const { phone, code, businessId: reqBusinessId } = await req.json();
  if (!phone || !code) {
    return NextResponse.json({ error: "phone and code required" }, { status: 400 });
  }

  const normalized = phone.replace(/\D/g, "").replace(/^0/, "972");

  const business = reqBusinessId
    ? await prisma.business.findUnique({ where: { id: reqBusinessId } })
    : await resolveBusiness(req);
  if (!business) return NextResponse.json({ error: "business not found" }, { status: 400 });

  // Find a valid, unused OTP
  const otp = await prisma.otpCode.findFirst({
    where: {
      businessId: business.id,
      phone: normalized,
      code,
      usedAt: null,
      expiresAt: { gte: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) {
    return NextResponse.json({ error: "קוד שגוי או שפג תוקפו" }, { status: 401 });
  }

  // Mark as used
  await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });

  // ── Canonical name lookup ─────────────────────────────────────────────────
  // The phone number is the customer's identity. If they already exist, we
  // ALWAYS return the name they first registered with — even if they type a
  // different name now. (Customer.phone may be stored as 0... or 972...)
  const phoneVariants = Array.from(new Set([
    phone,
    normalized,
    normalized.startsWith("972") ? "0" + normalized.slice(3) : normalized,
  ]));
  const existingCustomer = await prisma.customer.findFirst({
    where: { businessId: business.id, phone: { in: phoneVariants } },
    select: { name: true },
  });

  // Issue a short-lived JWT token that the booking flow will attach to the request
  const token = await new SignJWT({ phone: normalized, businessId: business.id, type: "otp" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OTP_TOKEN_TTL}s`)
    .sign(SECRET);

  // Issue a long-lived session cookie so the customer doesn't need to re-verify on future bookings
  const sessionToken = await new SignJWT({ phone: normalized, businessId: business.id, type: "customer_session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("40d")
    .sign(SECRET);

  const response = NextResponse.json({ ok: true, token, customerName: existingCustomer?.name || null });
  response.cookies.set("bk_session", sessionToken, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 24 * 40, // 40 days
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
