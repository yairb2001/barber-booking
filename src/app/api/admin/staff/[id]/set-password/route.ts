import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { requireOwnStaffOrOwner } from "@/lib/session";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwnStaffOrOwner(req, params.id);
  if (guard) return guard;
  const { password } = await req.json();
  if (!password || typeof password !== "string" || password.length < 4) {
    return NextResponse.json({ error: "סיסמה חייבת להיות לפחות 4 תווים" }, { status: 400 });
  }
  const hash = await hashPassword(password);
  await prisma.staff.update({
    where: { id: params.id },
    data: { passwordHash: hash },
  });
  return NextResponse.json({ ok: true });
}
