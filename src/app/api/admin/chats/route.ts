import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, getEffectivePermissions, getSessionBusiness } from "@/lib/session";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { tierHas } from "@/lib/tier";

const ESCALATION_TTL_MS = 24 * 60 * 60 * 1000;

// GET /api/admin/chats — list conversations the caller is allowed to see
//
// Owner: all conversations of the business
// Barber: only conversations of customers who have at least one appointment
//         with this barber (matched via Conversation.customerId)
//
// Returns:
//   {
//     id, phone, customerName, status,
//     escalated (boolean — derived from escalatedAt + 24h TTL),
//     lastMessageAt, lastMessageSnippet, unreadCount
//   }[]
export async function GET(req: NextRequest) {
  const session = getRequestSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const business = await getSessionBusiness(req, { id: true, chatsEnabled: true, tier: true });
  if (!business) return NextResponse.json([]);
  if (!business.chatsEnabled) return NextResponse.json({ error: "feature_disabled" }, { status: 403 });

  // Is the AI agent active for this business at all? When it's globally off (or
  // not included in the tier), EVERY conversation needs a human — there's no
  // agent answering — so they all count as "needs human attention".
  const agentConfig = await prisma.agentConfig.findUnique({
    where: { businessId: business.id },
    select: { isEnabled: true },
  });
  const agentGloballyOn = !!agentConfig?.isEnabled && tierHas(business.tier, "aiAgent");

  // Permission enforcement: a barber may only read the shared inbox when granted
  // "view all chats" (per-staff flag OR business-wide flag). Otherwise no access.
  const perms = await getEffectivePermissions(req);
  if (!perms.isOwner && !perms.canViewAllChats) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Hide owner-agent threads — those are the owner's private admin-command chats,
  // not customer conversations that need handling.
  const where: Record<string, unknown> = { businessId: business.id, agentType: { not: "owner" } };

  const convs = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    include: {
      customer: { select: { id: true, name: true } },
      messages: {
        where: { role: { not: "tool" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, role: true, source: true, createdAt: true },
      },
    },
  });

  // Phone-based fallback: build a lookup of all customers in the business
  // keyed by their normalized phone. Conversations without a linked customerId
  // can still be matched to a known customer by phone.
  const allCustomers = await prisma.customer.findMany({
    where: { businessId: business.id },
    select: { id: true, name: true, phone: true },
  });
  const phoneToCustomer = new Map<string, { id: string; name: string }>();
  for (const c of allCustomers) {
    phoneToCustomer.set(normalizeIsraeliPhone(c.phone), { id: c.id, name: c.name });
  }

  const now = Date.now();
  const data = await Promise.all(convs.map(async (c) => {
    const last = c.messages[0];
    const escalated = !!c.escalatedAt && (now - c.escalatedAt.getTime()) < ESCALATION_TTL_MS;

    // A conversation "needs human" when the agent is NOT handling it: either it
    // was escalated / a human took over (escalatedAt within 24h), or the agent
    // is globally off for the business. While the agent IS handling a chat we
    // deliberately surface NO red alert — the owner shouldn't be nagged.
    const needsHuman = escalated || !agentGloballyOn;

    // Unread = number of "user" messages newer than lastReadAt — but ONLY for
    // conversations that need a human. Agent-handled chats never show a red dot.
    const rawUnread = await prisma.conversationMessage.count({
      where: {
        conversationId: c.id,
        role: "user",
        ...(c.lastReadAt ? { createdAt: { gt: c.lastReadAt } } : {}),
      },
    });
    const unreadCount = needsHuman ? rawUnread : 0;

    // "Needs handling" = it's a human-handled conversation AND the LAST message
    // is from the customer (role "user") — i.e. the customer spoke last and
    // nobody has replied yet. Replying (in-app or on WhatsApp) makes the last
    // message ours → no longer needs handling → it sinks within the section.
    // A new customer message flips the last role back to "user" → bumps it up.
    // This is intentionally based on who-spoke-last, NOT on lastReadAt: merely
    // opening a chat to peek does not count as "handled".
    //
    // Manual "handled" override: if an admin marked the chat handled and the
    // customer hasn't written since (no message newer than handledAt), it no
    // longer needs handling — even though the customer technically spoke last.
    // A newer customer message (createdAt > handledAt) re-flags it automatically.
    const handledCovered = !!c.handledAt && !!last && last.createdAt <= c.handledAt;
    const needsHandling = needsHuman && last?.role === "user" && !handledCovered;

    // Resolve display name in priority order:
    //   1. Linked customer in DB (most reliable — name they registered with)
    //   2. Phone match in customers table
    //   3. WhatsApp display name (whatever they set in their WhatsApp profile)
    //   4. null → UI falls back to phone
    const matchedByPhone = phoneToCustomer.get(normalizeIsraeliPhone(c.phone));
    const customerName = c.customer?.name ?? matchedByPhone?.name ?? c.whatsappName ?? null;

    return {
      id: c.id,
      phone: c.phone,
      customerName,
      status: c.status,
      escalated,
      needsHuman,
      needsHandling,
      lastMessageAt: c.lastMessageAt,
      lastMessageSnippet: last?.content?.slice(0, 80) ?? "",
      lastMessageRole: last?.role ?? null,
      unreadCount,
    };
  }));

  // Ordering for the two-section UI:
  //   1. Human-handled conversations (escalated / agent off) first — the top
  //      "טיפול אנושי" section.
  //   2. WITHIN that section, conversations that still need handling (customer
  //      spoke last) float above the ones you've already replied to.
  //   3. Recency (lastMessageAt desc) is preserved within each subgroup since
  //      the DB query already returns that order and sort is stable.
  data.sort((a, b) => {
    if (a.needsHuman !== b.needsHuman) return Number(b.needsHuman) - Number(a.needsHuman);
    return Number(b.needsHandling) - Number(a.needsHandling);
  });

  return NextResponse.json(data);
}
