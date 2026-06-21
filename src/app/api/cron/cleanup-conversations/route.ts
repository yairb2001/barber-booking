import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/cron/cleanup-conversations
// Daily Vercel cron — deletes conversations + their messages with no activity
// in the last 3 days. After that a returning customer starts a fresh chat (the
// agent still recognizes them by phone — name/history/upcoming appointments are
// reloaded from the customer record, only the old chat text is dropped).
export async function GET() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);

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
