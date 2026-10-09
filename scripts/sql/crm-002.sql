-- CRM ops (10.10.2026): notes on a customer (business), and the history of a shop's agent setup answers. Additive.
ALTER TABLE lead_notes ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS business_id text;
CREATE INDEX IF NOT EXISTS lead_notes_business_id_idx ON lead_notes(business_id);
CREATE TABLE IF NOT EXISTS agent_setup_history (
  id text PRIMARY KEY, business_id text NOT NULL, config text NOT NULL, author text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS agent_setup_history_business_id_idx ON agent_setup_history(business_id, created_at);
