-- 095: midia e auditoria para mensagens agendadas do chat
-- Alinha scheduled_messages ao fluxo de campanhas: texto opcional quando ha
-- midia, metadados do arquivo e erro persistido quando o worker falha.

BEGIN;

ALTER TABLE public.scheduled_messages
  ALTER COLUMN content DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'none'
    CHECK (media_type IN ('none', 'image', 'video', 'audio', 'document')),
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS media_size INTEGER,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduled_messages_content_or_media_check'
  ) THEN
    ALTER TABLE public.scheduled_messages
      ADD CONSTRAINT scheduled_messages_content_or_media_check
      CHECK (
        char_length(trim(COALESCE(content, ''))) > 0
        OR (media_type <> 'none' AND media_url IS NOT NULL)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending_due
  ON public.scheduled_messages (status, scheduled_at)
  WHERE status = 'pending';

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'crm-scheduled-messages-worker'
  ) THEN
    PERFORM cron.schedule(
      'crm-scheduled-messages-worker',
      '* * * * *',
      $cron$SELECT net.http_post(
           url := replace(
             current_setting('app.settings.scheduler_tick_url', true),
             '/api/ai-agent/scheduler/tick',
             '/api/scheduled-messages/worker'
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
