import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const bizId = "c8e1ac89-32d1-4e00-b493-2e95aef4d8f2";

const convos = await prisma.conversation.findMany({
  where: { businessId: bizId, escalatedAt: { not: null } },
  orderBy: { escalatedAt: "desc" },
  take: 2,
  select: { id: true, phone: true, whatsappName: true, escalatedAt: true },
});
console.log("escalated conversations found:", convos.length);
for (const c of convos) {
  console.log(`\n\n========== ${c.whatsappName || c.phone} — escalated ${c.escalatedAt.toISOString()} ==========`);
  const msgs = await prisma.conversationMessage.findMany({
    where: { conversationId: c.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, toolName: true, createdAt: true },
  });
  for (const m of msgs) {
    const t = m.createdAt.toISOString().slice(11, 19);
    const tag = m.role === "tool" ? `TOOL[${m.toolName}]` : m.role.toUpperCase();
    console.log(`[${t} UTC] ${tag}: ${(m.content ?? "").replace(/\s+/g, " ").slice(0, 400)}`);
  }
}
await prisma.$disconnect();
