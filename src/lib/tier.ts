/**
 * Subscription tiers (see BUSINESS_CONTEXT.md).
 *
 *   basic   ₪99  — booking + admin + SMS confirmations
 *   pro     ₪199 — + WhatsApp from a SHARED platform number (Meta Cloud, future)
 *   premium ₪399 — + WhatsApp from the SHOP'S OWN number (GreenAPI) + AI agent
 *
 * `tier` is a column on Business. Use tierHas() to gate features at runtime.
 * Note: a higher tier does NOT block booking — every tier can take appointments
 * immediately. Tiers only gate the messaging channel and the AI agent.
 */

export type Tier = "basic" | "pro" | "premium";

export type TierFeature = "sms" | "sharedWhatsapp" | "ownWhatsapp" | "aiAgent";

export const TIER_FEATURES: Record<Tier, Record<TierFeature, boolean>> = {
  basic:   { sms: true, sharedWhatsapp: false, ownWhatsapp: false, aiAgent: false },
  pro:     { sms: true, sharedWhatsapp: true,  ownWhatsapp: false, aiAgent: false },
  premium: { sms: true, sharedWhatsapp: true,  ownWhatsapp: true,  aiAgent: true  },
};

function normalizeTier(tier: string | null | undefined): Tier {
  return tier === "pro" || tier === "premium" ? tier : "basic";
}

/** Does the given tier include the requested feature? */
export function tierHas(tier: string | null | undefined, feature: TierFeature): boolean {
  return TIER_FEATURES[normalizeTier(tier)][feature];
}

/** Human-readable Hebrew label for a tier (for UI). */
export function tierLabel(tier: string | null | undefined): string {
  switch (normalizeTier(tier)) {
    case "premium": return "פרימיום";
    case "pro": return "פרו";
    default: return "בייסיק";
  }
}
