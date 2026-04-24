import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
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

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await prisma.story.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
