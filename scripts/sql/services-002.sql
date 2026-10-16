-- Beauty businesses (16.10.2026): a category per service (ידיים, רגליים, צבע…)
-- and a "from" price for treatments whose final price is set at a
-- consultation (balayage, extensions). Additive; existing rows unchanged.
ALTER TABLE services ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS price_from BOOLEAN NOT NULL DEFAULT false;
