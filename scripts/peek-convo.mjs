import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function withRetry(fn, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
async function main() {
  const msgs = await withRetry(() => prisma.conversationMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { createdAt: true, role: true, content: true, toolName: true, source: true },
  }));
  for (const m of msgs.reverse()) {
    const t = m.createdAt.toISOString().slice(11, 19);
    const c = (m.content || "").replace(/\n/g, " ").slice(0, 90);
    console.log(`${t} [${m.role}${m.toolName ? ":" + m.toolName : ""}${m.source ? "/" + m.source : ""}] ${c}`);
  }
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
