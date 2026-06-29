import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const body = await req.json();
  // Tenant isolation: only touch a product that belongs to the caller's business.
  const owned = await prisma.product.findFirst({ where: { id: params.id, businessId: session.businessId }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  const item = await prisma.product.update({
    where: { id: params.id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.price !== undefined && { price: parseFloat(body.price) }),
      ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl }),
      ...(body.isVisible !== undefined && { isVisible: body.isVisible }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
    },
  });
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const { count } = await prisma.product.deleteMany({ where: { id: params.id, businessId: session.businessId } });
  if (count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
