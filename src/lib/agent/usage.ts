import { prisma } from "@/lib/prisma";

/**
 * Per-business agent usage & cost accounting.
 *
 * Every LLM call writes one AgentUsage row (tokens + computed cost). The
 * super-admin console aggregates these to show, per business, how much of the
 * Anthropic/OpenAI bill each one is responsible for — the raw input for usage
 * quotas (E6) and package pricing (E7).
 *
 * Recording is fire-and-forget and fully guarded: usage accounting must NEVER
 * break or slow the customer-facing agent.
 */

/** USD per 1,000,000 tokens, keyed by the exact model id used in the code.
 *  ⚠️ VERIFY / UPDATE against current provider pricing — these drive the ₪ number. */
const PRICES: Record<
  string,
  { in: number; out: number; cacheWrite: number; cacheRead: number }
> = {
  "claude-haiku-4-5":  { in: 1.0, out: 5.0,  cacheWrite: 1.25, cacheRead: 0.1 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  "gpt-4o":            { in: 2.5, out: 10.0, cacheWrite: 2.5,  cacheRead: 1.25 },
};

/** Raw usage object as returned by either provider — we normalize both shapes. */
export type ProviderUsage = {
  // Anthropic
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  // OpenAI
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
};

export type AgentUsageInput = {
  businessId: string;
  provider: "anthropic" | "openai";
  model: string;
  /** which agent produced it: customer | owner | demo_sales | question_followup */
  kind?: string;
  usage: ProviderUsage | null | undefined;
};

export async function recordAgentUsage(u: AgentUsageInput): Promise<void> {
  try {
    if (!u.usage || !u.businessId) return;

    const input = u.usage.input_tokens ?? u.usage.prompt_tokens ?? 0;
    const output = u.usage.output_tokens ?? u.usage.completion_tokens ?? 0;
    const cacheWrite = u.usage.cache_creation_input_tokens ?? 0;
    const cacheRead =
      u.usage.cache_read_input_tokens ??
      u.usage.prompt_tokens_details?.cached_tokens ??
      0;

    const price = PRICES[u.model];
    let costUsd = 0;
    if (price) {
      if (u.provider === "openai") {
        // OpenAI's prompt_tokens INCLUDES cached tokens — don't double-count.
        const nonCached = Math.max(0, input - cacheRead);
        costUsd =
          (nonCached * price.in + cacheRead * price.cacheRead + output * price.out) /
          1_000_000;
      } else {
        // Anthropic's input_tokens EXCLUDES cached; cache read/write are separate.
        costUsd =
          (input * price.in +
            output * price.out +
            cacheWrite * price.cacheWrite +
            cacheRead * price.cacheRead) /
          1_000_000;
      }
    } else {
      console.warn(`[usage] no price for model=${u.model} — recording tokens with cost 0`);
    }

    await prisma.agentUsage.create({
      data: {
        businessId: u.businessId,
        provider: u.provider,
        model: u.model,
        kind: u.kind ?? null,
        inputTokens: input,
        outputTokens: output,
        cacheWriteTokens: cacheWrite,
        cacheReadTokens: cacheRead,
        costUsd,
      },
    });
  } catch (e) {
    console.error("[usage] failed to record", e);
  }
}
