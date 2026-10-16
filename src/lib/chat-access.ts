// Who sees which WhatsApp chats (owner, 16.10.2026): per staff member the owner
// picks one of three — "all" (every conversation), "own" (only conversations
// of customers who have/had an appointment with him), "none". Stored as
// Staff.canViewAllChats (= all) + Staff.settings.chatScope "own".
import { prisma } from "@/lib/prisma";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import type { EffectivePermissions } from "@/lib/session";

export type ChatScope = "all" | "own" | "none";

export function chatScopeFromStaff(s: { canViewAllChats: boolean; settings: string | null } | null): ChatScope {
  if (!s) return "none";
  if (s.canViewAllChats) return "all";
  try { return JSON.parse(s.settings || "{}").chatScope === "own" ? "own" : "none"; } catch { return "none"; }
}

export async function chatScopeOf(perms: EffectivePermissions): Promise<ChatScope> {
  if (perms.isOwner || perms.canViewAllChats) return "all";
  if (!perms.staffId) return "none";
  const s = await prisma.staff.findUnique({ where: { id: perms.staffId }, select: { canViewAllChats: true, settings: true } });
  return chatScopeFromStaff(s);
}

/** His customers: anyone with a non-cancelled appointment with him (past or upcoming). */
export async function ownCustomerKeys(businessId: string, staffId: string): Promise<{ ids: Set<string>; phones: Set<string> }> {
  const rows = await prisma.appointment.findMany({
    where: { businessId, staffId, status: { notIn: ["cancelled_by_staff", "cancelled_by_customer"] } },
    select: { customerId: true, customer: { select: { phone: true } } },
    distinct: ["customerId"],
  });
  return {
    ids: new Set(rows.map(r => r.customerId)),
    phones: new Set(rows.map(r => normalizeIsraeliPhone(r.customer.phone))),
  };
}

/** May this caller open / act on this conversation? */
export async function canAccessConversation(perms: EffectivePermissions, businessId: string, conversationId: string): Promise<boolean> {
  const scope = await chatScopeOf(perms);
  if (scope === "all") return true;
  if (scope === "none" || !perms.staffId) return false;
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, businessId }, select: { customerId: true, phone: true } });
  if (!conv) return true; // the route answers 404 itself
  const mine = await ownCustomerKeys(businessId, perms.staffId);
  return (!!conv.customerId && mine.ids.has(conv.customerId)) || mine.phones.has(normalizeIsraeliPhone(conv.phone));
}
