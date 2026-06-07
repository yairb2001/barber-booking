import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Barbers can only delete their own items
  if (!session.isOwner) {
    const item = await prisma.portfolioItem.findUnique({
      where: { id: params.id },
      select: { staffId: true },
    });
    if (!item || item.staffId !== session.staffId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  await prisma.portfolioItem.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
