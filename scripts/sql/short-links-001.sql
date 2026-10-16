-- Short links in WhatsApp messages (16.10.2026, Yair: "צמצם את הלינק הארוך
-- הזה ואם יש עוד לינקים ארוכים צמצם אותם"). /s/<code> redirects to `url`.
-- Written by src/lib/short-links.ts when a message is delivered.
CREATE TABLE IF NOT EXISTS short_links (
  code        TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  business_id TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
