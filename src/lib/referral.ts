/**
 * Shared helpers for the "חבר מביא חבר" (friend-brings-friend) referral program.
 *
 * Config lives in Business.settings JSON:
 *   referralProgramEnabled : boolean  — master on/off switch (default ON)
 *   referralGoal           : number   — how many referrals = a gift (the "X" in 1/X)
 *   referralGiftLabel      : string   — what the customer earns at the goal
 *   referralSources        : string[] — the owner-editable "how did you hear?" list
 *   referralFriendSource   : string   — which source opens the friend picker
 *
 * The friend-referral SOURCE is owner-configurable (they can rename it). We
 * resolve it via getReferralFriendSource() rather than hardcoding a string, so
 * renaming "חבר הביא חבר" → "המלצה של חבר" doesn't break the reward flow.
 */

// Legacy default — kept for backward-compat with existing customer rows.
export const REFERRAL_SOURCE = "חבר הביא חבר";

export const DEFAULT_REFERRAL_SOURCES = [
  "אינסטגרם", "פייסבוק", "טיקטוק", "גוגל", "חבר הביא חבר", "הגעתי מהרחוב", "אחר",
];

function parseSettings(settings: string | Record<string, unknown> | null | undefined): Record<string, unknown> {
  try {
    if (typeof settings === "string") return settings ? JSON.parse(settings) : {};
    if (settings && typeof settings === "object") return settings;
  } catch { /* ignore */ }
  return {};
}

/** The owner-editable "how did you hear about us?" options. */
export function getReferralSources(settings: string | Record<string, unknown> | null | undefined): string[] {
  const s = parseSettings(settings);
  if (Array.isArray(s.referralSources) && s.referralSources.length > 0) {
    return s.referralSources.map(x => String(x));
  }
  return DEFAULT_REFERRAL_SOURCES;
}

/**
 * Pick which source opens the friend picker, given the list and an optional
 * explicit choice:
 *   1. An explicit choice that still exists in the list, else
 *   2. heuristically the first source mentioning a friend/recommendation, else
 *   3. null — no friend source (picker simply won't show).
 */
export function pickFriendSource(sources: string[], explicit?: string | null): string | null {
  const want = (explicit || "").trim();
  if (want && sources.includes(want)) return want;
  const match = sources.find(src => src.includes("חבר") || src.includes("המלצה") || src.includes("המליץ"));
  return match || null;
}

/**
 * Resolve which referral source opens the friend picker from Business.settings.
 */
export function getReferralFriendSource(settings: string | Record<string, unknown> | null | undefined): string | null {
  const s = parseSettings(settings);
  const explicit = typeof s.referralFriendSource === "string" ? s.referralFriendSource : "";
  return pickFriendSource(getReferralSources(settings), explicit);
}

export type ReferralConfig = {
  enabled: boolean;
  goal: number;
  giftLabel: string;
  // ── Optional second tier ──────────────────────────────────────────────────
  // A bigger milestone with its own (usually bigger) reward — e.g. goal=3 →
  // a product, goal2=6 → a product + a free haircut. null = no second tier;
  // the program stays a single milestone that repeats (goal, 2×goal, 3×goal…
  // each earning another `giftLabel`), exactly like before this existed.
  goal2: number | null;
  giftLabel2: string | null;
};

export const REFERRAL_DEFAULTS: ReferralConfig = {
  enabled: true, // backward-compatible: the program already exists in production
  goal: 3,
  giftLabel: "תספורת חינם",
  goal2: null,
  giftLabel2: null,
};

/**
 * Resolve the referral config from a Business.settings value.
 * Accepts the raw JSON string, an already-parsed object, or null/undefined.
 */
export function getReferralConfig(settings: string | Record<string, unknown> | null | undefined): ReferralConfig {
  let s: Record<string, unknown> = {};
  try {
    if (typeof settings === "string") s = settings ? JSON.parse(settings) : {};
    else if (settings && typeof settings === "object") s = settings;
  } catch {
    return { ...REFERRAL_DEFAULTS };
  }

  const goalNum = Number(s.referralGoal);
  const gift = typeof s.referralGiftLabel === "string" ? s.referralGiftLabel.trim() : "";
  const goal = goalNum > 0 ? Math.round(goalNum) : REFERRAL_DEFAULTS.goal;

  const goal2Num = Number(s.referralGoal2);
  const gift2 = typeof s.referralGiftLabel2 === "string" ? s.referralGiftLabel2.trim() : "";

  return {
    // default ON — only an explicit `false` disables it
    enabled: s.referralProgramEnabled !== false,
    goal,
    giftLabel: gift || REFERRAL_DEFAULTS.giftLabel,
    // Tier 2 only exists if it's a real number STRICTLY past tier 1 — a bad/
    // equal value silently falls back to "no second tier" rather than erroring.
    goal2: goal2Num > goal ? Math.round(goal2Num) : null,
    giftLabel2: gift2 || null,
  };
}

/** How many reward tiers (0, 1, or 2) a referral count has actually unlocked. */
export function tiersUnlockedFor(count: number, config: ReferralConfig): number {
  if (config.goal2) {
    if (count >= config.goal2) return 2;
    if (count >= config.goal) return 1;
    return 0;
  }
  // Legacy: no second tier configured — the single milestone repeats forever.
  return Math.floor(count / config.goal);
}

export type ReferralProgress = { goal: number; giftLabel: string; reached: boolean };

/**
 * The CURRENT milestone a referrer is working toward (or has just reached) —
 * for the customer-facing progress meter. Once tier 1 is reached and a tier 2
 * is configured, this switches to describing tier 2 instead; businesses
 * without a tier 2 keep the exact old single-milestone framing.
 */
export function getReferralProgress(count: number, config: ReferralConfig): ReferralProgress {
  if (config.goal2) {
    if (count < config.goal) return { goal: config.goal, giftLabel: config.giftLabel, reached: false };
    return { goal: config.goal2, giftLabel: config.giftLabel2 || config.giftLabel, reached: count >= config.goal2 };
  }
  return { goal: config.goal, giftLabel: config.giftLabel, reached: count >= config.goal };
}
