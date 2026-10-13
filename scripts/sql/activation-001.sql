-- The free month counts from activation, not from signup (Yair, 13.10.2026:
-- "ברגע שהוא לחץ על הכפתור הפעל זה סופר חודש"). Additive. Every existing shop
-- counts as activated already (its month was already running), so nothing
-- changes for them.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
UPDATE businesses SET activated_at = COALESCE(onboarding_completed_at, created_at) WHERE activated_at IS NULL;
