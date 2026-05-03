import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestSession, scopedStaffId } from "@/lib/session";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";

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

  const business = await prisma.business.findFirst({
    where: { id: session.businessId },
    select: { id: true, chatsEnabled: true },
  });
  if (!business) return NextResponse.json([]);
  if (!business.chatsEnabled) return NextResponse.json({ error: "feature_disabled" }, { status: 403 });

  const barberScope = scopedStaffId(req);

  // Build where: barbers see only their own customers' conversations
  let where: Record<string, unknown> = { businessId: business.id };
  if (barberScope) {
    where = {
      businessId: business.id,
      customer: { appointments: { some: { staffId: barberScope } } },
    };
  }

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

    // Unread = number of "user" messages newer than lastReadAt
    const unreadCount = await prisma.conversationMessage.count({
      where: {
        conversationId: c.id,
        role: "user",
        ...(c.lastReadAt ? { createdAt: { gt: c.lastReadAt } } : {}),
      },
    });

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
      lastMessageAt: c.lastMessageAt,
      lastMessageSnippet: last?.content?.slice(0, 80) ?? "",
      lastMessageRole: last?.role ?? null,
      unreadCount,
    };
  }));

  return NextResponse.json(data);
}
