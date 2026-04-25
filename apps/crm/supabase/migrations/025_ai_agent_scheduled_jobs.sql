-- ============================================================
-- MIGRATION 025: AI Agent scheduled jobs (cron-based reminders)
-- ------------------------------------------------------------
-- Scope:
--   - agent_scheduled_jobs table: per-config cron expressions que
--     disparam templates de notificacao periodicamente.
--   - agent_scheduled_runs: audit trail por execucao (leads_matched,
--     processed, errors).
--   - RPCs: claim_agent_scheduled_job() (lease-based, tick-safe),
--     complete/fail equivalentes.
--   - pg_cron job /api/ai-agent/scheduler/tick a cada 1min.
--
-- Additive only; runtime depende do handler trigger_notification
-- existir (PR7.1b). Ate PR7.1b mergear, scheduler roda mas os
-- disparos falham no send_message pq o handler nao esta registrado
-- no registry. O runtime loga e segue.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_scheduled_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_id UUID NOT NULL REFERENCES public.agent_notification_templates(id) ON DELETE CASCADE,
  cron_expr TEXT NOT NULL,
  lead_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused')),
  last_run_at TIMESTAMPTZ,
  last_run_leads_processed INTEGER NOT NULL DEFAULT 0 CHECK (last_run_leads_processed >= 0),
  last_run_error TEXT,
  next_run_at TIMESTAMPTZ,
  -- Lease pra single-flight por tick (mesmo padrao do indexer).
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (config_id, name),
  CHECK (char_length(name) BETWEEN 3 AND 80),
  CHECK (char_length(cron_expr) BETWEEN 9 AND 120)
);

-- Audit trail por execucao — permite ver historico de disparos.
CREATE TABLE IF NOT EXISTS public.agent_scheduled_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scheduled_job_id UUID NOT NULL REFERENCES public.agent_scheduled_jobs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  leads_matched INTEGER NOT NULL DEFAULT 0 CHECK (leads_matched >= 0),
  leads_processed INTEGER NOT NULL DEFAULT 0 CHECK (leads_processed >= 0),
  leads_skipped INTEGER NOT NULL DEFAULT 0 CHECK (leads_skipped >= 0),
  errors INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
  error_samples JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_agent_scheduled_jobs_config_status
  ON public.agent_scheduled_jobs (config_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_scheduled_jobs_next_run
  ON public.agent_scheduled_jobs (next_run_at)
  WHERE status = 'active' AND next_run_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_scheduled_runs_job_started
  ON public.agent_scheduled_runs (scheduled_job_id, started_at DESC);

-- RLS
ALTER TABLE public.agent_scheduled_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_scheduled_runs ENABLE ROW LEVEL SECURITY;

-- Jobs: admin/owner mutam. Agents leem (executor nao usa — scheduler
-- roda via service_role).
CREATE POLICY "agent_scheduled_jobs_select" ON public.agent_scheduled_jobs
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));
CREATE POLICY "agent_scheduled_jobs_insert" ON public.agent_scheduled_jobs
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_scheduled_jobs_update" ON public.agent_scheduled_jobs
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_scheduled_jobs_delete" ON public.agent_scheduled_jobs
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

-- Runs: admin/owner leem. Writes via service_role durante tick.
CREATE POLICY "agent_scheduled_runs_select" ON public.agent_scheduled_runs
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

-- ============================================================
-- RPCs (SECURITY DEFINER, service_role-only)
-- ============================================================

-- Claim: pega o job com next_run_at <= now() que nao esta claimed
-- (ou cujo claim expirou, TTL 5min). UPDATE ... SKIP LOCKED garante
-- que mesmo se pg_cron disparar 2 ticks simultaneos, so um claima.
CREATE OR REPLACE FUNCTION public.claim_agent_scheduled_job(
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS SETOF public.agent_scheduled_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.agent_scheduled_jobs
  SET
    claimed_at = p_now,
    updated_at = p_now
  WHERE id = (
    SELECT j.id
    FROM public.agent_scheduled_jobs j
    WHERE j.status = 'active'
      AND j.next_run_at IS NOT NULL
      AND j.next_run_at <= p_now
      AND (
        j.claimed_at IS NULL
        OR j.claimed_at < p_now - INTERVAL '5 minutes'
      )
    ORDER BY j.next_run_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- Complete: runtime chama depois do disparo. Atualiza last_run_*,
-- next_run_at (computado pelo runtime via cron-parser), libera claim.
CREATE OR REPLACE FUNCTION public.complete_agent_scheduled_job(
  p_job_id UUID,
  p_organization_id UUID,
  p_leads_processed INTEGER,
  p_next_run_at TIMESTAMPTZ,
  p_completed_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.agent_scheduled_jobs
  SET
    last_run_at = p_completed_at,
    last_run_leads_processed = p_leads_processed,
    last_run_error = NULL,
    next_run_at = p_next_run_at,
    claimed_at = NULL,
    updated_at = p_completed_at
  WHERE id = p_job_id
    AND organization_id = p_organization_id;

  RETURN FOUND;
END;
$$;

-- Fail: runtime chama quando o tick explode. Preserva next_run_at
-- (proximo cron tick tenta de novo); so libera claim pro retry.
CREATE OR REPLACE FUNCTION public.fail_agent_scheduled_job(
  p_job_id UUID,
  p_organization_id UUID,
  p_error_message TEXT,
  p_next_run_at TIMESTAMPTZ,
  p_failed_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.agent_scheduled_jobs
  SET
    last_run_at = p_failed_at,
    last_run_error = left(coalesce(p_error_message, 'unknown error'), 1000),
    next_run_at = p_next_run_at,
    claimed_at = NULL,
    updated_at = p_failed_at
  WHERE id = p_job_id
    AND organization_id = p_organization_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_scheduled_job(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_agent_scheduled_job(UUID, UUID, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_agent_scheduled_job(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_agent_scheduled_job(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_agent_scheduled_job(UUID, UUID, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_agent_scheduled_job(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- ============================================================
-- pg_cron job: dispara endpoint a cada 1 minuto
-- Reusa as DB settings app.settings.scheduler_tick_url + _secret
-- (deve ser setado no deploy, mesmo padrao do indexer).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'ai-agent-scheduler-tick'
  ) THEN
    PERFORM cron.schedule(
      'ai-agent-scheduler-tick',
      '* * * * *',  -- a cada minuto
      $cron$SELECT net.http_post(
           url := current_setting('app.settings.scheduler_tick_url', true),
           headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'X-Persia-Scheduler-Secret', current_setting('app.settings.scheduler_tick_secret', true)
           ),
           body := '{}'::jsonb,
           timeout_milliseconds := 60000
         );$cron$
    );
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   SELECT cron.unschedule('ai-agent-scheduler-tick');
--   DROP FUNCTION IF EXISTS public.fail_agent_scheduled_job(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS public.complete_agent_scheduled_job(UUID, UUID, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS public.claim_agent_scheduled_job(TIMESTAMPTZ);
--   DROP TABLE IF EXISTS public.agent_scheduled_runs;
--   DROP TABLE IF EXISTS public.agent_scheduled_jobs;
-- COMMIT;
