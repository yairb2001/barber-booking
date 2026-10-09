-- CRM (9.10.2026): lead pipeline columns + sales reps, windows, calls, notes, automations, settings. Additive only.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS crm_stage text NOT NULL DEFAULT 'new';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rep_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_at timestamp(3);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS opted_out boolean NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_inbound_at timestamp(3);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS shop_size text;

CREATE TABLE IF NOT EXISTS sales_reps (
  id text PRIMARY KEY, name text NOT NULL, phone text, active boolean NOT NULL DEFAULT true,
  is_owner boolean NOT NULL DEFAULT false, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS rep_windows (
  id text PRIMARY KEY, rep_id text NOT NULL, day_of_week integer NOT NULL, start_time text NOT NULL, end_time text NOT NULL);
CREATE INDEX IF NOT EXISTS rep_windows_rep_id_idx ON rep_windows(rep_id);
CREATE TABLE IF NOT EXISTS rep_days_off (
  id text PRIMARY KEY, rep_id text NOT NULL, date date NOT NULL, note text);
CREATE UNIQUE INDEX IF NOT EXISTS rep_days_off_rep_id_date_key ON rep_days_off(rep_id, date);
CREATE TABLE IF NOT EXISTS sales_calls (
  id text PRIMARY KEY, lead_id text NOT NULL, rep_id text NOT NULL, starts_at timestamp(3) NOT NULL,
  duration_min integer NOT NULL DEFAULT 10, status text NOT NULL DEFAULT 'booked', outcome text,
  booked_by text NOT NULL DEFAULT 'agent', notes text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS sales_calls_rep_id_starts_at_idx ON sales_calls(rep_id, starts_at);
CREATE INDEX IF NOT EXISTS sales_calls_lead_id_idx ON sales_calls(lead_id);
CREATE TABLE IF NOT EXISTS lead_notes (
  id text PRIMARY KEY, lead_id text NOT NULL, author text NOT NULL, body text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS lead_notes_lead_id_idx ON lead_notes(lead_id);
CREATE TABLE IF NOT EXISTS crm_automations (
  id text PRIMARY KEY, key text NOT NULL, name text NOT NULL, trigger text NOT NULL,
  enabled boolean NOT NULL DEFAULT false, steps text NOT NULL, stop_on text NOT NULL DEFAULT '[]',
  audience text NOT NULL DEFAULT 'lead',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX IF NOT EXISTS crm_automations_key_key ON crm_automations(key);
CREATE TABLE IF NOT EXISTS crm_automation_runs (
  id text PRIMARY KEY, automation_id text NOT NULL, lead_id text, business_id text,
  step_index integer NOT NULL DEFAULT 0, next_at timestamp(3), status text NOT NULL DEFAULT 'active',
  stop_reason text, context text,
  started_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS crm_automation_runs_status_next_at_idx ON crm_automation_runs(status, next_at);
CREATE INDEX IF NOT EXISTS crm_automation_runs_lead_id_idx ON crm_automation_runs(lead_id);
CREATE TABLE IF NOT EXISTS crm_settings (key text PRIMARY KEY, value text NOT NULL);
