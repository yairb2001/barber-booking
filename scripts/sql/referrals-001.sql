-- Chator "חבר מביא חבר" (11.10.2026): a shop that brings another shop gets a
-- free month once the friend starts paying. Additive only.
CREATE TABLE IF NOT EXISTS business_referrals (
  id           TEXT PRIMARY KEY,
  referrer_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  referred_id  TEXT NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  source       TEXT NOT NULL DEFAULT 'link',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  rewarded_at  TIMESTAMPTZ,
  applied_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS business_referrals_referrer_idx ON business_referrals (referrer_id);
