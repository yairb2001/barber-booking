/**
 * GET /api/admin/agent/conversations
 * Returns recent conversations with their messages.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await prisma.business.findFirst({ select: { id: true } });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status"); // active | escalated | resolved | all
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);

  const where = {
    businessId: biz.id,
    ...(status && status !== "all" ? { status } : {}),
  };

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        take: 50,
        select: { id: true, role: true, content: true, toolName: true, createdAt: true },
      },
    },
  });

  return NextResponse.json(conversations);
}

export async function DELETE(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await prisma.business.findFirst({ select: { id: true } });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });

  const msgs  = await prisma.conversationMessage.deleteMany({ where: { conversation: { businessId: biz.id } } });
  const convs = await prisma.conversation.deleteMany({ where: { businessId: biz.id } });

  return NextResponse.json({ deleted: { messages: msgs.count, conversations: convs.count } });
}

export async function PATCH(req: NextRequest) {
  const guard = requireOwner(req);
  if (guard) return guard;
  const biz = await prisma.business.findFirst({ select: { id: true } });
  if (!biz) return NextResponse.json({ error: "no business" }, { status: 404 });

  const { id, status } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const conv = await prisma.conversation.update({
    where: { id },
    data: { status },
  });

  return NextResponse.json(conv);
}
