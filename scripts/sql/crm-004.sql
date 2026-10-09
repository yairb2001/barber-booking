-- CRM (10.10.2026): one push 10 minutes before each sales call. Additive only.
ALTER TABLE sales_calls ADD COLUMN IF NOT EXISTS reminded_at timestamp(3);
