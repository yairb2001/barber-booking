import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const biz = await prisma.business.findFirst({ where: { name: "dominant" }, select: { id: true } });
// find the most recent message across all conversations
const latest = await prisma.conversationMessage.findFirst({
  where: { conversation: { businessId: biz.id } },
  orderBy: { createdAt: "desc" },
  select: { conversationId: true, createdAt: true },
});
if (!latest) { console.log("no messages found"); await prisma.$disconnect(); process.exit(0); }
const conv = await prisma.conversation.findUnique({ where: { id: latest.conversationId }, select: { id: true, phone: true } });
console.log("conversation:", conv.id, "phone:", conv.phone, "latest msg:", latest.createdAt.toLocaleString("he-IL"));
const msgs = await prisma.conversationMessage.findMany({
  where: { conversationId: conv.id },
  orderBy: { createdAt: "desc" },
  take: 30,
  select: { role: true, content: true, toolName: true, createdAt: true },
});
msgs.reverse();
console.log("\n=== last", msgs.length, "messages (chronological) ===");
for (const m of msgs) {
  const t = m.createdAt.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const tag = m.role === "tool" ? `TOOL[${m.toolName}]` : m.role.toUpperCase();
  const body = (m.content ?? "").replace(/\s+/g, " ").slice(0, 500);
  console.log(`\n[${t}] ${tag}: ${body}`);
}
await prisma.$disconnect();
