import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getEffectivePermissions } from "@/lib/session";

// Live slot holds for the admin calendar (🔒 blocks): the alternatives the
// closure wizard offered a displaced customer, locked until they expire.
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from"), to = searchParams.get("to");
  if (!from || !to) return NextResponse.json([]);

  const where: Record<string, unknown> = {
    businessId: session.businessId,
    date: { gte: new Date(from + "T00:00:00.000Z"), lte: new Date(to + "T00:00:00.000Z") },
    expiresAt: { gt: new Date() },
  };
  const perms = await getEffectivePermissions(req);
  if (!perms.isOwner && !perms.canViewAllCalendars && perms.staffId) where.staffId = perms.staffId;

  const holds = await prisma.slotHold.findMany({
    where, orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { id: true, staffId: true, date: true, startTime: true, endTime: true, expiresAt: true, customerId: true },
  });
  const ids = Array.from(new Set(holds.map(h => h.customerId).filter((x): x is string => !!x)));
  const names = new Map((ids.length ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map(c => [c.id, c.name]));
  return NextResponse.json(holds.map(h => ({
    id: h.id, staffId: h.staffId, date: h.date.toISOString().slice(0, 10),
    startTime: h.startTime, endTime: h.endTime, expiresAt: h.expiresAt.toISOString(),
    customerName: (h.customerId && names.get(h.customerId)) || null,
  })));
}
