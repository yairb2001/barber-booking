import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/cron/cleanup-conversations
// Daily Vercel cron — deletes conversations + their messages older than 7 days
// (no message activity since). Keeps the DB lean.
export async function GET() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  // Find old conversations
  const oldConvs = await prisma.conversation.findMany({
    where: {
      OR: [
        { lastMessageAt: { lt: cutoff } },
        { lastMessageAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
  });
  const ids = oldConvs.map(c => c.id);

  if (ids.length === 0) return NextResponse.json({ deleted: 0 });

  await prisma.$transaction([
    prisma.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } }),
    prisma.conversation.deleteMany({ where: { id: { in: ids } } }),
  ]);

  return NextResponse.json({ deleted: ids.length });
}
