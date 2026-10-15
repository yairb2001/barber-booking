-- Shops' requests to Chator: what's missing or what to change, written or
-- recorded (15.10.2026, Yair: "צאט של בקשות... עוברים על זה כל יום").
-- One thread per business; Chator answers in it. Additive.
CREATE TABLE IF NOT EXISTS shop_requests (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  from_chator BOOLEAN NOT NULL DEFAULT false,
  staff_id    TEXT,
  author_name TEXT,
  body        TEXT,
  audio_url   TEXT,
  audio_secs  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at     TIMESTAMPTZ,
  done_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS shop_requests_business_idx ON shop_requests (business_id, created_at);
CREATE INDEX IF NOT EXISTS shop_requests_unseen_idx ON shop_requests (from_chator, seen_at);
