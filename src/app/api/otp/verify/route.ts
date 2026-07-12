import { NextRequest, NextResponse } from "next/server";
import { authSecret } from "@/lib/jwt-secret";
import { prisma } from "@/lib/prisma";
import { SignJWT } from "jose";
import { resolveBusiness } from "@/lib/tenant";

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

  // ── Anti-brute-force ────────────────────────────────────────────────────────
  // The attempt cap MUST be enforced ATOMICALLY. A read-then-check-then-increment
  // is a TOCTOU race: on serverless, thousands of parallel verify requests all
  // read attempts=0, all pass the check, and the whole code space is guessable in
  // one burst. Instead we CLAIM an attempt with a conditional updateMany (the DB
  // serializes it per-row) BEFORE comparing the guess.
  const MAX_ATTEMPTS = 5;

  // The newest still-valid, unused code is the row we meter attempts on.
  const active = await prisma.otpCode.findFirst({
    where: { businessId: business.id, phone: normalized, usedAt: null, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!active) {
    return NextResponse.json({ error: "קוד שגוי או שפג תוקפו" }, { status: 401 });
  }

  // Atomically consume one attempt, but ONLY while under the cap. count===0 means
  // we're at/over the limit. Race-safe: at most MAX_ATTEMPTS requests ever win.
  const claim = await prisma.otpCode.updateMany({
    where: { id: active.id, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (claim.count === 0) {
    // Locked — burn every active code so the attacker can't keep trying.
    await prisma.otpCode.updateMany({
      where: { businessId: business.id, phone: normalized, usedAt: null },
      data: { usedAt: new Date() },
    });
    return NextResponse.json({ error: "יותר מדי ניסיונות — בקש קוד חדש" }, { status: 429 });
  }

  // Attempt counted — now check the guess against any still-valid code.
  const otp = await prisma.otpCode.findFirst({
    where: { businessId: business.id, phone: normalized, code, usedAt: null, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!otp) {
    return NextResponse.json({ error: "קוד שגוי או שפג תוקפו" }, { status: 401 });
  }

  // Correct — consume the code atomically (usedAt:null guard) so two concurrent
  // correct submissions can't both mint a token off the same single-use code.
  const consumed = await prisma.otpCode.updateMany({
    where: { id: otp.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 0) {
    return NextResponse.json({ error: "קוד שגוי או שפג תוקפו" }, { status: 401 });
  }

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
    .sign(authSecret());

  // Issue a long-lived session cookie so the customer doesn't need to re-verify on future bookings
  const sessionToken = await new SignJWT({ phone: normalized, businessId: business.id, type: "customer_session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("40d")
    .sign(authSecret());

  const response = NextResponse.json({ ok: true, token, customerName: existingCustomer?.name || null });
  response.cookies.set("bk_session", sessionToken, {
    httpOnly: true,
    // "lax" (not "strict") so the cookie is sent on top-level navigations from
    // external contexts — e.g. the customer opening the shop link from
    // WhatsApp's in-app browser. With "strict" that first load looked
    // cross-site, the session wasn't sent, and the booking flow forced a
    // redundant WhatsApp re-verification. "lax" still blocks cross-site POST.
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 40, // 40 days
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
