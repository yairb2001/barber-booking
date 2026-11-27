-- Click-to-WhatsApp ads (27.11.2026): the ad a conversation started from, as GOWA sends it on the first message.
-- JSON: { source: "meta", medium: "ctwa", content: <source_id>, ctwa_clid, headline, ts }. Copied to the booking (appointments.attribution).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ad_referral TEXT;
