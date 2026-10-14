-- Questions Chator's own agent could not answer a customer (14.10.2026, Yair:
-- "אם הסוכן יודע הוא עוזר, אם לא שואל אותי ונהפוך לכלל"). Additive.
CREATE TABLE IF NOT EXISTS chator_questions (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  phone           TEXT NOT NULL,
  business_id     TEXT,
  stage           TEXT NOT NULL,
  question        TEXT NOT NULL,
  answer          TEXT,
  saved_as_rule   BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS chator_questions_status_idx ON chator_questions (status, created_at);
