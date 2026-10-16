import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";

// Called ONLY by the middleware (edge, no Prisma) for a session that is an
// owner login tied to a staff member — a barber the owner gave "👑 גישה מלאה".
// It answers whether that staff member still has it, so turning the switch
// off takes effect right away instead of when his 30-day cookie expires.
// The caller proves itself with a 60-second token signed with AUTH_SECRET.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const key = req.headers.get("x-internal-key") || "";
  try {
    const { payload } = await jwtVerify(key, new TextEncoder().encode(process.env.AUTH_SECRET || ""));
    if (payload.type !== "staff_role_check" || typeof payload.staffId !== "string") throw new Error("bad");
    const s = await prisma.staff.findUnique({ where: { id: payload.staffId }, select: { role: true, isActive: true } });
    return NextResponse.json({ owner: !!s && s.role === "owner" && s.isActive !== false });
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
}
