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
  // most recently active conversation
  const conv = await withRetry(() => prisma.conversation.findFirst({
    where: { businessId: BIZ_ID },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true, whatsappName: true },
  }));
  console.log("CONV:", conv.whatsappName, conv.id.slice(0,8), "\n");
  const msgs = await withRetry(() => prisma.conversationMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
    take: 60,
    select: { createdAt: true, role: true, content: true, toolName: true },
  }));
  for (const m of msgs) {
    const t = m.createdAt.toISOString().slice(11,19);
    if (m.role === "tool") {
      console.log(`  ${t} 🔧 ${m.toolName}: ${(m.content||"").replace(/\n/g," ").slice(0,120)}`);
    } else {
      const who = m.role === "user" ? "👤 לקוח" : "🤖 סוכן";
      console.log(`${t} ${who}: ${(m.content||"").replace(/\n/g," ")}`);
    }
  }
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
