import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getEffectivePermissions } from "@/lib/session";

// POST /api/admin/chats/[id]/toggle-agent
// Body: { active: boolean }
//
// active=true  → escalatedAt = null (agent will respond on next incoming msg)
// active=false → escalatedAt = now() (agent muted for 24h)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await prisma.business.findFirst({
    where: { id: session.businessId },
    select: { id: true, chatsEnabled: true },
  });
  if (!business?.chatsEnabled) return NextResponse.json({ error: "feature_disabled" }, { status: 403 });

  const { active } = await req.json();

  // Permission enforcement: barber needs "view all chats" to manage the inbox.
  const perms = await getEffectivePermissions(req);
  if (!perms.isOwner && !perms.canViewAllChats) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const conv = await prisma.conversation.findFirst({
    where: { id: params.id, businessId: business.id },
  });
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });

  const updated = await prisma.conversation.update({
    where: { id: conv.id },
    data: { escalatedAt: active ? null : new Date() },
  });

  return NextResponse.json({
    ok: true,
    escalated: !active,
    escalatedAt: updated.escalatedAt,
  });
}
