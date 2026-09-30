import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyOnboardingToken, signSession, COOKIE_NAME, COOKIE_OPTIONS } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/onboarding-link?t=<token>
 *
 * The personal link a new owner receives on WhatsApp after Yair closes the
 * lead (src/lib/leads.ts). Verifies the one-purpose token (7 days), signs him
 * in as the owner of HIS business and sends him into the setup wizard. Public
 * (outside /api/admin) — the token is the credential.
 */
export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") ?? "";
  const businessId = await verifyOnboardingToken(t);
  if (!businessId) {
    return new NextResponse(
      `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:32px;text-align:center;color:#0B3A3C"><h2>הקישור פג או לא תקין</h2><p>כתוב ליאיר בוואטסאפ ונשלח לך קישור חדש.</p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  const biz = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, suspendedAt: true } });
  if (!biz || biz.suspendedAt) return NextResponse.json({ error: "business unavailable" }, { status: 404 });

  const session = await signSession({ businessId: biz.id, role: "owner" });
  const res = NextResponse.redirect(new URL("/admin/onboarding", req.url));
  res.cookies.set(COOKIE_NAME, session, COOKIE_OPTIONS);
  return res;
}
