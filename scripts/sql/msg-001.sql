-- Message diet (10.10.2026): customers who installed the shop's app get push instead of WhatsApp. Additive only.
CREATE TABLE IF NOT EXISTS customer_push_subs (
  id text PRIMARY KEY, business_id text NOT NULL, customer_id text NOT NULL, endpoint text NOT NULL,
  p256dh text NOT NULL, auth text NOT NULL, base_path text NOT NULL DEFAULT '',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, last_ok_at timestamp(3));
CREATE UNIQUE INDEX IF NOT EXISTS customer_push_subs_endpoint_key ON customer_push_subs (endpoint);
CREATE INDEX IF NOT EXISTS customer_push_subs_business_id_customer_id_idx ON customer_push_subs (business_id, customer_id);
