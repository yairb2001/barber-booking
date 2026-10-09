-- CRM (10.10.2026): call availability per specific date (the week changes every week),
-- the CRM's notifications feed and its own task list. Additive only.
CREATE TABLE IF NOT EXISTS rep_date_windows (
  id text PRIMARY KEY, rep_id text NOT NULL, date date NOT NULL,
  start_time text NOT NULL, end_time text NOT NULL);
CREATE INDEX IF NOT EXISTS rep_date_windows_rep_id_date_idx ON rep_date_windows (rep_id, date);

CREATE TABLE IF NOT EXISTS crm_notifications (
  id text PRIMARY KEY, kind text NOT NULL, title text NOT NULL, body text, href text,
  lead_id text, business_id text, rep_id text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, read_at timestamp(3));
CREATE INDEX IF NOT EXISTS crm_notifications_created_at_idx ON crm_notifications (created_at);

CREATE TABLE IF NOT EXISTS crm_tasks (
  id text PRIMARY KEY, title text NOT NULL, due_at timestamp(3),
  lead_id text, business_id text, rep_id text, done_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS crm_tasks_done_at_due_at_idx ON crm_tasks (done_at, due_at);
