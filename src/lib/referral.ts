/**
 * Shared helpers for the "חבר מביא חבר" (friend-brings-friend) referral program.
 *
 * Config lives in Business.settings JSON:
 *   referralProgramEnabled : boolean  — master on/off switch (default ON)
 *   referralGoal           : number   — how many referrals = a gift (the "X" in 1/X)
 *   referralGiftLabel      : string   — what the customer earns at the goal
 *
 * The canonical referral-SOURCE string that triggers the friend picker is
 * "חבר הביא חבר" (matches the default in /api/referral-sources). Keep this in
 * sync with that list — existing customer rows store this exact string.
 */

export const REFERRAL_SOURCE = "חבר הביא חבר";

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
