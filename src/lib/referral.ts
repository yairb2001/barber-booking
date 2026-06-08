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
};

export const REFERRAL_DEFAULTS: ReferralConfig = {
  enabled: true, // backward-compatible: the program already exists in production
  goal: 3,
  giftLabel: "תספורת חינם",
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

  return {
    // default ON — only an explicit `false` disables it
    enabled: s.referralProgramEnabled !== false,
    goal: goalNum > 0 ? Math.round(goalNum) : REFERRAL_DEFAULTS.goal,
    giftLabel: gift || REFERRAL_DEFAULTS.giftLabel,
  };
}
