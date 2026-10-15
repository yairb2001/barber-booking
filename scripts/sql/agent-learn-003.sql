-- The fix agent (15.10.2026, Yair: "כל הצעה מלבד להחליף מילה או 2 צריכה לעבור אצל
-- סוכן ai פה במחשב שמבין שאסור לנפח פרומטים"). Yair's words to the agent, the fix it
-- prepared (JSON: summary, before/after, prompt size, plan) and when. Additive.
-- Statuses now: pending → queued → review → publish → applied (| question | rejected).
ALTER TABLE agent_improvements ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE agent_improvements ADD COLUMN IF NOT EXISTS fix text;
ALTER TABLE agent_improvements ADD COLUMN IF NOT EXISTS fix_at timestamp(3);
