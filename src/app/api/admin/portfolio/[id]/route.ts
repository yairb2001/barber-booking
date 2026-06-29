import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // PortfolioItem has no businessId — scope via the owning staff's business.
  const item = await prisma.portfolioItem.findUnique({
    where: { id: params.id },
    select: { staffId: true, staff: { select: { businessId: true } } },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Tenant isolation: the item's staff must belong to the caller's business.
  if (item.staff.businessId !== session.businessId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Barbers can only delete their own items
  if (!session.isOwner && item.staffId !== session.staffId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.portfolioItem.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
