/**
 * Customer-agent AI cost metrics for a time window — the same numbers
 * scripts/measure-agent-cost.ts prints, exposed as a function so the owner can
 * see them in the super-admin "עלויות" tab instead of running the script.
 *
 * Read-only. Sources:
 *   agent_usage            kind "customer"   → agent calls (the cost that matters)
 *                          kind "cache_warm" → keep-warm pings (separate, never mixed in)
 *                          kind "sandbox"    → excluded from everything except sandboxCostUsd
 *   appointments           source "agent"    → real bookings the agent made
 *   conversation_messages  tool rows         → what each conversation-episode achieved
 *
 * Episodes: usage rows of one conversationId, split when the gap between two
 * calls exceeds 4h. A "booked" episode has a tool message book_appointment /
 * book_for_customer containing "✅" inside [first call − 15 min, last call + 2 min].
 *
 * conversation_messages older than ~7 days are deleted by a cleanup cron, so
 * episode outcomes are only trustworthy for windows inside the last 7 days —
 * `episodesReliable` says whether this window qualifies.
 */
import { prisma } from "@/lib/prisma";

/** USD per 1M tokens. Unknown models fall back to sonnet (the pricier one). */
const PRICES: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-4-5":  { in: 1.0, out: 5.0,  cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
};
const FALLBACK_MODEL = "claude-sonnet-4-6";
/** A cache write this big means the whole stable prefix was re-written (cold start). */
export const COLD_WRITE_TOKENS = 12_000;
const GAP_MS = 4 * 3600_000;
const EPISODE_LEAD_MS = 15 * 60_000;
const EPISODE_TAIL_MS = 2 * 60_000;
const MESSAGE_RETENTION_MS = 7 * 86400_000;

const BOOKING_TOOLS = ["book_appointment", "book_for_customer"];
const TRACKED_TOOLS = ["get_staff_list", "get_services", "get_available_slots"] as const;
export type TrackedTool = (typeof TRACKED_TOOLS)[number];

export type AgentCostResult = {
  since: string;
  until: string;
  days: number;
  totalCostUsd: number;
  calls: number;
  costPerDay: number;
  coldStarts: number;
  coldStartsPerDay: number;
  /** Where the money goes (USD). coldCost = cache writes ≥ COLD_WRITE_TOKENS. */
  coldCostUsd: number;
  historyWriteCostUsd: number;
  cacheReadCostUsd: number;
  inputCostUsd: number;
  outputCostUsd: number;
  pings: { count: number; costUsd: number; misses: number };
  agentBookings: number;
  /** totalCostUsd / agentBookings — null when the agent booked nothing. */
  costPerBookingAllIn: number | null;
  /** Conversation-episode stats (see header). */
  episodes: number;
  bookedEpisodes: number;
  medianCallsPerBooking: number;
  avgCostPerBookingConversationUsd: number | null;
  /** Total tool calls inside booked episodes, per tool. */
  bookedToolCalls: Record<TrackedTool, number>;
  /** false when the window reaches further back than the message-retention cron keeps. */
  episodesReliable: boolean;
  episodesNote: string | null;
  sandboxCostUsd: number;
};

const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

