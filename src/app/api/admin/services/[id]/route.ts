import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

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
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
    },
  });
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
