-- 092: follow-up com mensagem propria
-- Remove a dependencia operacional de templates de notificacao para criar etapas.

BEGIN;

ALTER TABLE public.agent_followups
  ADD COLUMN IF NOT EXISTS message_text TEXT;

ALTER TABLE public.agent_followups
  ALTER COLUMN template_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_followups_message_source_check'
  ) THEN
    ALTER TABLE public.agent_followups
      ADD CONSTRAINT agent_followups_message_source_check
      CHECK (
        template_id IS NOT NULL
        OR char_length(trim(COALESCE(message_text, ''))) >= 1
      );
  END IF;
END
$$;

COMMIT;
