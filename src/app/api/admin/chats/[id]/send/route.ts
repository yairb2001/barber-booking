import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, scopedStaffId } from "@/lib/session";
import { sendMessage } from "@/lib/messaging";

// POST /api/admin/chats/[id]/send
// Body: { message: string }
//
// 1. Saves the message to ConversationMessage (role=assistant, source=admin)
// 2. Sets escalatedAt=now() — agent stops auto-replying for 24h
// 3. Updates lastMessageAt
// 4. Sends the message via WhatsApp (sendMessage logs it to MessageLog)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await prisma.business.findFirst({
    where: { id: session.businessId },
    select: { id: true, chatsEnabled: true },
  });
  if (!business?.chatsEnabled) return NextResponse.json({ error: "feature_disabled" }, { status: 403 });

  const { message } = await req.json();
  if (!message?.trim()) return NextResponse.json({ error: "message required" }, { status: 400 });

  const barberScope = scopedStaffId(req);

  const conv = await prisma.conversation.findFirst({
    where: { id: params.id, businessId: business.id },
    include: { customer: { select: { appointments: { select: { staffId: true } } } } },
  });
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Barber scoping
  if (barberScope) {
    const isMine = conv.customer?.appointments?.some(a => a.staffId === barberScope);
    if (!isMine) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Save the admin message + flip escalation
  const saved = await prisma.conversationMessage.create({
    data: {
      conversationId: conv.id,
      role: "assistant",
      source: "admin",
      content: message.trim(),
    },
  });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: {
      escalatedAt: new Date(),
      lastMessageAt: new Date(),
      lastReadAt: new Date(),
    },
  });

  // Send via WhatsApp (also logs to MessageLog as kind="manual")
  const result = await sendMessage({
    businessId: business.id,
    customerPhone: conv.phone,
    kind: "manual",
    body: message.trim(),
  });

  return NextResponse.json({
    ok: result.ok,
    error: result.error,
    message: {
      id: saved.id,
      role: saved.role,
      source: saved.source,
      content: saved.content,
      createdAt: saved.createdAt,
    },
  });
}
