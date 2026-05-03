import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession } from "@/lib/session";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

// POST /api/admin/chats/send-quick
// Body: { phone: string, customerName?: string, message: string }
//
// Used by the "quick message" button on appointment cards. Finds (or creates)
// a Conversation for the given phone, saves the admin message, escalates the
// agent for 24h, and sends via WhatsApp.
export async function POST(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await prisma.business.findFirst({
    where: { id: session.businessId },
    select: { id: true },
  });
  if (!business) return NextResponse.json({ error: "no business" }, { status: 400 });

  const { phone, customerName, message } = await req.json();
  if (!phone || !message?.trim()) {
    return NextResponse.json({ error: "phone and message required" }, { status: 400 });
  }

  const normalized = normalizeIsraeliPhone(phone);

  // Find or create the conversation
  let conv = await prisma.conversation.findFirst({
    where: { businessId: business.id, phone: normalized },
    orderBy: { createdAt: "desc" },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        businessId: business.id,
        phone: normalized,
        agentType: "customer",
        status: "active",
        lastMessageAt: new Date(),
        ...(customerName ? { whatsappName: customerName } : {}),
      },
    });
  }

  // Persist + escalate
  await prisma.conversationMessage.create({
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

  // Send via WhatsApp
  const result = await sendMessage({
    businessId: business.id,
    customerPhone: normalized,
    kind: "manual",
    body: message.trim(),
  });

  return NextResponse.json({ ok: result.ok, error: result.error, conversationId: conv.id });
}
