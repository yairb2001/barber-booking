-- An intro price for one barber (22.11.2026, Yair: ליעם 90 מחוק, 70, "מחיר היכרות").
-- original_price = the price shown struck through next to custom_price.
-- NULL = no intro price, the booking page shows custom_price as usual.
ALTER TABLE staff_services ADD COLUMN IF NOT EXISTS original_price DOUBLE PRECISION;
