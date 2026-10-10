-- One agent run per conversation at a time (10.10.2026: a second message while the agent was
-- still answering the first ended in the error fallback, 6 times on 8–9.10). Additive only.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS agent_lock_at timestamp(3);
