-- ============================================================
-- MIGRATION 055: pg_cron job pra /api/ai-agent/debounce-flush
-- ------------------------------------------------------------
-- PR-FLOW-PIVOT followup (mai/2026): registra o cron job que dispara
-- o flush das mensagens debounçadas a cada 15s. Sem esse cron, o
-- webhook real do flow runtime (PR 2b) enfileira em pending_messages
-- mas ninguém processa.
--
-- HISTÓRICO: o cron job foi criado manualmente em prod via SQL Editor
-- durante smoke test do MVP do flow pivot (20/mai/2026). Esta migration
-- reproduz aquele setup pra que QUALQUER ambiente novo (staging, outra
-- org) suba o cron via `supabase db push` sem operação manual.
--
-- ============================================================
-- LIMITAÇÃO DO SUPABASE MANAGED
-- ============================================================
-- Migrations anteriores (025, 051) usaram `current_setting('app.settings.
-- scheduler_tick_url', true)` no command do cron — esperando que o admin
-- rodasse `ALTER DATABASE postgres SET app.settings.scheduler_tick_url
-- = '...'`. PROBLEMA: managed Supabase bloqueia ALTER DATABASE pelo SQL
-- Editor (precisa superuser). O setting fica NULL e o cron falha
-- silenciosamente em `net._encode_url_with_params_array(NULL, ...)`.
--
-- SOLUÇÃO: esta migration cria 2 coisas:
--   1. Cron job 'ai-agent-debounce-flush' com command placeholder que
--      faz no-op enquanto URL/secret não foram configurados.
--   2. Função SECURITY DEFINER `configure_debounce_flush_cron(url, secret)`
--      que o admin chama uma vez via SQL Editor pra reescrever o command
--      com URL + Bearer hardcoded — bypass do ALTER DATABASE.
--
-- COMO ATIVAR EM AMBIENTE NOVO (rodar 1 vez no SQL Editor pós-push):
--
--   SELECT configure_debounce_flush_cron(
--     'https://crm.funilpersia.top/api/ai-agent/debounce-flush',
--     'SEU_SECRET_AQUI'  -- mesmo valor de env PERSIA_DEBOUNCE_FLUSH_SECRET
--   );
--
-- O secret também precisa ser setado como env var `PERSIA_DEBOUNCE_FLUSH_SECRET`
-- no EasyPanel (ou outro host). A rota POST /api/ai-agent/debounce-flush
-- valida com `timingSafeEqual` contra o header `X-Persia-Cron-Secret`.
--
-- IDEMPOTÊNCIA: re-rodar a migration ou a função não duplica jobs nem
-- quebra cron em execução. `cron.schedule` com nome existente atualiza.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Função admin-friendly pra (re)configurar o cron sem ALTER DATABASE.
-- SECURITY DEFINER: roda com permissões do owner (postgres), bypass do
-- 42501 que admins enfrentam no SQL Editor.
CREATE OR REPLACE FUNCTION public.configure_debounce_flush_cron(
  p_url TEXT,
  p_secret TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, cron
AS $$
DECLARE
  v_command TEXT;
BEGIN
  IF p_url IS NULL OR length(trim(p_url)) = 0 THEN
    RAISE EXCEPTION 'configure_debounce_flush_cron: p_url é obrigatório';
  END IF;
  IF p_secret IS NULL OR length(trim(p_secret)) = 0 THEN
    RAISE EXCEPTION 'configure_debounce_flush_cron: p_secret é obrigatório';
  END IF;

  -- Monta o command com URL/secret literais. `format(%L)` faz quote
  -- defensivo contra injection (não que admin seja malicioso, mas
  -- evita quebrar SQL se o secret tiver aspas).
  v_command := format($cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Persia-Cron-Secret', %L
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cmd$, p_url, p_secret);

  -- cron.schedule é idempotente por jobname: cria se não existe, atualiza
  -- schedule + command se existe.
  PERFORM cron.schedule(
    'ai-agent-debounce-flush',
    '15 seconds',
    v_command
  );

  RETURN format(
    'ai-agent-debounce-flush configurado: URL=%s, secret_len=%s',
    p_url, length(p_secret)
  );
END;
$$;

COMMENT ON FUNCTION public.configure_debounce_flush_cron IS
  'PR-FLOW-PIVOT 055 (mai/2026): admin-friendly setter pro cron job ai-agent-debounce-flush. Rodar 1 vez por ambiente novo. URL deve apontar pra /api/ai-agent/debounce-flush e secret deve bater com env PERSIA_DEBOUNCE_FLUSH_SECRET do host.';

-- Registra o cron job com command placeholder que faz no-op até admin
-- configurar via `configure_debounce_flush_cron(...)`. Sem isso, ambientes
-- novos rodam a migration e nada falha — só o flush não dispara até o
-- setup ser feito.
--
-- O placeholder roda um RAISE NOTICE silencioso (visível só em logs).
-- Não bate em endpoint nem gasta egress.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'ai-agent-debounce-flush'
  ) THEN
    PERFORM cron.schedule(
      'ai-agent-debounce-flush',
      '15 seconds',
      $cmd$DO $inner$
        BEGIN
          RAISE NOTICE 'ai-agent-debounce-flush: cron não configurado. Rodar SELECT configure_debounce_flush_cron(url, secret); pra ativar.';
        END
      $inner$;$cmd$
    );
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- Verificação manual (rodar no SQL Editor pós-push):
-- ============================================================
-- 1. Garantir que o cron job existe:
--      SELECT jobname, schedule, active
--      FROM cron.job WHERE jobname = 'ai-agent-debounce-flush';
--
-- 2. Configurar URL + secret (substitua placeholders):
--      SELECT configure_debounce_flush_cron(
--        'https://SEU_HOST/api/ai-agent/debounce-flush',
--        'SEU_SECRET_DE_64_HEX_CHARS'
--      );
--
-- 3. Setar env var no host (EasyPanel/Vercel/etc):
--      PERSIA_DEBOUNCE_FLUSH_SECRET=<mesmo valor do passo 2>
--
-- 4. Aguardar ~30s e conferir execuções:
--      SELECT runid, status, return_message, start_time
--      FROM cron.job_run_details
--      WHERE jobid = (SELECT jobid FROM cron.job
--                     WHERE jobname = 'ai-agent-debounce-flush')
--      ORDER BY start_time DESC LIMIT 5;
--
--    Esperado: status='succeeded' (não 'failed').
-- ============================================================
