-- ============================================================
-- MIGRATION 018: AI Agent cost limits + usage view
-- ------------------------------------------------------------
-- Scope:
--   - Per-org/per-agent cost limit rows.
--   - Read-only daily usage view for dashboards and guardrails.
--   - Additive only; existing AI agent runtime keeps working.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_cost_limits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('run', 'agent_daily', 'org_daily', 'org_monthly')),
  subject_id UUID REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  max_tokens INTEGER CHECK (max_tokens IS NULL OR max_tokens >= 0),
  max_usd_cents INTEGER CHECK (max_usd_cents IS NULL OR max_usd_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'agent_daily' AND subject_id IS NOT NULL)
    OR
    (scope <> 'agent_daily' AND subject_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_cost_limits_org_scope_global
  ON public.agent_cost_limits (organization_id, scope)
  WHERE subject_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_cost_limits_org_scope_subject
  ON public.agent_cost_limits (organization_id, scope, subject_id)
  WHERE subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_cost_limits_org_scope
  ON public.agent_cost_limits (organization_id, scope);

ALTER TABLE public.agent_cost_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_cost_limits_select" ON public.agent_cost_limits;
DROP POLICY IF EXISTS "agent_cost_limits_insert" ON public.agent_cost_limits;
DROP POLICY IF EXISTS "agent_cost_limits_update" ON public.agent_cost_limits;
DROP POLICY IF EXISTS "agent_cost_limits_delete" ON public.agent_cost_limits;

CREATE POLICY "agent_cost_limits_select" ON public.agent_cost_limits
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

CREATE POLICY "agent_cost_limits_insert" ON public.agent_cost_limits
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "agent_cost_limits_update" ON public.agent_cost_limits
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "agent_cost_limits_delete" ON public.agent_cost_limits
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE OR REPLACE VIEW public.agent_usage_daily
WITH (security_invoker = true) AS
SELECT
  r.organization_id,
  c.config_id,
  timezone('UTC', r.created_at)::date AS day,
  count(*)::integer AS run_count,
  count(*) FILTER (WHERE r.status = 'succeeded')::integer AS succeeded_count,
  count(*) FILTER (WHERE r.status = 'failed')::integer AS failed_count,
  count(*) FILTER (WHERE r.status = 'fallback')::integer AS fallback_count,
  coalesce(sum(r.tokens_input), 0)::integer AS tokens_input,
  coalesce(sum(r.tokens_output), 0)::integer AS tokens_output,
  coalesce(sum(r.cost_usd_cents), 0)::integer AS cost_usd_cents,
  coalesce(avg(r.duration_ms), 0)::integer AS avg_duration_ms
FROM public.agent_runs r
JOIN public.agent_conversations c ON c.id = r.agent_conversation_id
GROUP BY r.organization_id, c.config_id, timezone('UTC', r.created_at)::date;

GRANT SELECT ON public.agent_usage_daily TO authenticated;
GRANT SELECT ON public.agent_usage_daily TO service_role;

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   DROP VIEW IF EXISTS public.agent_usage_daily;
--   DROP TABLE IF EXISTS public.agent_cost_limits;
-- COMMIT;
