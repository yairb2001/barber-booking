import { prisma } from "@/lib/prisma";

/**
 * Burst coalescing + one agent run per chat at a time (10.10.2026).
 * People often send "היי יש תור היום?" and, seconds later, "או מחר" — wait a
 * short grace period; if a newer message arrived meanwhile this request yields
 * (null) and the last webhook in the burst answers everything. A message that
 * lands while the agent is still answering waits for that run (≤20s; the
 * webhook has 60s in all), then answers whatever is still unanswered.
 * Returns the lock's release function, or null when a newer message took over.
 */
export async function takeAgentTurn(convId: string, since: Date): Promise<(() => Promise<unknown>) | null> {
  await new Promise(r => setTimeout(r, 4000));
  const newer = () => prisma.conversationMessage.findFirst({ where: { conversationId: convId, role: "user", createdAt: { gt: since } }, select: { id: true } });
  if (await newer()) return null;
  let locked = false;
  for (let i = 0; i < 20 && !locked; i++) {
    const n = await prisma.$executeRaw`UPDATE conversations SET agent_lock_at = now() WHERE id = ${convId} AND (agent_lock_at IS NULL OR agent_lock_at < now() - interval '90 seconds')`;
    if (n > 0) locked = true; else await new Promise(r => setTimeout(r, 1000));
  }
  const release = () => (locked ? prisma.$executeRaw`UPDATE conversations SET agent_lock_at = NULL WHERE id = ${convId}`.catch(() => 0) : Promise.resolve(0));
  if (locked && await newer()) { await release(); return null; }
  return release;
}
