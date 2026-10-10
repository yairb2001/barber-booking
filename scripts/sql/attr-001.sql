-- Link tag (10.10.2026): keep the ?ref tag (e.g. bio-dominant / bio-yair) on the customer
-- even when they pick "how did you hear about us" by hand. Additive only.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS utm_ref text;
-- Backfill: customers whose display source is still the bio tag itself.
UPDATE customers SET utm_ref = referral_source
 WHERE utm_ref IS NULL AND referral_source LIKE 'bio-%';
