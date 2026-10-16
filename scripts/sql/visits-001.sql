-- Visits (16.10.2026, Yair: "אם היא רוצה לעשות כמה טיפולים הסוכן צריך למצוא לה
-- מתי ואיך היא יכולה לקבוע הכל יחד אחד אחרי השני"; "לאפסייל ... לשריין לה
-- אצל הנותנת שירות השניה לק").
-- appointments.visit_id: the treatments of one visit, booked together.
-- services.upsell_ids: JSON array of service ids the agent offers right after.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS visit_id TEXT;
CREATE INDEX IF NOT EXISTS appointments_visit_id_idx ON appointments(visit_id);
ALTER TABLE services ADD COLUMN IF NOT EXISTS upsell_ids TEXT;
