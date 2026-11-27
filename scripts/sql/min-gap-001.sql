-- The least days between two of the same treatment (27.11.2026). Additive.
ALTER TABLE services ADD COLUMN IF NOT EXISTS min_gap_days INTEGER;
