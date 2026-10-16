-- Where a Chator lead came from (16.10.2026): the first-touch utm/fbclid/ref of
-- the sales landing, as JSON. See src/lib/lead-attribution.ts.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS attribution TEXT;