export async function computeAgentCost(opts: { businessId: string; since: Date; until: Date }): Promise<AgentCostResult> {
  const { businessId, since, until } = opts;

  const [allUsage, agentBookings] = await Promise.all([
    prisma.agentUsage.findMany({
      where: { businessId, kind: { in: ["customer", "cache_warm", "sandbox"] }, createdAt: { gte: since, lte: until } },
      orderBy: { createdAt: "asc" },
      select: {
        kind: true, conversationId: true, model: true,
        inputTokens: true, outputTokens: true, cacheWriteTokens: true, cacheReadTokens: true,
        costUsd: true, createdAt: true,
      },
    }),
    prisma.appointment.count({ where: { businessId, source: "agent", createdAt: { gte: since, lte: until } } }),
  ]);

  const usage = allUsage.filter((u) => u.kind === "customer");
  const pingRows = allUsage.filter((u) => u.kind === "cache_warm");
  const sandboxRows = allUsage.filter((u) => u.kind === "sandbox");

  // ── Cost by component ────────────────────────────────────────────────────
  let coldStarts = 0;
  const comp = { coldWrite: 0, warmWrite: 0, cacheRead: 0, input: 0, output: 0 };
  for (const u of usage) {
    const pr = PRICES[u.model] ?? PRICES[FALLBACK_MODEL];
    const cold = u.cacheWriteTokens >= COLD_WRITE_TOKENS;
    if (cold) coldStarts++;
    const write = (u.cacheWriteTokens * pr.cacheWrite) / 1e6;
    if (cold) comp.coldWrite += write; else comp.warmWrite += write;
    comp.cacheRead += (u.cacheReadTokens * pr.cacheRead) / 1e6;
    comp.input += (u.inputTokens * pr.in) / 1e6;
    comp.output += (u.outputTokens * pr.out) / 1e6;
  }
  const totalCostUsd = usage.reduce((s, u) => s + u.costUsd, 0);
  const days = Math.max(1, Math.round((until.getTime() - since.getTime()) / 86400_000));

  // ── Episodes → booked / not ──────────────────────────────────────────────
  const convIds = Array.from(new Set(usage.map((u) => u.conversationId).filter(Boolean))) as string[];
  const msgs = convIds.length
    ? await prisma.conversationMessage.findMany({
        where: {
          conversationId: { in: convIds },
          role: "tool",
          createdAt: { gte: new Date(since.getTime() - EPISODE_LEAD_MS), lte: new Date(until.getTime() + EPISODE_TAIL_MS) },
        },
        orderBy: { createdAt: "asc" },
        select: { conversationId: true, toolName: true, content: true, createdAt: true },
      })
    : [];
  const msgsBy = new Map<string, typeof msgs>();
  for (const m of msgs) {
    const list = msgsBy.get(m.conversationId);
    if (list) list.push(m); else msgsBy.set(m.conversationId, [m]);
  }
  const usageBy = new Map<string, typeof usage>();
  for (const u of usage) {
    if (!u.conversationId) continue;
    const list = usageBy.get(u.conversationId);
    if (list) list.push(u); else usageBy.set(u.conversationId, [u]);
  }

  type Episode = { calls: number; cost: number; tools: string[]; booked: boolean };
  const episodes: Episode[] = [];
  for (const [id, rows] of Array.from(usageBy.entries())) {
    const chunks: (typeof usage)[] = [];
    let cur: typeof usage = [];
    for (const r of rows) {
      if (cur.length && r.createdAt.getTime() - cur[cur.length - 1].createdAt.getTime() > GAP_MS) { chunks.push(cur); cur = []; }
      cur.push(r);
    }
    if (cur.length) chunks.push(cur);
    for (const chunk of chunks) {
      const t0 = chunk[0].createdAt.getTime() - EPISODE_LEAD_MS;
      const t1 = chunk[chunk.length - 1].createdAt.getTime() + EPISODE_TAIL_MS;
      const ms = (msgsBy.get(id) ?? []).filter((m) => m.createdAt.getTime() >= t0 && m.createdAt.getTime() <= t1);
      episodes.push({
        calls: chunk.length,
        cost: chunk.reduce((s, r) => s + r.costUsd, 0),
        tools: ms.map((m) => m.toolName ?? "?"),
        booked: ms.some((m) => m.toolName && BOOKING_TOOLS.includes(m.toolName) && m.content.includes("✅")),
      });
    }
  }
  const booked = episodes.filter((e) => e.booked);
  const bookedToolCalls = Object.fromEntries(TRACKED_TOOLS.map((t) => [t, 0])) as Record<TrackedTool, number>;
  for (const e of booked) for (const t of e.tools) if ((TRACKED_TOOLS as readonly string[]).includes(t)) bookedToolCalls[t as TrackedTool]++;

  const episodesReliable = Date.now() - since.getTime() <= MESSAGE_RETENTION_MS;

  return {
    since: since.toISOString(),
    until: until.toISOString(),
    days,
    totalCostUsd,
    calls: usage.length,
    costPerDay: totalCostUsd / days,
    coldStarts,
    coldStartsPerDay: coldStarts / days,
    coldCostUsd: comp.coldWrite,
    historyWriteCostUsd: comp.warmWrite,
    cacheReadCostUsd: comp.cacheRead,
    inputCostUsd: comp.input,
    outputCostUsd: comp.output,
    pings: {
      count: pingRows.length,
      costUsd: pingRows.reduce((s, x) => s + x.costUsd, 0),
      misses: pingRows.filter((x) => x.cacheWriteTokens >= COLD_WRITE_TOKENS).length,
    },
    agentBookings,
    costPerBookingAllIn: agentBookings > 0 ? totalCostUsd / agentBookings : null,
    episodes: episodes.length,
    bookedEpisodes: booked.length,
    medianCallsPerBooking: median(booked.map((e) => e.calls)),
    avgCostPerBookingConversationUsd: booked.length ? booked.reduce((s, e) => s + e.cost, 0) / booked.length : null,
    bookedToolCalls,
    episodesReliable,
    episodesNote: episodesReliable
      ? null
      : "הודעות שיחה נמחקות אחרי כ־7 ימים, לכן נתוני האפיזודות (קביעות/קריאות לקביעה) חלקיים בחלון הזה.",
    sandboxCostUsd: sandboxRows.reduce((s, x) => s + x.costUsd, 0),
  };
}
