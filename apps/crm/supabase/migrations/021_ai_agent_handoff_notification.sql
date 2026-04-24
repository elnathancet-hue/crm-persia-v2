-- ============================================================
-- MIGRATION 021: AI Agent handoff notification config
-- ------------------------------------------------------------
-- Scope:
--   - Per-agent WhatsApp handoff notification settings.
--   - Additive only; runtime remains off by default.
-- ============================================================

BEGIN;

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS handoff_notification_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_notification_target_type TEXT,
  ADD COLUMN IF NOT EXISTS handoff_notification_target_address TEXT,
  ADD COLUMN IF NOT EXISTS handoff_notification_template TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_handoff_target_type_check'
  ) THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_handoff_target_type_check
      CHECK (
        handoff_notification_target_type IS NULL
        OR handoff_notification_target_type IN ('phone', 'group')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_handoff_target_consistency_check'
  ) THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_handoff_target_consistency_check
      CHECK (
        handoff_notification_enabled = false
        OR (
          handoff_notification_target_type IS NOT NULL
          AND handoff_notification_target_address IS NOT NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_handoff_template_length_check'
  ) THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_handoff_template_length_check
      CHECK (
        handoff_notification_template IS NULL
        OR char_length(handoff_notification_template) <= 1500
      );
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- Rollback (manual)
-- ============================================================
-- BEGIN;
--   ALTER TABLE public.agent_configs
--     DROP CONSTRAINT IF EXISTS agent_configs_handoff_template_length_check,
--     DROP CONSTRAINT IF EXISTS agent_configs_handoff_target_consistency_check,
--     DROP CONSTRAINT IF EXISTS agent_configs_handoff_target_type_check,
--     DROP COLUMN IF EXISTS handoff_notification_template,
--     DROP COLUMN IF EXISTS handoff_notification_target_address,
--     DROP COLUMN IF EXISTS handoff_notification_target_type,
--     DROP COLUMN IF EXISTS handoff_notification_enabled;
-- COMMIT;
