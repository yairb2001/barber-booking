-- Which conversation a proposal came from, so the CRM opens it with one tap
-- (15.10.2026, Yair: "בלחיצה שם שזה יפתח לי את השיחה הספציפית"). Additive.
ALTER TABLE agent_improvements ADD COLUMN IF NOT EXISTS conversation_id text;
