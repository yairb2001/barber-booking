import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let staff: { id: string; name: string; role: string } | null = null;
  if (session.staffId) {
    const s = await prisma.staff.findUnique({
      where: { id: session.staffId },
      select: { id: true, name: true, role: true },
    });
    if (s) staff = s;
  }

  return NextResponse.json({
    businessId: session.businessId,
    role: session.role,
    isOwner: session.isOwner,
    staffId: session.staffId || null,
    staff,
  });
}
