-- Notification center + the agent that learns (10.10.2026). Additive only.
CREATE TABLE IF NOT EXISTS business_notifications (
  id text PRIMARY KEY, business_id text NOT NULL, staff_id text, kind text NOT NULL,
  title text NOT NULL, body text, href text, meta text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, read_at timestamp(3), done_at timestamp(3));
CREATE INDEX IF NOT EXISTS business_notifications_business_id_created_at_idx ON business_notifications (business_id, created_at);

CREATE TABLE IF NOT EXISTS agent_questions (
  id text PRIMARY KEY, business_id text NOT NULL, conversation_id text, customer_phone text NOT NULL, customer_name text,
  question text NOT NULL, status text NOT NULL DEFAULT 'open', answer text, answered_by text, answered_at timestamp(3),
  faq_id text, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS agent_questions_business_id_status_idx ON agent_questions (business_id, status);

CREATE TABLE IF NOT EXISTS agent_feedback (
  id text PRIMARY KEY, business_id text NOT NULL, staff_id text, author text, conversation_id text,
  text text NOT NULL, status text NOT NULL DEFAULT 'new', review_note text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at timestamp(3));
CREATE INDEX IF NOT EXISTS agent_feedback_business_id_status_idx ON agent_feedback (business_id, status);

CREATE TABLE IF NOT EXISTS agent_improvements (
  id text PRIMARY KEY, business_id text NOT NULL, source text NOT NULL, kind text NOT NULL,
  title text NOT NULL, proposal text NOT NULL, evidence text, target_key text,
  status text NOT NULL DEFAULT 'pending', created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at timestamp(3), decided_by text);
CREATE INDEX IF NOT EXISTS agent_improvements_status_created_at_idx ON agent_improvements (status, created_at);
CREATE INDEX IF NOT EXISTS agent_improvements_business_id_idx ON agent_improvements (business_id);
