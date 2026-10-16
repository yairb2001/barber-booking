import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

/** Rename / reorder a room, or set which treatments use it (serviceIds). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const room = await prisma.room.findFirst({ where: { id: params.id, businessId: session.businessId }, select: { id: true } });
  if (!room) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : undefined;
  await prisma.room.update({
    where: { id: room.id },
    data: { ...(name ? { name } : {}), ...(Number.isInteger(body.sortOrder) ? { sortOrder: body.sortOrder } : {}) },
  });
  if (Array.isArray(body.serviceIds)) {
    const mine = await prisma.service.findMany({ where: { id: { in: body.serviceIds.filter((x: unknown) => typeof x === "string") }, businessId: session.businessId }, select: { id: true } });
    await prisma.$transaction([
      prisma.serviceRoom.deleteMany({ where: { roomId: room.id } }),
      prisma.serviceRoom.createMany({ data: mine.map(s => ({ serviceId: s.id, roomId: room.id })) }),
    ]);
  }
  return NextResponse.json({ ok: true });
}

/** A room leaves the list; bookings keep the name it had (they point to the row). */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const { count } = await prisma.room.updateMany({ where: { id: params.id, businessId: session.businessId }, data: { isActive: false } });
  if (!count) return NextResponse.json({ error: "not found" }, { status: 404 });
  await prisma.serviceRoom.deleteMany({ where: { roomId: params.id } });
  return NextResponse.json({ ok: true });
}
