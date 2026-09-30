import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionBusiness, requireOwner } from "@/lib/session";
import { hashPassword } from "@/lib/auth";

/**
 * POST /api/admin/auth/set-password — an owner who came in through the
 * onboarding link (no password yet) sets one so he can log in later with
 * phone + password. Also fine for changing an existing password.
 */
export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await getSessionBusiness(req, { id: true });
  if (!biz) return NextResponse.json({ error: "No business" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 6) return NextResponse.json({ error: "סיסמה חייבת להיות לפחות 6 תווים" }, { status: 400 });
  await prisma.business.update({ where: { id: biz.id }, data: { passwordHash: await hashPassword(password) } });
  return NextResponse.json({ ok: true });
}
