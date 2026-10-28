-- מקור לכל תור מהאתר (28.10.2026, מנהל השיווק ויאיר): utm, ref ו־fbclid של הביקור שבו נקבע, כ־JSON.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS attribution TEXT;
