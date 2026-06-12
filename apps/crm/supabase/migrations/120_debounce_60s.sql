-- Expand debounce_window_ms CHECK constraint from 40 s to 60 s.
-- Também atualiza enqueue_pending_message para respeitar o novo cap.
--
-- User request (jun/2026): slider na UI deve ir até 60 s pra dar mais
-- flexibilidade em funis de vendas com leads lentos ao digitar.
-- O CHECK anterior era: debounce_window_ms >= 0 AND debounce_window_ms <= 40000
-- Novo range: 0..60000

-- 1. Expand CHECK constraint
ALTER TABLE agent_configs
  DROP CONSTRAINT IF EXISTS agent_configs_debounce_window_ms_check;

ALTER TABLE agent_configs
  ADD CONSTRAINT agent_configs_debounce_window_ms_check
  CHECK (debounce_window_ms >= 0 AND debounce_window_ms <= 60000);

-- 2. Atualiza enqueue_pending_message para usar o novo cap de 60000ms.
--    Migration 034 tinha 40000 hardcoded; agora respeita até 60s.
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
  effective_window_ms INTEGER;
BEGIN
  -- Range [0, 60000]. 0 = responde imediatamente.
  effective_window_ms := least(
    greatest(coalesce(p_debounce_window_ms, 10000), 0),
    60000
  );

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
        p_received_at + (effective_window_ms::text || ' milliseconds')::interval
      ),
      updated_at = now()
    WHERE id = p_agent_conversation_id
      AND organization_id = p_organization_id;
  END IF;

  RETURN inserted_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_pending_message(UUID, UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_pending_message(UUID, UUID, INTEGER, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
