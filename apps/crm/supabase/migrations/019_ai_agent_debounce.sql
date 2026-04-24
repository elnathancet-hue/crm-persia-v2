-- ============================================================
-- MIGRATION 019: AI Agent message debounce
-- ------------------------------------------------------------
-- Scope:
--   - Per-agent debounce window config.
--   - Pending inbound queue for native AI execution.
--   - Lease helpers so flush workers do not process the same
--     conversation concurrently.
--   - pg_cron + pg_net hook for out-of-band flush execution.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS debounce_window_ms INTEGER NOT NULL DEFAULT 10000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_configs_debounce_window_ms_check'
  ) THEN
    ALTER TABLE public.agent_configs
      ADD CONSTRAINT agent_configs_debounce_window_ms_check
      CHECK (debounce_window_ms >= 3000 AND debounce_window_ms <= 30000);
  END IF;
END
$$;

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS next_flush_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flush_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flush_claim_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_conversations_next_flush
  ON public.agent_conversations (next_flush_at)
  WHERE next_flush_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_conversations_flush_claim_expires
  ON public.agent_conversations (flush_claim_expires_at)
  WHERE flush_claim_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.pending_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'audio', 'video', 'document', 'location', 'other')),
  media_ref TEXT,
  inbound_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL,
  flushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_messages_inbound_unique
  ON public.pending_messages (inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_messages_conversation_unflushed
  ON public.pending_messages (agent_conversation_id, received_at)
  WHERE flushed_at IS NULL;

ALTER TABLE public.pending_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_messages_select" ON public.pending_messages;
DROP POLICY IF EXISTS "pending_messages_insert" ON public.pending_messages;
DROP POLICY IF EXISTS "pending_messages_update" ON public.pending_messages;

CREATE POLICY "pending_messages_select" ON public.pending_messages
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "pending_messages_insert" ON public.pending_messages
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "pending_messages_update" ON public.pending_messages
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE OR REPLACE FUNCTION public.enqueue_pending_message(
  p_organization_id UUID,
  p_agent_conversation_id UUID,
  p_debounce_window_ms INTEGER,
  p_inbound_message_id UUID DEFAULT NULL,
  p_text TEXT DEFAULT '',
  p_message_type TEXT DEFAULT 'text',
  p_media_ref TEXT DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  INSERT INTO public.pending_messages (
    organization_id,
    agent_conversation_id,
    text,
    message_type,
    media_ref,
    inbound_message_id,
    received_at
  )
  VALUES (
    p_organization_id,
    p_agent_conversation_id,
    coalesce(p_text, ''),
    p_message_type,
    p_media_ref,
    p_inbound_message_id,
    p_received_at
  )
  ON CONFLICT (inbound_message_id) WHERE inbound_message_id IS NOT NULL
  DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count > 0 THEN
    UPDATE public.agent_conversations
    SET
      next_flush_at = coalesce(
        next_flush_at,
        p_received_at + ((greatest(coalesce(p_debounce_window_ms, 10000), 1000))::text || ' milliseconds')::interval
      ),
      updated_at = now()
    WHERE id = p_agent_conversation_id
      AND organization_id = p_organization_id;
  END IF;

  RETURN inserted_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_agent_conversation_flush(
  p_organization_id UUID,
  p_agent_conversation_id UUID,
  p_now TIMESTAMPTZ DEFAULT now(),
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_count INTEGER := 0;
BEGIN
  UPDATE public.agent_conversations
  SET
    flush_claimed_at = p_now,
    flush_claim_expires_at = p_now + make_interval(secs => greatest(coalesce(p_lease_seconds, 120), 1)),
    updated_at = now()
  WHERE id = p_agent_conversation_id
    AND organization_id = p_organization_id
    AND next_flush_at IS NOT NULL
    AND next_flush_at <= p_now
    AND (
      flush_claim_expires_at IS NULL
      OR flush_claim_expires_at < p_now
    );

  GET DIAGNOSTICS claimed_count = ROW_COUNT;
  RETURN claimed_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_agent_conversation_flush(
  p_organization_id UUID,
  p_agent_conversation_id UUID,
  p_pending_message_ids UUID[],
  p_completed_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining_count INTEGER := 0;
BEGIN
  IF coalesce(array_length(p_pending_message_ids, 1), 0) > 0 THEN
    UPDATE public.pending_messages
    SET flushed_at = p_completed_at
    WHERE organization_id = p_organization_id
      AND agent_conversation_id = p_agent_conversation_id
      AND flushed_at IS NULL
      AND id = ANY(p_pending_message_ids);
  END IF;

  SELECT count(*)
  INTO remaining_count
  FROM public.pending_messages
  WHERE organization_id = p_organization_id
    AND agent_conversation_id = p_agent_conversation_id
    AND flushed_at IS NULL;

  UPDATE public.agent_conversations
  SET
    next_flush_at = CASE WHEN remaining_count > 0 THEN p_completed_at ELSE NULL END,
    flush_claimed_at = NULL,
    flush_claim_expires_at = NULL,
    updated_at = now()
  WHERE id = p_agent_conversation_id
    AND organization_id = p_organization_id;

  RETURN remaining_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_agent_conversation_flush(
  p_organization_id UUID,
  p_agent_conversation_id UUID,
  p_released_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining_count INTEGER := 0;
BEGIN
  SELECT count(*)
  INTO remaining_count
  FROM public.pending_messages
  WHERE organization_id = p_organization_id
    AND agent_conversation_id = p_agent_conversation_id
    AND flushed_at IS NULL;

  UPDATE public.agent_conversations
  SET
    next_flush_at = CASE WHEN remaining_count > 0 THEN p_released_at ELSE NULL END,
    flush_claimed_at = NULL,
    flush_claim_expires_at = NULL,
    updated_at = now()
  WHERE id = p_agent_conversation_id
    AND organization_id = p_organization_id;

  RETURN remaining_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_pending_message(UUID, UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_agent_conversation_flush(UUID, UUID, TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_agent_conversation_flush(UUID, UUID, UUID[], TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_agent_conversation_flush(UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_pending_message(UUID, UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_agent_conversation_flush(UUID, UUID, TIMESTAMPTZ, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_agent_conversation_flush(UUID, UUID, UUID[], TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_agent_conversation_flush(UUID, UUID, TIMESTAMPTZ)
  TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'ai-agent-debounce-flush'
  ) THEN
    PERFORM cron.schedule(
      'ai-agent-debounce-flush',
      '2 seconds',
      $cron$SELECT net.http_post(
           url := current_setting('app.settings.debounce_flush_url', true),
           headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'X-Persia-Cron-Secret', current_setting('app.settings.debounce_flush_secret', true)
           ),
           body := '{}'::jsonb,
           timeout_milliseconds := 5000
         );$cron$
    );
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- Rollback (manual)
-- ============================================================
-- BEGIN;
--   SELECT cron.unschedule('ai-agent-debounce-flush');
--   DROP FUNCTION IF EXISTS public.release_agent_conversation_flush(UUID, UUID, TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS public.complete_agent_conversation_flush(UUID, UUID, UUID[], TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS public.claim_agent_conversation_flush(UUID, UUID, TIMESTAMPTZ, INTEGER);
--   DROP FUNCTION IF EXISTS public.enqueue_pending_message(UUID, UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ);
--   DROP TABLE IF EXISTS public.pending_messages;
--   ALTER TABLE public.agent_conversations
--     DROP COLUMN IF EXISTS next_flush_at,
--     DROP COLUMN IF EXISTS flush_claimed_at,
--     DROP COLUMN IF EXISTS flush_claim_expires_at;
--   ALTER TABLE public.agent_configs DROP COLUMN IF EXISTS debounce_window_ms;
-- COMMIT;
