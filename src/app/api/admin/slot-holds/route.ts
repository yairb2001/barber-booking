import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getEffectivePermissions } from "@/lib/session";
import { TAKEN } from "@/lib/classes";

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
    select: { id: true, staffId: true, date: true, startTime: true, endTime: true, expiresAt: true, customerId: true, holderKey: true },
  });
  const ids = Array.from(new Set(holds.map(h => h.customerId).filter((x): x is string => !!x)));
  const names = new Map((ids.length ? await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map(c => [c.id, c.name]));
  // Group classes (16.10.2026): a session's hold shows the class and how full it is.
  const classIds = holds.map(h => h.holderKey?.startsWith("class:") ? h.holderKey.slice(6) : null).filter((x): x is string => !!x);
  const classes = new Map((classIds.length ? await prisma.classSession.findMany({
    where: { id: { in: classIds }, status: "scheduled" },
    select: { id: true, capacity: true, classType: { select: { name: true } }, _count: { select: { bookings: { where: { status: { in: TAKEN } } } } } },
  }) : []).map(c => [c.id, c]));
  return NextResponse.json(holds.filter(h => !h.holderKey?.startsWith("class:") || classes.has(h.holderKey.slice(6))).map(h => ({
    id: h.id, staffId: h.staffId, date: h.date.toISOString().slice(0, 10),
    startTime: h.startTime, endTime: h.endTime, expiresAt: h.expiresAt.toISOString(),
    customerName: (h.customerId && names.get(h.customerId)) || null,
    // closure = the wizard's 1h alternative; whatsapp = the agent's 5-min proposal; web = confirm screen
    source: h.holderKey?.startsWith("class:") ? "class" : h.holderKey?.startsWith("web:") ? "web" : h.holderKey?.startsWith("phone:") ? "whatsapp" : "closure",
    ...(h.holderKey?.startsWith("class:") ? (() => { const c = classes.get(h.holderKey!.slice(6))!; return { className: c.classType.name, booked: c._count.bookings, capacity: c.capacity }; })() : {}),
  })));
}
