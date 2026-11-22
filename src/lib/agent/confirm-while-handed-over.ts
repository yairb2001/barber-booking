/**
 * A "כן" to the agent's own "מאשר?" is booked even when the chat was handed to a
 * person in between (Yair, 22.11.2026, DOMINANT: the customer answered "כן", the
 * chat was already with a person, the webhook stopped before the agent, and he
 * thought he had an appointment that did not exist).
 *
 * Only when the agent's confirmation question is still the last thing we wrote:
 * once a person wrote after it, the "כן" may answer him, so it stays his.
 */
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/messaging";
import { normalizeIsraeliPhone } from "@/lib/messaging/phone";
import { findPendingProposal, isPlainYes, bookConfirmedProposal } from "@/lib/agent/booking-proposals";
import { execTool } from "@/lib/agent/customer-agent";

const CONFIRM_QUESTION = /(מאשר|מאשרת|לאשר|confirm)\s*\??\s*$/i;

/** Books and answers the customer; true when it did. */
export async function bookConfirmWhileHandedOver(p: { businessId: string; phone: string; conversationId: string; text: string }): Promise<boolean> {
  const pending = await findPendingProposal(p.businessId, p.phone);
  if (!pending || pending.kind !== "confirm" || !isPlainYes(p.text.trim(), pending.startTime)) return false;
  try { if (JSON.parse(pending.note ?? "{}").awaitingName) return false; } catch { return false; }
  const last = await prisma.conversationMessage.findFirst({
    where: { conversationId: p.conversationId, role: "assistant" },
    orderBy: { createdAt: "desc" },
    select: { content: true, source: true, createdAt: true },
  });
  if (!last || last.source === "admin" || last.createdAt < pending.createdAt || !CONFIRM_QUESTION.test(last.content.trim())) return false;

  const phone = normalizeIsraeliPhone(p.phone);
  const cust = await prisma.customer.findFirst({ where: { businessId: p.businessId, phone: { in: [phone, phone.replace(/^972/, "0")] }, deletedAt: null }, select: { name: true } });
  const r = await bookConfirmedProposal({
    pending, fallbackName: cust?.name ?? null,
    execTool: (name, input) => execTool(name, input, p.businessId, p.conversationId, p.phone),
  });
  // Something was not booked: a person is already on this chat and sees the "כן".
  if (!r.reply) return false;
  await prisma.conversationMessage.create({ data: { conversationId: p.conversationId, role: "assistant", content: r.reply } });
  await sendMessage({ businessId: p.businessId, customerPhone: p.phone, kind: "agent_reply", body: r.reply });
  return true;
}
