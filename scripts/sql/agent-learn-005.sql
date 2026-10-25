-- A report from inside a chat points at the agent's message it is about (25.10.2026,
-- Yair: "שכל עסק יוכל בתוך הצ'אטים לדווח על הצ'אט הספציפי ... מה לא היה בסדר במה
-- שהסוכן אמר"). Null for reports written in the agent tab. Additive.
ALTER TABLE agent_feedback ADD COLUMN IF NOT EXISTS message_id text;
