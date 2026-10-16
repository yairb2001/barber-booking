import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

/**
 * Rooms (16.10.2026, Yair: "חדר שבו מתבצע לייזר — פנימי פשוט"). The business's
 * rooms, internal only: the services screen links treatments to them, the
 * engine keeps two treatments out of one room at the same time.
 */
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rooms = await prisma.room.findMany({
    where: { businessId: session.businessId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, sortOrder: true, services: { select: { serviceId: true } } },
  });
  return NextResponse.json(rooms.map(r => ({ id: r.id, name: r.name, sortOrder: r.sortOrder, serviceIds: r.services.map(s => s.serviceId) })));
}

export async function POST(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "צריך שם לחדר" }, { status: 400 });
  const count = await prisma.room.count({ where: { businessId: session.businessId, isActive: true } });
  const room = await prisma.room.create({ data: { businessId: session.businessId, name, sortOrder: count } });
  return NextResponse.json({ id: room.id, name: room.name, sortOrder: room.sortOrder, serviceIds: [] }, { status: 201 });
}
