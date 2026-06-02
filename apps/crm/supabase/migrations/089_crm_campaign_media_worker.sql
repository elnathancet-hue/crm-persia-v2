-- 089: campaign-media bucket + pg_cron para worker de campanhas WhatsApp

BEGIN;

-- Bucket publico para midias enviadas em campanhas. O upload e feito via
-- server action com service_role; leitura publica e necessaria para o provider
-- WhatsApp baixar o arquivo no momento do envio.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'campaign-media',
  'campaign-media',
  TRUE,
  33554432,
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp3',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'audio/aac',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'crm-campaigns-worker'
  ) THEN
    PERFORM cron.schedule(
      'crm-campaigns-worker',
      '* * * * *',
      $cron$SELECT net.http_post(
           url := replace(
             current_setting('app.settings.scheduler_tick_url', true),
             '/api/ai-agent/scheduler/tick',
             '/api/campaigns/worker'
           ),
           headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'Authorization', 'Bearer ' || current_setting('app.settings.scheduler_tick_secret', true),
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

