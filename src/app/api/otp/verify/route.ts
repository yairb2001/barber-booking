import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SignJWT } from "jose";

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
    : await prisma.business.findFirst();
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

  // Issue a short-lived JWT token that the booking flow will attach to the request
  const token = await new SignJWT({ phone: normalized, businessId: business.id, type: "otp" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OTP_TOKEN_TTL}s`)
    .sign(SECRET);

  return NextResponse.json({ ok: true, token });
}
