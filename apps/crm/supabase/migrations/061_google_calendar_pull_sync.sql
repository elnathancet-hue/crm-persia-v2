-- ============================================================
-- MIGRATION 061: Google Calendar pull sync infrastructure
-- ------------------------------------------------------------
-- PR-FLOW-PIVOT PR 14c (mai/2026): adiciona `last_polled_at` em
-- google_calendar_connections + agenda pg_cron job pra rodar o poll
-- a cada 5 minutos.
--
-- Strategy V1 (polling, não webhooks):
--   - Cron chama POST /api/cron/google-calendar-poll com header
--     X-Persia-Gcal-Poll-Secret (env PERSIA_GCAL_POLL_SECRET)
--   - Endpoint itera todas as conexões ativas e chama
--     `events.list?updatedMin=last_polled_at&showDeleted=true`
--   - Pra cada event no Google: se google_event_id casa com algum
--     appointment → reflete cancel/update no CRM
--   - UPDATE last_polled_at = NOW() no fim
--
-- Por que polling em vez de webhooks:
--   - Webhooks Google exigem watch channel + renewal cron (max 30
--     dias) + certificate validation
--   - 5min lag aceitável V1 (admin não fica olhando "moveu agora?")
--   - PR 14d V2 pode migrar pra webhooks se feedback indicar
-- ============================================================

BEGIN;

-- 1. Coluna pra rastrear watermark do poll por org.
ALTER TABLE public.google_calendar_connections
  ADD COLUMN IF NOT EXISTS last_polled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.google_calendar_connections.last_polled_at IS
  'PR-FLOW-PIVOT PR 14c (mai/2026): timestamp da última execução do poll Google → CRM. NULL = nunca rodou (1º poll usa now()-1 dia como fallback pra evitar backlog).';

-- 2. Cron job pra disparar o poll a cada 5 minutos.
-- Reusa as DB settings do scheduler (mesma URL base, path diferente).
-- IDEMPOTÊNCIA: re-rodar não duplica.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'gcal-pull-sync'
  ) THEN
    PERFORM cron.schedule(
      'gcal-pull-sync',
      '*/5 * * * *',  -- a cada 5 minutos
      $cron$SELECT net.http_post(
           url := replace(
             current_setting('app.settings.scheduler_tick_url', true),
             '/ai-agent/scheduler/tick',
             '/cron/google-calendar-poll'
           ),
           headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'X-Persia-Gcal-Poll-Secret', current_setting('app.settings.gcal_poll_secret', true)
           ),
           body := '{}'::jsonb,
           timeout_milliseconds := 120000
         );$cron$
    );
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- Setup pós-migration (admin executa no SQL Editor + EasyPanel):
-- ============================================================
--
-- 1. EasyPanel env var:
--      PERSIA_GCAL_POLL_SECRET=<32+ bytes hex>
--      Gera com: openssl rand -hex 32
--
-- 2. Configura no DB pra cron usar (uma vez por banco):
--      ALTER DATABASE postgres SET app.settings.gcal_poll_secret = '<o mesmo valor>';
--      -- Se a função ALTER DATABASE estiver bloqueada (Supabase managed),
--      -- use a alternativa abaixo com cron.alter_job.
--
-- 3. Alternativa se ALTER DATABASE bloqueado (caso comum em Supabase):
--      SELECT cron.alter_job(
--        job_id := (SELECT jobid FROM cron.job WHERE jobname = 'gcal-pull-sync'),
--        command := $$SELECT net.http_post(
--          url := 'https://crm.funilpersia.top/api/cron/google-calendar-poll',
--          headers := jsonb_build_object(
--            'Content-Type', 'application/json',
--            'X-Persia-Gcal-Poll-Secret', '<o mesmo valor do env>'
--          ),
--          body := '{}'::jsonb,
--          timeout_milliseconds := 120000
--        );$$
--      );
--
-- 4. Verificar:
--      SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'gcal-pull-sync';
--      SELECT runid, status, return_message FROM cron.job_run_details
--        WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'gcal-pull-sync')
--        ORDER BY start_time DESC LIMIT 5;
-- ============================================================
