import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, scopedStaffId } from "@/lib/session";

const ESCALATION_TTL_MS = 24 * 60 * 60 * 1000;

// GET /api/admin/chats/[id] — single conversation with messages
//
// Marks the conversation as read (sets lastReadAt = now) so that the unread
// badge clears for all admins.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await prisma.business.findFirst({
    where: { id: session.businessId },
    select: { id: true, chatsEnabled: true },
  });
  if (!business?.chatsEnabled) return NextResponse.json({ error: "feature_disabled" }, { status: 403 });

  const barberScope = scopedStaffId(req);

  const conv = await prisma.conversation.findFirst({
    where: { id: params.id, businessId: business.id },
    include: {
      customer: { select: { id: true, name: true, phone: true, appointments: { select: { staffId: true } } } },
      messages: {
        where: { role: { not: "tool" } },
        orderBy: { createdAt: "asc" },
        take: 200,
      },
    },
  });
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Barber scoping — must be one of their customers
  if (barberScope) {
    const isMine = conv.customer?.appointments?.some(a => a.staffId === barberScope);
    if (!isMine) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Mark as read (best-effort, don't await)
  prisma.conversation.update({
    where: { id: conv.id },
    data: { lastReadAt: new Date() },
  }).catch(() => {});

  const escalated = !!conv.escalatedAt && (Date.now() - conv.escalatedAt.getTime()) < ESCALATION_TTL_MS;

  return NextResponse.json({
    id: conv.id,
    phone: conv.phone,
    customerName: conv.customer?.name ?? null,
    customerId: conv.customer?.id ?? null,
    status: conv.status,
    escalated,
    escalatedAt: conv.escalatedAt,
    lastMessageAt: conv.lastMessageAt,
    messages: conv.messages.map(m => ({
      id: m.id,
      role: m.role,
      source: m.source,
      content: m.content,
      createdAt: m.createdAt,
    })),
  });
}
