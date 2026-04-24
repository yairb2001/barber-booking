/**
 * POST /api/webhook/whatsapp
 *
 * Receives incoming WhatsApp messages from Green API.
 * Green API sends a JSON payload for each incoming message.
 *
 * Webhook URL to configure in Green API:
 *   https://<your-domain>/api/webhook/whatsapp
 *
 * Green API webhook payload (typeWebhook: "incomingMessageReceived"):
 * {
 *   typeWebhook: "incomingMessageReceived",
 *   senderData: { chatId: "972501234567@c.us", senderName: "Name" },
 *   messageData: {
 *     typeMessage: "textMessage" | "extendedTextMessage" | ...,
 *     textMessageData?: { textMessage: "..." },
 *     extendedTextMessageData?: { text: "..." }
 *   }
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { runCustomerAgent } from "@/lib/agent/customer-agent";

export const dynamic = "force-dynamic";

// Green API webhook body types
interface GreenApiWebhook {
  typeWebhook: string;
  instanceData?: { idInstance: string };
  senderData?: {
    chatId: string;
    chatName?: string;
    sender?: string;
    senderName?: string;
  };
  messageData?: {
    typeMessage: string;
    textMessageData?: { textMessage: string };
    extendedTextMessageData?: { text: string };
    quotedMessage?: unknown;
  };
}

/** Extract plain text from a Green API webhook payload */
function extractText(body: GreenApiWebhook): string | null {
  const md = body.messageData;
  if (!md) return null;

  if (md.typeMessage === "textMessage" && md.textMessageData?.textMessage) {
    return md.textMessageData.textMessage;
  }
  if (md.typeMessage === "extendedTextMessage" && md.extendedTextMessageData?.text) {
    return md.extendedTextMessageData.text;
  }
  return null; // image, audio, sticker, etc. — ignore for now
}

/** Extract phone from chatId: "972501234567@c.us" → "972501234567" */
function phoneFromChatId(chatId: string): string {
  return chatId.replace(/@.*$/, "");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: GreenApiWebhook;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // Only handle incoming text messages
  if (body.typeWebhook !== "incomingMessageReceived") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const chatId = body.senderData?.chatId ?? "";
  const rawPhone = phoneFromChatId(chatId);
  const text = extractText(body);

  if (!rawPhone || !text?.trim()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const phone = normalizeIsraeliPhone(rawPhone);

  // Look up business by Green API instance ID
  const instanceId = body.instanceData?.idInstance;
  let biz = instanceId
    ? await prisma.business.findFirst({ where: { greenApiInstanceId: instanceId }, select: { id: true } })
    : null;

  // Fallback: use the first business
  if (!biz) {
    biz = await prisma.business.findFirst({ select: { id: true } });
  }
  if (!biz) {
    console.error("[webhook] no business found");
    return NextResponse.json({ ok: false, error: "no business" }, { status: 404 });
  }

  // Check if agent is enabled for this business
  const agentConfig = await prisma.agentConfig.findUnique({
    where: { businessId: biz.id },
    select: { isEnabled: true },
  });

  if (!agentConfig?.isEnabled) {
    // Agent is off — silently ignore
    return NextResponse.json({ ok: true, skipped: "agent_disabled" });
  }

  // Check if the conversation is escalated (human took over)
  const conv = await prisma.conversation.findFirst({
    where: { businessId: biz.id, phone, status: "escalated" },
    orderBy: { createdAt: "desc" },
  });
  if (conv) {
    // Human is handling — don't intervene
    return NextResponse.json({ ok: true, skipped: "escalated" });
  }

  // Run agent in background (don't await — webhook must respond quickly)
  runCustomerAgent({ businessId: biz.id, phone, incomingText: text }).catch(err => {
    console.error("[agent] error:", err);
  });

  return NextResponse.json({ ok: true });
}
