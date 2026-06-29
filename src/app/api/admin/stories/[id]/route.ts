import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, requireOwner } from "@/lib/session";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const body = await req.json();
  // Tenant isolation: only touch a story that belongs to the caller's business.
  const owned = await prisma.story.findFirst({ where: { id: params.id, businessId: session.businessId }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });
  const story = await prisma.story.update({
    where: { id: params.id },
    data: {
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      ...(body.caption !== undefined && { caption: body.caption }),
    },
  });
  return NextResponse.json(story);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const session = getRequestSession(req)!;
  const { count } = await prisma.story.deleteMany({ where: { id: params.id, businessId: session.businessId } });
  if (count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
