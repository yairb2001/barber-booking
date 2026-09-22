/**
 * Keep the customer agent's prompt cache warm.
 *
 * Why: the cached prefix (tools + stable prompt, ~20K tokens) lives 1h. Measured
 * 1–20.9.2026 on DOMINANT: cold re-writes were 59% of all agent spend, and they
 * happen in the 60–100 min gaps between conversations. A ping that merely READS
 * the prefix refreshes the TTL for $0.006 instead of the $0.08 cold write the
 * next customer would pay. Simulated on the same traffic: 3.9 → 1.3 cold starts
 * per day at ~10 pings/day. Zero behavior change — no customer sees anything.
 *
 * Rules (run every minute from the drip-queue tick):
 *   - only businesses with REAL customer-agent traffic in the last 4h (a shop
 *     that is quiet for an afternoon just takes one cold start later);
 *   - only 07:00–23:00 Israel time;
 *   - ping when the last activity (customer call or ping) was 50–59 min ago —
 *     the cache is still alive, and this is the last chance to extend it.
 * Every ping is an agent_usage row (kind "cache_warm"), so it shows in the cost
 * dashboard and counts as activity for the next tick.
 */
import { prisma } from "@/lib/prisma";
import { warmCustomerAgentCache } from "@/lib/agent/customer-agent";
import { getBusinessNow } from "@/lib/utils";

const PING_AFTER_MS = 50 * 60_000;
const TTL_MS = 60 * 60_000;
const REAL_TRAFFIC_WINDOW_MS = 4 * 3600_000;
const HOUR_FROM = 7, HOUR_TO = 23;

export async function keepAgentCachesWarm(now = new Date()): Promise<{ pinged: string[]; misses: string[] }> {
  const out = { pinged: [] as string[], misses: [] as string[] };
  const hour = Math.floor(getBusinessNow().minutes / 60);
  if (hour < HOUR_FROM || hour >= HOUR_TO) return out;

  const recent = await prisma.agentUsage.groupBy({
    by: ["businessId", "kind"],
    where: { provider: "anthropic", kind: { in: ["customer", "cache_warm"] }, createdAt: { gte: new Date(now.getTime() - REAL_TRAFFIC_WINDOW_MS) } },
    _max: { createdAt: true },
  });
  const byBiz = new Map<string, { real?: Date; any?: Date }>();
  for (const r of recent) {
    const v = byBiz.get(r.businessId) ?? {};
    const at = r._max.createdAt ?? undefined;
    if (r.kind === "customer") v.real = at;
    if (at && (!v.any || at > v.any)) v.any = at;
    byBiz.set(r.businessId, v);
  }
  // Opt-in per business (settings.agentKeepWarm). The cache is per business, so
  // pings never pay off across tenants — only inside a shop with ~1+ conversation
  // an hour. At a single shop's volume it is break-even at best (owner's call,
  // 22.9.2026), so it is OFF unless the business turns it on.
  const optedIn = new Set<string>();
  if (byBiz.size) {
    const rows = await prisma.business.findMany({ where: { id: { in: Array.from(byBiz.keys()) } }, select: { id: true, settings: true } });
    for (const b of rows) { try { if (b.settings && JSON.parse(b.settings).agentKeepWarm === true) optedIn.add(b.id); } catch { /* ignore */ } }
  }
  for (const [businessId, v] of Array.from(byBiz.entries())) {
    if (!optedIn.has(businessId)) continue;
    if (!v.real || !v.any) continue;
    const idle = now.getTime() - v.any.getTime();
    if (idle < PING_AFTER_MS || idle >= TTL_MS) continue;
    try {
      const res = await warmCustomerAgentCache(businessId);
      if (!res) continue;
      if (res.cacheRead > res.cacheWrite) out.pinged.push(businessId);
      else { out.misses.push(businessId); console.warn(`[cache-warm] MISS for ${businessId}: wrote ${res.cacheWrite}, read ${res.cacheRead} — TTL not refreshed by reads?`); }
    } catch (err) { console.error("[cache-warm] ping failed", businessId, err); }
  }
  return out;
}
