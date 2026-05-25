-- ============================================================
-- MIGRATION 067: AI Agent outbound send guard epoch
-- ------------------------------------------------------------
-- Adds a monotonic control epoch to agent_conversations.
--
-- Why:
--   An AI run can start while the conversation belongs to the bot, then finish
--   after a human clicks "Assumir". Checking only at enqueue time is not
--   enough. Runtime captures ai_control_epoch at run start and re-checks it
--   immediately before each outbound WhatsApp send.
--
-- No destructive changes. No PL/pgSQL needed.
-- ============================================================

BEGIN;

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS ai_control_epoch INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.agent_conversations
  DROP CONSTRAINT IF EXISTS agent_conversations_ai_control_epoch_nonnegative;

ALTER TABLE public.agent_conversations
  ADD CONSTRAINT agent_conversations_ai_control_epoch_nonnegative
  CHECK (ai_control_epoch >= 0);

COMMENT ON COLUMN public.agent_conversations.ai_control_epoch IS
  'Monotonic control epoch. Incremented when conversation ownership changes so stale AI runs cannot send after human takeover.';

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   ALTER TABLE public.agent_conversations
--     DROP CONSTRAINT IF EXISTS agent_conversations_ai_control_epoch_nonnegative;
--   ALTER TABLE public.agent_conversations
--     DROP COLUMN IF EXISTS ai_control_epoch;
-- COMMIT;
