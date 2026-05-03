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

  // Business-level feature flags (chats toggle is needed by the layout to
  // decide whether to show the "שיחות" nav item)
  const business = await prisma.business.findFirst({
    where: { id: session.businessId },
    select: { chatsEnabled: true },
  });

  return NextResponse.json({
    businessId: session.businessId,
    role: session.role,
    isOwner: session.isOwner,
    staffId: session.staffId || null,
    staff,
    chatsEnabled: business?.chatsEnabled ?? false,
  });
}
