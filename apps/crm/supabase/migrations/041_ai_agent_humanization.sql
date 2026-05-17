-- Migration 041: AI Agent humanization config (PR-AI-AGENT-HUMAN-A, mai/2026)
--
-- Adds humanization_config JSONB column to agent_configs. This single column
-- grows across 3 PRs to avoid 3 separate migrations:
--   PR A (this one): pause/resume keywords + auto_pause_minutes
--   PR B (next):     split_enabled, split_threshold, split_delay_seconds
--   PR C (next):     business_hours, after_hours_message
--
-- Why JSONB and not flat columns:
-- We're iterating fast on "humanization" features (PR A/B/C/D). Each adds
-- 2-4 settings. Flat columns = 3 migrations + 3 type changes + 3 select
-- updates everywhere. JSONB = 1 migration, types in @persia/shared grow
-- additively, callers tolerate missing keys with defaults.
--
-- Defaults are the most common Brazilian SDR words. Customizable in UI.
-- auto_pause_minutes=30 reflects typical sales floor handoff window.

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS humanization_config JSONB NOT NULL DEFAULT
    jsonb_build_object(
      'pause_keywords', jsonb_build_array('PAUSAR', 'HUMANO', 'STOP IA'),
      'resume_keywords', jsonb_build_array('ATIVAR', 'IA ON', 'VOLTAR IA'),
      'auto_pause_minutes', 30
    );

-- Backfill existing rows that may have been created before defaults applied.
-- COALESCE with the same shape so partial migrations don't lose data.
UPDATE public.agent_configs
SET humanization_config = jsonb_build_object(
  'pause_keywords', COALESCE(humanization_config->'pause_keywords', jsonb_build_array('PAUSAR', 'HUMANO', 'STOP IA')),
  'resume_keywords', COALESCE(humanization_config->'resume_keywords', jsonb_build_array('ATIVAR', 'IA ON', 'VOLTAR IA')),
  'auto_pause_minutes', COALESCE(humanization_config->'auto_pause_minutes', to_jsonb(30))
)
WHERE humanization_config IS NULL
   OR NOT (humanization_config ? 'pause_keywords')
   OR NOT (humanization_config ? 'resume_keywords')
   OR NOT (humanization_config ? 'auto_pause_minutes');

COMMENT ON COLUMN public.agent_configs.humanization_config IS
  'PR-AI-AGENT-HUMAN: settings de humanizacao. PR A: pause_keywords (text[]), resume_keywords (text[]), auto_pause_minutes (int). PR B/C/D adicionam keys novos sem mudar schema.';

-- Rollback (manual, do not include in migration):
--   ALTER TABLE public.agent_configs DROP COLUMN IF EXISTS humanization_config;
