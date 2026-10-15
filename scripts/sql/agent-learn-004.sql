-- Manual reports only, merged (15.10.2026, Yair: "אני רוצה לקבל בסך הכל תקלות שאנשים
-- מדווחים עליהם בצורה ידנית, ואם הן דומות לתקלות שקיימות כבר, אז הן גם מתאחדות").
-- Every report behind one proposal, JSON: [{at, source, businessId, businessName, author, text, evidence, conversationId}].
-- A proposal folded into another gets status 'merged'. Additive.
ALTER TABLE agent_improvements ADD COLUMN IF NOT EXISTS reports text;
