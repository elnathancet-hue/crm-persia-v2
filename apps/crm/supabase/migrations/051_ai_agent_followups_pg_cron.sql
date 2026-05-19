-- ============================================================
-- MIGRATION 051: pg_cron job pra disparar /api/ai-agent/followups/tick
-- ------------------------------------------------------------
-- Espelha o pattern da migration 025 (scheduler-tick a cada 1 min).
-- Aqui usamos 10 min porque follow-ups sao baseados em horas de
-- inatividade (delay_hours min=1, max=720) — granularidade fina nao
-- agrega valor e gera tick desnecessario.
--
-- Reusa as MESMAS DB settings ja configuradas pelo deploy do scheduler:
--   - app.settings.scheduler_tick_url   (ex: https://crm.funilpersia.top/api/ai-agent/scheduler/tick)
--   - app.settings.scheduler_tick_secret
--
-- Como a URL configurada aponta pra /scheduler/tick e precisamos hitar
-- /followups/tick, fazemos um replace inline. Isso evita criar uma
-- NOVA setting + obrigar o user a re-setar tudo no deploy.
--
-- IDEMPOTENCIA: IF NOT EXISTS no cron.job — re-rodar nao duplica o job.
-- ============================================================

BEGIN;

-- Extensions garantidas (no-op se ja existem)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'ai-agent-followups-tick'
  ) THEN
    PERFORM cron.schedule(
      'ai-agent-followups-tick',
      '*/10 * * * *',  -- a cada 10 minutos
      $cron$SELECT net.http_post(
           url := replace(
             current_setting('app.settings.scheduler_tick_url', true),
             '/scheduler/tick',
             '/followups/tick'
           ),
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
-- Verificacao manual (rodar no SQL Editor pos-push):
-- ============================================================
-- SELECT jobname, schedule, active
--   FROM cron.job
--   WHERE jobname LIKE 'ai-agent%';
--
-- Esperado:
--   ai-agent-followups-tick   */10 * * * *   t
--   ai-agent-scheduler-tick   * * * * *      t
--   ai-agent-indexer-tick     * * * * *      t   (se ja existir)
--
-- Pra ver execucoes recentes:
--   SELECT runid, jobid, start_time, end_time, status, return_message
--     FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'ai-agent-followups-tick')
--     ORDER BY start_time DESC
--     LIMIT 10;
--
-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   SELECT cron.unschedule('ai-agent-followups-tick');
-- COMMIT;
