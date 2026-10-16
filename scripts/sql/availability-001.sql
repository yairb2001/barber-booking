-- Stage B (16.10.2026): a treatment's shape and what each booking recorded.
-- services.segments: JSON [{"m":30,"busy":true},{"m":35,"busy":false},...] —
--   busy false = processing, the staff member is free for someone else.
-- services.buffer_after_min: cleaning after the customer leaves.
-- appointments.busy_segments: JSON [{"o":0,"m":30},{"o":65,"m":30}] — the staff
--   member's busy parts as offsets from the start, recorded at booking time.
--   NULL = busy from start to end (every booking until now).
-- appointments.buffer_after_min: the cleaning recorded with the booking.
ALTER TABLE services ADD COLUMN IF NOT EXISTS segments TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS buffer_after_min INTEGER NOT NULL DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS busy_segments TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS buffer_after_min INTEGER NOT NULL DEFAULT 0;
