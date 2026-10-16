import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";
import { setServiceRooms } from "@/lib/availability/rooms";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const body = await req.json();
  // Tenant isolation: only touch a service that belongs to the caller's business.
  const owned = await prisma.service.findFirst({ where: { id: params.id, businessId: session.businessId }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  const service = await prisma.service.update({
    where: { id: params.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.price !== undefined && { price: parseFloat(body.price) }),
      ...(body.durationMinutes !== undefined && { durationMinutes: parseInt(body.durationMinutes) }),
      ...(body.isVisible !== undefined && { isVisible: body.isVisible }),
      ...(body.showDuration !== undefined && { showDuration: body.showDuration }),
      ...(body.category !== undefined && { category: typeof body.category === "string" && body.category.trim() ? body.category.trim() : null }),
      ...(body.priceFrom !== undefined && { priceFrom: body.priceFrom === true }),
      ...(body.segments !== undefined && { segments: (() => { if (body.segments === null) return null; try { const x = JSON.parse(String(body.segments)); return Array.isArray(x) && x.length && x.every((g: { m?: unknown }) => Number(g?.m) > 0) ? JSON.stringify(x.map((g: { m: number; busy?: boolean }) => ({ m: Math.round(Number(g.m)), busy: g.busy !== false }))) : null; } catch { return null; } })() }),
      ...(body.bufferAfterMin !== undefined && { bufferAfterMin: (Number.isInteger(body.bufferAfterMin) && body.bufferAfterMin >= 0 && body.bufferAfterMin <= 240 ? body.bufferAfterMin : 0) }),
      ...(body.upsellIds !== undefined && { upsellIds: (() => { if (!Array.isArray(body.upsellIds)) return null; const ids = body.upsellIds.filter((x: unknown) => typeof x === "string").slice(0, 5); return ids.length ? JSON.stringify(ids) : null; })() }),
      ...(body.rebookDays !== undefined && { rebookDays: (Number.isInteger(body.rebookDays) && body.rebookDays > 0 && body.rebookDays <= 365 ? body.rebookDays : null) }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
    },
  });
  await setServiceRooms(service.id, session.businessId, body.roomIds);
  return NextResponse.json(service);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  // Tenant isolation: deleteMany scoped by business → a cross-business id deletes nothing.
  const { count } = await prisma.service.deleteMany({ where: { id: params.id, businessId: session.businessId } });
  if (count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
