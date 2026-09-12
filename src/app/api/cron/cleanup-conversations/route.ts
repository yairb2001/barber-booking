import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

// GET /api/cron/cleanup-conversations
// Daily Vercel cron — deletes conversations + their messages with no activity
// in the last 90 days. The admin inbox and the customer card link to the chat
// history, so it is kept for a season; the agent itself only reads the last
// MAX_HISTORY messages within its own recency window, so a long-lived thread
// does not grow its prompt.
export async function GET(req: NextRequest) {
  const guard = assertCron(req);
  if (guard) return guard;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

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
