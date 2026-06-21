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
import {
  handleStaffApprovalReply,
  handleCandidateReply,
  expireStaleAgentSwaps,
} from "@/lib/agent/appointment-swap";
import { pushToOwner } from "@/lib/native/push";
import { tierHas } from "@/lib/tier";
import { fallbackBusiness } from "@/lib/tenant";

/** Build a short preview of the incoming message for a push notification. */
function previewText(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — needed for Claude API call

// Green API webhook body types
interface GreenApiWebhook {
  typeWebhook: string;
  instanceData?: { idInstance: string | number };
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

export async function GET(): Promise<NextResponse> {
  // Green API may send GET to verify the endpoint
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: GreenApiWebhook;
  try {
    body = await req.json();
  } catch {
    // Non-JSON body (ping, health check, etc.) — return 200 so Green API doesn't retry
    return NextResponse.json({ ok: true, skipped: "non-json" });
  }

  // Wrap everything in try/catch so Green API always gets 200
  try {

  // ── Manual reply typed on the real WhatsApp app → mute the agent ────────────
  // GreenAPI fires `outgoingMessageReceived` ONLY for messages typed on the
  // phone itself. Messages we send through the API (agent replies, reminders,
  // confirmations) arrive as `outgoingAPIMessageReceived`, which we deliberately
  // ignore here — otherwise the agent would mute itself on every reply. A
  // phone-typed message means the owner/barber took over the chat, so we mute
  // the agent for 24h exactly like a manual reply from the admin platform.
  // (Requires `outgoingMessageWebhook: "yes"` in the GreenAPI instance settings.)
  if (body.typeWebhook === "outgoingMessageReceived") {
    const outPhone = normalizeIsraeliPhone(phoneFromChatId(body.senderData?.chatId ?? ""));
    const outText = extractText(body);
    if (!outPhone || !outText?.trim()) {
      return NextResponse.json({ ok: true, skipped: "outgoing-empty" });
    }
    const outInstance = body.instanceData?.idInstance;
    const outInstanceStr = outInstance != null ? String(outInstance) : null;
    let outBiz = outInstanceStr
      ? await prisma.business.findFirst({ where: { greenApiInstanceId: outInstanceStr }, select: { id: true } })
      : null;
    if (!outBiz && !outInstanceStr) outBiz = await fallbackBusiness({ select: { id: true } });
    if (!outBiz) return NextResponse.json({ ok: true, skipped: "outgoing-no-biz" });

    let outConv = await prisma.conversation.findFirst({
      where: { businessId: outBiz.id, phone: outPhone },
      orderBy: { createdAt: "desc" },
    });
    if (!outConv) {
      outConv = await prisma.conversation.create({
        data: { businessId: outBiz.id, phone: outPhone, agentType: "customer", status: "active", lastMessageAt: new Date() },
      });
    }
    // Mirror the admin-platform manual reply: record it (role=assistant,
    // source=admin) so it shows in the chat UI, and mute the agent for 24h.
    await prisma.conversationMessage.create({
      data: { conversationId: outConv.id, role: "assistant", source: "admin", content: outText.trim() },
    });
    await prisma.conversation.update({
      where: { id: outConv.id },
      data: { escalatedAt: new Date(), lastMessageAt: new Date(), lastReadAt: new Date() },
    });
    return NextResponse.json({ ok: true, mutedByManualReply: true });
  }

  // Only handle incoming text messages
  if (body.typeWebhook !== "incomingMessageReceived") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const chatId = body.senderData?.chatId ?? "";
  const rawPhone = phoneFromChatId(chatId);
  const text = extractText(body);
  // WhatsApp display name as set by the sender — used in the chats UI as a
  // fallback when the customer is not yet in our DB.
  const senderName = (body.senderData?.senderName || body.senderData?.chatName || "").trim();

  if (!rawPhone || !text?.trim()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const phone = normalizeIsraeliPhone(rawPhone);

  // Look up business by Green API instance ID
  const instanceId = body.instanceData?.idInstance;
  const instanceIdStr = instanceId != null ? String(instanceId) : null;
  let biz = instanceIdStr
    ? await prisma.business.findFirst({ where: { greenApiInstanceId: instanceIdStr }, select: { id: true, tier: true } })
    : null;

  // Fallback ONLY when no instance id was provided (legacy single-tenant webhook).
  // If an instance id WAS given but matched no business, do NOT guess — attaching
  // the message to an arbitrary tenant would mix data between businesses.
  if (!biz && !instanceIdStr) {
    biz = await fallbackBusiness({ select: { id: true, tier: true } });
  }
  if (!biz) {
    console.error("[webhook] no business found");
    return NextResponse.json({ ok: false, error: "no business" }, { status: 404 });
  }

  // ── 0. Agent move/swap reply routing ────────────────────────────────────────
  // Before anything else: lazily expire stale agent-initiated swap requests
  // (there is no cron — every inbound message drives expiry), then check whether
  // THIS message is a barber approving/declining a swap, or a candidate customer
  // answering a swap offer. If so it's a transactional reply — handle it and stop
  // here so it never reaches the booking agent or the customer chat inbox.
  await expireStaleAgentSwaps(biz.id).catch((e) => console.error("[swap expiry]", e));
  try {
    if (await handleStaffApprovalReply(biz.id, phone, text)) {
      return NextResponse.json({ ok: true, handled: "swap_staff_reply" });
    }
    if (await handleCandidateReply(biz.id, phone, text)) {
      return NextResponse.json({ ok: true, handled: "swap_candidate_reply" });
    }
  } catch (e) {
    console.error("[swap reply routing]", e);
  }

  // ── 1. Always persist the incoming message ──────────────────────────────────
  // Even if the agent is off or escalated, we save the message so the admin can
  // see it in the chat UI and reply manually.
  let conv = await prisma.conversation.findFirst({
    where: { businessId: biz.id, phone },
    orderBy: { createdAt: "desc" },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        businessId: biz.id,
        phone,
        agentType: "customer",
        status: "active",
        lastMessageAt: new Date(),
        whatsappName: senderName || null,
      },
    });
  }
  await prisma.conversationMessage.create({
    data: { conversationId: conv.id, role: "user", source: "agent", content: text },
  });
  await prisma.conversation.update({
    where: { id: conv.id },
    data: {
      lastMessageAt: new Date(),
      // Refresh whatsappName each message in case the user updates it
      ...(senderName && { whatsappName: senderName }),
    },
  });

  // ── 2. Check if agent should run ─────────────────────────────────────────────
  const agentConfig = await prisma.agentConfig.findUnique({
    where: { businessId: biz.id },
    select: { isEnabled: true },
  });

  // The AI agent is a PREMIUM-tier feature. Lower tiers always route to a human,
  // even if AgentConfig.isEnabled is left on (e.g. after a downgrade).
  const agentAllowedByTier = tierHas(biz.tier, "aiAgent");

  if (!agentConfig?.isEnabled || !agentAllowedByTier) {
    // Agent is off (or not included in the tier) → a human must reply. Ping the owner.
    pushToOwner(biz.id, {
      title: `הודעה חדשה מ${senderName || phone}`,
      body: previewText(text),
      data: { type: "chat", conversationId: conv.id, phone },
    }).catch(() => {});
    return NextResponse.json({
      ok: true,
      skipped: agentAllowedByTier ? "agent_disabled" : "agent_not_in_tier",
      saved: true,
    });
  }

  // 24h escalation expiry — lazy check; clear flag if expired
  const ESCALATION_TTL_MS = 24 * 60 * 60 * 1000;
  const isEscalated = conv.escalatedAt && (Date.now() - conv.escalatedAt.getTime()) < ESCALATION_TTL_MS;
  if (conv.escalatedAt && !isEscalated) {
    await prisma.conversation.update({ where: { id: conv.id }, data: { escalatedAt: null } });
  }
  if (isEscalated) {
    // Conversation handed to a human → notify the owner of the new message.
    pushToOwner(biz.id, {
      title: `הודעה חדשה מ${senderName || phone}`,
      body: previewText(text),
      data: { type: "chat", conversationId: conv.id, phone },
    }).catch(() => {});
    return NextResponse.json({ ok: true, skipped: "escalated", saved: true });
  }

  // ── 3. Run agent — message is already persisted; agent will skip its own save ──
  try {
    await runCustomerAgent({ businessId: biz.id, phone, incomingText: text, alreadyPersisted: true });
  } catch (agentErr) {
    console.error("[agent] error:", agentErr);
  }

  return NextResponse.json({ ok: true });

  } catch (err) {
    // Never return 500 to Green API — it will retry endlessly
    console.error("[webhook] unhandled error:", err);
    return NextResponse.json({ ok: true, error: "internal" });
  }
}
