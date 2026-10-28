/** Removes every row a sandbox run left for its throw-away phone (972000…): the
 *  conversation, logs, proposals, and a Customer it may have auto-created, so
 *  nothing fake reaches the CRM. Used by the owner's test route and the check
 *  before "הפעל". */
import { prisma } from "@/lib/prisma";

export async function cleanupSandbox(businessId: string, phone: string) {
  const convs = await prisma.conversation.findMany({ where: { businessId, phone }, select: { id: true } });
  if (convs.length) {
    await prisma.conversationMessage.deleteMany({ where: { conversationId: { in: convs.map(c => c.id) } } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { id: { in: convs.map(c => c.id) } } }).catch(() => {});
  }
  await prisma.messageLog.deleteMany({ where: { businessId, customerPhone: phone } }).catch(() => {});
  await prisma.bookingProposal.deleteMany({ where: { businessId, phone } }).catch(() => {});
  // A sandbox turn may have auto-created a Customer (+ implicit waitlist rows)
  // for the fake phone — remove them too, so nothing fake reaches the CRM.
  const fakeCustomers = await prisma.customer.findMany({ where: { businessId, phone: { in: [phone, phone.replace(/^972/, "0")] } }, select: { id: true } });
  if (fakeCustomers.length) {
    const ids = fakeCustomers.map(c => c.id);
    await prisma.waitlist.deleteMany({ where: { customerId: { in: ids } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: ids }, appointments: { none: {} } } }).catch(() => {});
  }
}
