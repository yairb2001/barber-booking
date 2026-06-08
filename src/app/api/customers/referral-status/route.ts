/**
 * GET /api/customers/referral-status
 *
 * Public endpoint — identifies the customer from their `bk_session` cookie
 * (set after the first OTP verification) and returns their referral progress:
 * how many friends they've brought, the goal, and the gift they earn.
 *
 * Used by the customer-facing site (booking landing + confirm) to greet a
 * returning referrer with a thank-you and a progress meter ("הבאת 1 מתוך 3").
 *
 * No session / unknown customer / program disabled → { ok: false }.
 */

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { getReferralConfig } from "@/lib/referral";

export const dynamic = "force-dynamic";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-secret-change-in-production-please-set-AUTH_SECRET-env"
);

export async function GET(req: NextRequest) {
  const sessionCookie = req.cookies.get("bk_session")?.value;
  if (!sessionCookie) return NextResponse.json({ ok: false });

  let phone: string;
  let businessId: string;
  try {
    const { payload } = await jwtVerify(sessionCookie, SECRET);
    if (payload.type !== "customer_session") return NextResponse.json({ ok: false });
    phone = payload.phone as string;
    businessId = payload.businessId as string;
  } catch {
    return NextResponse.json({ ok: false });
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { settings: true },
  });
  const config = getReferralConfig(business?.settings ?? null);

  // Program turned off by the owner → don't surface anything.
  if (!config.enabled) return NextResponse.json({ ok: false, enabled: false });

  // Resolve the customer (phone may be stored as 0... or 972...)
  const displayPhone = phone.startsWith("972") ? "0" + phone.slice(3) : phone;
  const phoneVariants = Array.from(new Set([phone, displayPhone]));
  const customer = await prisma.customer.findFirst({
    where: { businessId, phone: { in: phoneVariants } },
    select: { id: true, name: true },
  });
  if (!customer) return NextResponse.json({ ok: false, enabled: true });

  // How many friends has this customer brought in?
  const referralCount = await prisma.customer.count({
    where: { businessId, referredById: customer.id },
  });

  return NextResponse.json({
    ok: true,
    enabled: true,
    name: customer.name,
    referralCount,
    goal: config.goal,
    giftLabel: config.giftLabel,
  });
}
