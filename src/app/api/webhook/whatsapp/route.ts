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
import { runOwnerAgent } from "@/lib/agent/owner-agent";
import {
  handleStaffApprovalReply,
  handleCandidateReply,
  handleAdminProposalReply,
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
  idMessage?: string;          // unique message ID from Green API — used for dedup
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

/** A short Hebrew label for a non-text message, so media the agent can't read
 *  still shows up in the chat inbox instead of vanishing. Returns null for types
 *  we don't want to surface (reactions, unknown). */
function mediaLabel(typeMessage: string | undefined): string | null {
  switch (typeMessage) {
    case "imageMessage":    return "📷 תמונה";
    case "videoMessage":    return "🎥 סרטון";
    case "audioMessage":    return "🎤 הודעה קולית";
    case "documentMessage": return "📎 קובץ";
    case "stickerMessage":  return "😀 סטיקר";
    case "locationMessage": return "📍 מיקום";
    case "contactMessage":  return "👤 איש קשר";
    case "pollMessage":     return "📊 סקר";
    default: return null;
  }
}

/** Extract phone from chatId: "972501234567@c.us" → "972501234567" */
function phoneFromChatId(chatId: string): string {
  return chatId.replace(/@.*$/, "");
}

/**
 * GreenAPI group chats carry a chatId ending in "@g.us" (e.g.
 * "120363012345678901@g.us"); 1-on-1 chats end in "@c.us". We never want the
 * agent to act on group traffic — it would reply into the group as if it were a
 * private DM, the thread shows up nowhere useful, and every message burns tokens.
 * So we hard-skip anything that isn't a personal chat.
 */
function isGroupChat(chatId: string): boolean {
  return chatId.endsWith("@g.us");
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

  // ── Ignore group chats entirely ─────────────────────────────────────────────
  // Group messages (chatId "...@g.us") must never reach the agent or the inbox —
  // it would answer into the group like a private DM and waste tokens. Bail out
  // before any DB work, for both incoming and phone-typed outgoing webhooks.
  if (isGroupChat(body.senderData?.chatId ?? "")) {
    return NextResponse.json({ ok: true, skipped: "group_chat" });
  }

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
    // Include media the owner sends from the phone (voice/image/etc.) as a
    // placeholder — otherwise it neither shows in the inbox NOR mutes the agent,
    // so the agent could barge into a chat the owner is already handling by voice.
    const outText = extractText(body) ?? mediaLabel(body.messageData?.typeMessage);
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
  // Non-text messages (voice notes, images, ...) were dropped here silently — the
  // message never reached the inbox and the agent never ran, so a customer who
  // opened with a photo/voice got no answer at all. Surface a placeholder so it
  // shows in chats; a human handles it (the agent can't read media).
  const rawText = extractText(body);
  const mediaPlaceholder = rawText === null ? mediaLabel(body.messageData?.typeMessage) : null;
  const text = rawText ?? mediaPlaceholder;
  const isNonText = rawText === null && text !== null;
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
    ? await prisma.business.findFirst({ where: { greenApiInstanceId: instanceIdStr }, select: { id: true, tier: true, settings: true } })
    : null;

  // Fallback ONLY when no instance id was provided (legacy single-tenant webhook).
  // If an instance id WAS given but matched no business, do NOT guess — attaching
  // the message to an arbitrary tenant would mix data between businesses.
  if (!biz && !instanceIdStr) {
    biz = await fallbackBusiness({ select: { id: true, tier: true, settings: true } });
  }
  if (!biz) {
    console.error("[webhook] no business found");
    return NextResponse.json({ ok: false, error: "no business" }, { status: 404 });
  }

  // Lazily expire stale agent-initiated swap requests (there is no cron — every
  // inbound message drives expiry) before we route or persist anything.
  await expireStaleAgentSwaps(biz.id).catch((e) => console.error("[swap expiry]", e));

  // ── Owner / staff personal-agent routing ────────────────────────────────────
  // If the sender is the owner (Business.settings.ownerLoginPhone) or a staff
  // member granted `canUseOwnerAgent`, route to the OWNER agent — admin commands
  // like "swap the 13:00 with the 16:00" or "message all of today's customers" —
  // instead of the customer booking agent. The owner agent keeps its own
  // conversation (agentType="owner"), hidden from the customer inbox, so owner
  // commands are NOT persisted as a customer thread below.
  // Feature flag — owner agent is opt-in PER BUSINESS (off by default). Enabled
  // only for businesses with `settings.ownerAgentEnabled === true` (currently just
  // dominant) so we can refine it before rolling it out to other shops.
  const bizSettings: Record<string, unknown> = (() => {
    try { return biz.settings ? JSON.parse(biz.settings) : {}; } catch { return {}; }
  })();
  if (bizSettings.ownerAgentEnabled === true) {
    try {
      const ownerPhone = bizSettings.ownerLoginPhone
        ? normalizeIsraeliPhone(String(bizSettings.ownerLoginPhone))
        : null;
      // Find the sender's own staff record (phone formats vary, so normalize each).
      // We need the id to scope the agent to this person's PERSONAL calendar.
      const staffWithPhones = await prisma.staff.findMany({
        where: { businessId: biz.id, isActive: true, phone: { not: null } },
        select: { id: true, phone: true, role: true, canUseOwnerAgent: true },
      });
      const senderStaff = staffWithPhones.find(
        s => s.phone && normalizeIsraeliPhone(s.phone) === phone
      );
      // The owner is recognised by ownerLoginPhone OR a role==="owner" staff record.
      // The owner gets the personal agent by default, but can switch it off FOR
      // HIMSELF via `settings.ownerAgentSelfDisabled` (the per-business master switch
      // `ownerAgentEnabled`, checked above, turns it off for EVERYONE).
      const isOwner =
        (!!ownerPhone && phone === ownerPhone) ||
        (!!senderStaff && senderStaff.role === "owner");
      const ownerSelfDisabled = bizSettings.ownerAgentSelfDisabled === true;
      const isOwnerSender = isOwner
        ? !ownerSelfDisabled
        : (!!senderStaff && senderStaff.canUseOwnerAgent); // barber: explicit grant
      if (isOwnerSender) {
        try {
          await runOwnerAgent({
            businessId: biz.id,
            phone,
            incomingText: text,
            senderName,
            // Scope to the sender's own calendar. (Null only if the owner phone has
            // no matching staff record — then the agent sees all calendars.)
            staffId: senderStaff?.id ?? null,
          });
        } catch (e) {
          console.error("[owner-agent]", e);
        }
        return NextResponse.json({ ok: true, handled: "owner_agent" });
      }
    } catch (e) {
      console.error("[owner routing]", e);
    }
  }

  // ── 1. Always persist the incoming message FIRST ────────────────────────────
  // Even if the agent is off/escalated — and even if a swap/move reply handler
  // below consumes this message — we save it so it shows in the chat UI. (Before,
  // a "כן"/"לא" answer to a manual swap was eaten by the swap router and never
  // appeared in the inbox, so the chat looked like the customer never replied.)
  // Persisting first also means the dedup guard runs before the swap executor,
  // so a Green API double-delivery can't run the same swap twice.
  // Exclude the owner-agent thread (agentType="owner") — it's hidden from the chat
  // inbox. If the owner has the personal agent OFF, his messages fall through to
  // here and must land in a normal (visible) customer conversation, NOT get glued
  // onto the hidden owner thread (which would make him "disappear" from chats).
  let conv = await prisma.conversation.findFirst({
    where: { businessId: biz.id, phone, agentType: { not: "owner" } },
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

  // ── Idempotency guard ───────────────────────────────────────────────────────
  // Green API occasionally delivers the same webhook twice (network retry).
  // Primary key: idMessage from the payload (when present).
  // Fallback: same content within the last 30 s in this conversation.
  // In either case return 200 immediately so Green API stops retrying.
  const DEDUP_WINDOW_MS = 30_000;
  const dedupSince = new Date(Date.now() - DEDUP_WINDOW_MS);
  const existingMsg = await prisma.conversationMessage.findFirst({
    where: {
      conversationId: conv.id,
      role: "user",
      content: text,
      createdAt: { gte: dedupSince },
    },
    select: { id: true },
  });
  if (existingMsg) {
    console.warn(`[webhook] duplicate message skipped — conv=${conv.id} idMessage=${body.idMessage ?? "n/a"}`);
    return NextResponse.json({ ok: true, skipped: "duplicate_message" });
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

  // ── 1b. Agent move/swap reply routing ───────────────────────────────────────
  // Now that the reply is saved to the chat, check whether THIS message is a
  // barber approving/declining a swap, or a customer answering a swap/move offer.
  // If so it's a transactional reply — handle it deterministically and stop here
  // so it never reaches the booking agent. (The message itself is already in the
  // inbox; only the agent run is skipped.)
  try {
    if (await handleStaffApprovalReply(biz.id, phone, text)) {
      return NextResponse.json({ ok: true, handled: "swap_staff_reply" });
    }
    if (await handleCandidateReply(biz.id, phone, text)) {
      return NextResponse.json({ ok: true, handled: "swap_candidate_reply" });
    }
    // Manual (admin-built) swap/move proposal — the barber created it from the
    // calendar, so the agent never saw the outgoing offer. Intercept the yes/no
    // here and execute deterministically instead of letting the context-less
    // agent guess what "כן" means.
    if (await handleAdminProposalReply(biz.id, phone, text)) {
      return NextResponse.json({ ok: true, handled: "swap_admin_reply" });
    }
  } catch (e) {
    console.error("[swap reply routing]", e);
  }

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

  // A media/voice message is saved and visible now, but the agent can't read it —
  // route it to a human instead of running the model on a "📷 תמונה" placeholder.
  if (isNonText) {
    pushToOwner(biz.id, {
      title: `📎 הודעת מדיה מ${senderName || phone}`,
      body: previewText(text!),
      data: { type: "chat", conversationId: conv.id, phone },
    }).catch(() => {});
    return NextResponse.json({ ok: true, media: true, saved: true });
  }

  // ── 3. Run agent — message is already persisted; agent will skip its own save ──
  try {
    await runCustomerAgent({ businessId: biz.id, phone, incomingText: text, alreadyPersisted: true });
  } catch (agentErr) {
    // The agent failed to produce a reply (e.g. a transient Anthropic outage the
    // retries couldn't ride out). Do NOT leave the customer in silence — alert
    // the owner so a human can jump in, exactly the manual save that otherwise
    // only happens if someone notices the chat.
    console.error("[agent] error:", agentErr);
    pushToOwner(biz.id, {
      title: `⚠️ הסוכן לא הצליח לענות ל${senderName || phone}`,
      body: previewText(text),
      data: { type: "chat", conversationId: conv.id, phone },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });

  } catch (err) {
    // Never return 500 to Green API — it will retry endlessly
    console.error("[webhook] unhandled error:", err);
    return NextResponse.json({ ok: true, error: "internal" });
  }
}
