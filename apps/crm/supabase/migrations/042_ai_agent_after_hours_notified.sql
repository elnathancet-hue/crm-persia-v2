-- Migration 042: AI Agent after-hours notification dedup (PR-AI-AGENT-HUMAN-C, mai/2026)
--
-- Adds `after_hours_notified_at` to agent_conversations so the executor
-- can avoid sending the same "fora do horário" message every time the
-- lead pings during after-hours.
--
-- Rule (in code): only send after_hours_message when this column is
-- NULL or older than AFTER_HOURS_NOTIFICATION_COOLDOWN_HOURS (= 6).
-- After sending, set column to now(). Next ping within the cooldown is
-- absorbed silently (no reply, no enqueue).
--
-- TIMESTAMPTZ pra preservar timezone (todas as comparacoes feitas em UTC
-- depois do parse no Node).

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS after_hours_notified_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.agent_conversations.after_hours_notified_at IS
  'PR-AI-AGENT-HUMAN-C: timestamp da ultima vez que enviamos after_hours_message nesta conversa. Usado pra dedup (cooldown 6h). NULL = nunca notificado.';

-- Rollback (manual):
--   ALTER TABLE public.agent_conversations DROP COLUMN IF EXISTS after_hours_notified_at;
