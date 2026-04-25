-- ============================================================
-- MIGRATION 024: AI Agent RAG indexer hardening
-- ------------------------------------------------------------
-- Scope:
--   - Keep source indexing_status in sync with claimed jobs.
--   - Fail exhausted jobs instead of leaving them pending forever.
--   - Increase pg_net timeout for indexer tick to 60s.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_agent_indexing_job(
  p_now TIMESTAMPTZ DEFAULT now(),
  p_max_attempts INTEGER DEFAULT 3
)
RETURNS SETOF public.agent_indexing_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.agent_indexing_jobs%ROWTYPE;
  v_max_attempts INTEGER := greatest(coalesce(p_max_attempts, 3), 1);
BEGIN
  UPDATE public.agent_indexing_jobs
  SET
    status = 'failed',
    error_message = coalesce(error_message, 'max attempts reached'),
    updated_at = p_now
  WHERE (
    status = 'pending'
    OR (status = 'processing' AND claimed_at < p_now - INTERVAL '5 minutes')
  )
    AND attempts >= v_max_attempts;

  UPDATE public.agent_knowledge_sources s
  SET
    indexing_status = 'failed',
    indexing_error = coalesce(s.indexing_error, 'max attempts reached'),
    updated_at = p_now
  WHERE s.indexing_status IN ('pending', 'processing')
    AND EXISTS (
      SELECT 1
      FROM public.agent_indexing_jobs j
      WHERE j.source_id = s.id
        AND j.organization_id = s.organization_id
        AND j.status = 'failed'
        AND j.error_message = 'max attempts reached'
    );

  UPDATE public.agent_indexing_jobs
  SET
    status = 'processing',
    claimed_at = p_now,
    attempts = attempts + 1,
    updated_at = p_now
  WHERE id = (
    SELECT j.id
    FROM public.agent_indexing_jobs j
    WHERE (
      j.status = 'pending'
      OR (j.status = 'processing' AND j.claimed_at < p_now - INTERVAL '5 minutes')
    )
      AND j.attempts < v_max_attempts
    ORDER BY j.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO v_job;

  IF v_job.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.agent_knowledge_sources
  SET
    indexing_status = 'processing',
    indexing_error = NULL,
    updated_at = p_now
  WHERE id = v_job.source_id
    AND organization_id = v_job.organization_id;

  RETURN QUERY SELECT v_job.*;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'ai-agent-indexer-tick'
  ) THEN
    PERFORM cron.unschedule('ai-agent-indexer-tick');
  END IF;

  PERFORM cron.schedule(
    'ai-agent-indexer-tick',
    '30 seconds',
    $cron$SELECT net.http_post(
         url := current_setting('app.settings.indexer_tick_url', true),
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'X-Persia-Indexer-Secret', current_setting('app.settings.indexer_tick_secret', true)
         ),
         body := '{}'::jsonb,
         timeout_milliseconds := 60000
       );$cron$
  );
END
$$;

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   SELECT cron.unschedule('ai-agent-indexer-tick');
--   CREATE OR REPLACE FUNCTION public.claim_agent_indexing_job(...) -- restore migration 022 body
--   PERFORM cron.schedule(
--     'ai-agent-indexer-tick',
--     '30 seconds',
--     $cron$SELECT net.http_post(... timeout_milliseconds := 5000);$cron$
--   );
-- COMMIT;
