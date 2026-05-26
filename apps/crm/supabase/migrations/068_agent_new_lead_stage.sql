-- ============================================================
-- MIGRATION 068: AI Agent new lead CRM entry stage
-- ------------------------------------------------------------
-- Lets each agent choose where a brand-new WhatsApp lead starts
-- in the CRM/Kanban. Existing agents keep the current behavior
-- when this column is NULL.
-- ============================================================

BEGIN;

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS new_lead_stage_id UUID
  REFERENCES public.pipeline_stages(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agent_configs_new_lead_stage_id_idx
  ON public.agent_configs (new_lead_stage_id)
  WHERE new_lead_stage_id IS NOT NULL;

COMMENT ON COLUMN public.agent_configs.new_lead_stage_id IS
  'Optional CRM stage assigned when this agent creates a brand-new WhatsApp lead. NULL keeps the default lead creation behavior.';

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   DROP INDEX IF EXISTS public.agent_configs_new_lead_stage_id_idx;
--   ALTER TABLE public.agent_configs DROP COLUMN IF EXISTS new_lead_stage_id;
-- COMMIT;
