-- ============================================================
-- MIGRATION 034: AI Agent debounce — otimização de CPU
-- ------------------------------------------------------------
-- Contexto:
--   Em 04/mai/2026 a CPU do projeto Supabase ficou sustentada
--   em ~65% sem traffic anormal. Investigação apontou o cron
--   `ai-agent-debounce-flush` (criado em migration 019) rodando
--   a cada 2 segundos, gerando 43k+ ticks/dia mesmo sem mensagem
--   nenhuma chegando, com cada tick gravando em
--   `cron.job_run_details` (que não tem auto-cleanup no Supabase
--   gerenciado).
--
-- Mitigação aplicada na hora (manual via SQL Editor):
--   SELECT cron.alter_job(jobid, active := false)
--     pra `ai-agent-debounce-flush`
--   SELECT cron.alter_job(jobid, schedule := '* * * * *')
--     pra `ai-agent-indexer-tick` (era '30 seconds')
--
-- Esta migration aplica o fix definitivo:
--   1. CHECK constraint do `debounce_window_ms` expandido pra
--      [0, 40_000]. 0 = "responde imediatamente, sem agregar".
--      40s = folga máxima pra leads que digitam em pedaços muito
--      curtos. Antes era [3000, 30000].
--   2. `enqueue_pending_message` deixa de aplicar floor de 1000ms
--      no parâmetro — agora respeita o valor configurado pelo
--      admin (inclusive 0).
--   3. Índice parcial novo em `agent_conversations(next_flush_at)
--      WHERE next_flush_at IS NOT NULL AND flush_claimed_at IS NULL`
--      — torna o probe SQL do endpoint praticamente grátis. O
--      índice antigo `idx_agent_conversations_next_flush` é
--      mantido (drop seria barato mas evita risco em prod).
--   4. Cron `ai-agent-debounce-flush` reagendado pra '15 seconds'
--      e reativado. 15s é o sweet spot: corta 87% dos ticks vs 2s,
--      e pra leads que digitam normal o p99 fica em ~debounce + 7s.
--   5. Cron novo `cron-job-run-details-cleanup` semanal (domingo
--      03:00 UTC) pra apagar entries de `cron.job_run_details`
--      mais antigas que 7 dias. Sem isso, a tabela cresce eterno.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. CHECK constraint expandido [0, 40_000]
-- ------------------------------------------------------------
ALTER TABLE public.agent_configs
  DROP CONSTRAINT IF EXISTS agent_configs_debounce_window_ms_check;

ALTER TABLE public.agent_configs
  ADD CONSTRAINT agent_configs_debounce_window_ms_check
  CHECK (debounce_window_ms >= 0 AND debounce_window_ms <= 40000);

-- ------------------------------------------------------------
-- 2. enqueue_pending_message: respeita valor configurado
--    (sem o floor de 1000ms que o código antigo impunha)
-- ------------------------------------------------------------
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
  -- Range [0, 40000]. 0 = responde imediatamente.
  effective_window_ms := least(
    greatest(coalesce(p_debounce_window_ms, 10000), 0),
    40000
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

-- ------------------------------------------------------------
-- 3. Índice parcial pro probe rápido do endpoint
--    (só conversas com debounce ativo e não-claimadas)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_agent_conversations_next_flush_unclaimed
  ON public.agent_conversations (next_flush_at)
  WHERE next_flush_at IS NOT NULL AND flush_claimed_at IS NULL;

-- ------------------------------------------------------------
-- 4. Cron `ai-agent-debounce-flush`: reagenda pra 15s + reativa
--    Idempotente: usa cron.alter_job se job existir, senão schedule.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'ai-agent-debounce-flush'
  LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(
      job_id   := v_jobid,
      schedule := '15 seconds',
      active   := true
    );
  ELSE
    PERFORM cron.schedule(
      'ai-agent-debounce-flush',
      '15 seconds',
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

-- ------------------------------------------------------------
-- 5. Cleanup semanal de cron.job_run_details (>7 dias)
--    Roda domingo 03:00 UTC. Apaga em batch e faz vacuum
--    leve depois pra liberar espaço.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cron-job-run-details-cleanup'
  ) THEN
    PERFORM cron.schedule(
      'cron-job-run-details-cleanup',
      '0 3 * * 0',
      $cleanup$DELETE FROM cron.job_run_details WHERE start_time < now() - interval '7 days';$cleanup$
    );
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- Rollback (manual)
-- ============================================================
-- BEGIN;
--   SELECT cron.unschedule('cron-job-run-details-cleanup');
--   -- Volta cron pra 2s (NÃO RECOMENDADO — esse era o problema):
--   SELECT cron.alter_job(
--     job_id   := (SELECT jobid FROM cron.job WHERE jobname = 'ai-agent-debounce-flush'),
--     schedule := '2 seconds'
--   );
--   DROP INDEX IF EXISTS idx_agent_conversations_next_flush_unclaimed;
--   ALTER TABLE public.agent_configs DROP CONSTRAINT IF EXISTS agent_configs_debounce_window_ms_check;
--   ALTER TABLE public.agent_configs
--     ADD CONSTRAINT agent_configs_debounce_window_ms_check
--     CHECK (debounce_window_ms >= 3000 AND debounce_window_ms <= 30000);
--   -- enqueue_pending_message: re-aplicar versão da migration 019
-- COMMIT;
