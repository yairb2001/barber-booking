import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const BIZ_ID = "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2";
async function withRetry(fn, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
async function main() {
  const cfg = await withRetry(() => prisma.agentConfig.findUnique({
    where: { businessId: BIZ_ID },
    select: { escalateAfterMessages: true },
  }));
  console.log("escalateAfterMessages =", cfg?.escalateAfterMessages);

  const convs = await withRetry(() => prisma.conversation.findMany({
    where: { businessId: BIZ_ID },
    orderBy: { lastMessageAt: "desc" },
    take: 5,
    select: { id: true, whatsappName: true, escalatedAt: true, lastMessageAt: true,
      _count: { select: { messages: true } } },
  }));
  for (const c of convs) {
    const esc = c.escalatedAt ? "ESCALATED " + c.escalatedAt.toISOString().slice(11,19) : "active";
    console.log(`conv ${c.id.slice(0,8)} name=${c.whatsappName||"?"} msgs=${c._count.messages} ${esc} last=${c.lastMessageAt?.toISOString().slice(11,19)}`);
  }
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
