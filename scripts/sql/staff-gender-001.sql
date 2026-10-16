-- Each team member's gender (16.10.2026, Yair: "בצוות צריך לסמן אם זה זכר או
-- נקבה"): 'm' | 'f'; NULL = the business's default (its type / its own words).
-- Drives the words about that person (פעיל/פעילה, אישר/אישרה, אני נאלץ/נאלצת).
ALTER TABLE staff ADD COLUMN IF NOT EXISTS gender TEXT;
