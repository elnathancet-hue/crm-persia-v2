-- ============================================================
-- MIGRATION 020: AI Agent context summarization
-- ------------------------------------------------------------
-- Scope:
--   - Per-agent summarization thresholds.
--   - Per-conversation summary counters/state.
--   - Relax agent_steps.step_type to accept summarization.
-- ============================================================

BEGIN;

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS context_summary_turn_threshold INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS context_summary_token_threshold INTEGER NOT NULL DEFAULT 20000,
  ADD COLUMN IF NOT EXISTS context_summary_recent_messages INTEGER NOT NULL DEFAULT 6;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_configs_context_summary_turn_threshold_check'
  ) THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_context_summary_turn_threshold_check
      CHECK (context_summary_turn_threshold BETWEEN 3 AND 50);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_configs_context_summary_token_threshold_check'
  ) THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_context_summary_token_threshold_check
      CHECK (context_summary_token_threshold BETWEEN 5000 AND 100000);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_configs_context_summary_recent_messages_check'
  ) THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_context_summary_recent_messages_check
      CHECK (context_summary_recent_messages BETWEEN 2 AND 20);
  END IF;
END
$$;

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS history_summary_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS history_summary_run_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS history_summary_token_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_conversations_history_summary_run_count_check'
  ) THEN
    ALTER TABLE public.agent_conversations
      ADD CONSTRAINT agent_conversations_history_summary_run_count_check
      CHECK (history_summary_run_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_conversations_history_summary_token_count_check'
  ) THEN
    ALTER TABLE public.agent_conversations
      ADD CONSTRAINT agent_conversations_history_summary_token_count_check
      CHECK (history_summary_token_count >= 0);
  END IF;
END
$$;

ALTER TABLE public.agent_steps
  DROP CONSTRAINT IF EXISTS agent_steps_step_type_check;

ALTER TABLE public.agent_steps
  ADD CONSTRAINT agent_steps_step_type_check
  CHECK (step_type IN ('llm', 'tool', 'guardrail', 'summarization'));

COMMIT;

-- ============================================================
-- Rollback (manual)
-- ============================================================
-- BEGIN;
--   ALTER TABLE public.agent_steps DROP CONSTRAINT IF EXISTS agent_steps_step_type_check;
--   ALTER TABLE public.agent_steps
--     ADD CONSTRAINT agent_steps_step_type_check
--     CHECK (step_type IN ('llm', 'tool', 'guardrail'));
--   ALTER TABLE public.agent_conversations
--     DROP COLUMN IF EXISTS history_summary_token_count,
--     DROP COLUMN IF EXISTS history_summary_run_count,
--     DROP COLUMN IF EXISTS history_summary_updated_at;
--   ALTER TABLE public.agent_configs
--     DROP COLUMN IF EXISTS context_summary_recent_messages,
--     DROP COLUMN IF EXISTS context_summary_token_threshold,
--     DROP COLUMN IF EXISTS context_summary_turn_threshold;
-- COMMIT;
