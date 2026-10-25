import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSuperAdmin, SUPER_ADMIN_BUSINESS_ID } from "@/lib/super-admin";
import { signSession, verifySession, COOKIE_NAME, COOKIE_OPTIONS } from "@/lib/auth";

const ORIGIN_COOKIE = "super_origin";
/** Stashed for a CRM "admin" member with no session of her own: the way back is the CRM. */
const FROM_CRM = "crm";

/**
 * POST /api/admin/super/impersonate  { businessId }
 * Log in AS a tenant to see exactly what its owner sees (support/debug). The
 * platform owner's real session token is stashed in an httpOnly `super_origin`
 * cookie so it can be restored via DELETE. A CRM "admin" member (Nika,
 * 25.10.2026) may too, from the customer card; she goes back to the CRM.
 */
export async function POST(req: NextRequest) {
  if (!isSuperAdmin(req) && !(await (await import("@/lib/crm/members")).crmAdminMemberOf(req))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { businessId } = await req.json().catch(() => ({}));
  if (typeof businessId !== "string") return NextResponse.json({ error: "businessId required" }, { status: 400 });

  const target = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  const origin = req.cookies.get(COOKIE_NAME)?.value;
  const token = await signSession({ businessId: target.id, role: "owner" });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ORIGIN_COOKIE, origin || FROM_CRM, { ...COOKIE_OPTIONS });
  res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
  return res;
}

/**
 * DELETE /api/admin/super/impersonate — stop impersonating, restore the platform
 * owner's session. Authorised by the stashed super_origin cookie (the CURRENT
 * session is the impersonated tenant, so we can't use isSuperAdmin here).
 */
export async function DELETE(req: NextRequest) {
  const origin = req.cookies.get(ORIGIN_COOKIE)?.value;
  // A CRM member: drop the tenant session, back to the CRM (her own cookie still holds).
  if (origin === FROM_CRM) {
    const res = NextResponse.json({ ok: true, to: "/admin/crm" });
    res.cookies.set(COOKIE_NAME, "", { ...COOKIE_OPTIONS, maxAge: 0 });
    res.cookies.set(ORIGIN_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
    return res;
  }
  // Restore the stashed session: the platform owner's, or the member's own shop session.
  const originSession = await verifySession(origin);
  if (!originSession) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true, to: originSession.businessId === SUPER_ADMIN_BUSINESS_ID ? "/admin/super" : "/admin/crm" });
  res.cookies.set(COOKIE_NAME, origin!, COOKIE_OPTIONS);
  res.cookies.set(ORIGIN_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
