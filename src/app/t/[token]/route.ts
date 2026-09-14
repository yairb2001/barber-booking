import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SignJWT } from "jose";
import { authSecret } from "@/lib/jwt-secret";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

export const dynamic = "force-dynamic";

/**
 * GET /t/<token> — short personal link from confirmations/reminders.
 * Signs the customer in (bk_session cookie, same as after an OTP) and sends
 * them to "my appointments". Unknown token → plain "my appointments" page,
 * which offers the phone+code login.
 */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const token = (params.token || "").trim();
  const base = new URL(req.url).origin;
  const customer = /^[1-9A-HJ-NP-Za-km-z]{8,16}$/.test(token)
    ? await prisma.customer.findUnique({ where: { linkToken: token }, select: { phone: true, businessId: true, deletedAt: true, business: { select: { slug: true } } } })
    : null;
  const path = (slug?: string | null) => `${base}${slug ? `/${slug}` : ""}/book/my-appointments`;
  if (!customer || customer.deletedAt) return NextResponse.redirect(path(), 302);

  const session = await new SignJWT({ phone: normalizeIsraeliPhone(customer.phone), businessId: customer.businessId, type: "customer_session" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("180d").sign(authSecret());
  const res = NextResponse.redirect(path(customer.business?.slug), 302);
  res.cookies.set("bk_session", session, {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 180,
  });
  return res;
}
