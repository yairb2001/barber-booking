-- CRM (10.10.2026): plans by appointments a month, add-on packs, invoices, billing provider events. Additive only.
CREATE TABLE IF NOT EXISTS crm_plans (
  key text PRIMARY KEY, name text NOT NULL, appts_cap integer NOT NULL, messages integer NOT NULL,
  ai_budget_ils integer NOT NULL, price_ils integer NOT NULL, sort integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true, updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS crm_packs (
  id text PRIMARY KEY, business_id text NOT NULL, kind text NOT NULL, qty integer NOT NULL,
  price_ils integer NOT NULL, month text NOT NULL, note text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS crm_packs_business_id_month_idx ON crm_packs (business_id, month);

CREATE TABLE IF NOT EXISTS crm_invoices (
  id text PRIMARY KEY, business_id text NOT NULL, number text, issued_at timestamp(3) NOT NULL,
  amount_ils double precision NOT NULL, status text NOT NULL DEFAULT 'paid', pdf_url text,
  provider text NOT NULL DEFAULT 'manual', provider_id text, sent_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS crm_invoices_business_id_issued_at_idx ON crm_invoices (business_id, issued_at);

CREATE TABLE IF NOT EXISTS crm_billing_events (
  id text PRIMARY KEY, provider text NOT NULL, business_id text, kind text NOT NULL, payload text NOT NULL,
  ok boolean, handled boolean NOT NULL DEFAULT false, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS crm_billing_events_created_at_idx ON crm_billing_events (created_at);
