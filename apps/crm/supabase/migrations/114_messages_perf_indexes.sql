-- Migration 114: Performance — índices em messages + dedup group_messages
--
-- Problema: CPU batendo 95% no Supabase. Três causas identificadas:
--
--   1. Busca de conversas usa `ilike('%content%')` sem índice FTS →
--      full table scan em toda a tabela messages a cada pesquisa.
--
--   2. messages.lead_id não tem índice → AI agent carregando histórico
--      de conversa por lead faz seq scan.
--
--   3. group_messages tem apenas índice simples em whatsapp_msg_id,
--      sem constraint UNIQUE → webhook retries criam duplicatas que
--      inflamam a tabela e tornam queries lentas.
--
-- Esta migration é idempotente (IF NOT EXISTS / IF EXISTS).

-- ============================================================================
-- Fix 1: GIN index para full-text search em messages.content
--
-- Permite trocar ilike('%term%') por operador @@ com tsvector, que é
-- O(log N) em vez de O(N). Usa 'portuguese' pra stemming correto.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_messages_content_fts
  ON public.messages
  USING gin(to_tsvector('portuguese', coalesce(content, '')));

COMMENT ON INDEX public.idx_messages_content_fts IS
  'Migration 114: FTS para busca de mensagens. Substituiu ilike("%term%") '
  'que causava full table scan e CPU spike em prod (jun/2026).';

-- ============================================================================
-- Fix 2: Índice composto (organization_id, lead_id) em messages
--
-- AI agent carrega histórico da conversa filtrando por lead_id dentro
-- de uma org. Sem índice, faz seq scan mesmo com idx_messages_org.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_messages_org_lead
  ON public.messages (organization_id, lead_id);

COMMENT ON INDEX public.idx_messages_org_lead IS
  'Migration 114: AI agent acessa histórico por (org, lead). '
  'Sem este índice, seq scan mesmo existindo idx_messages_org.';

-- ============================================================================
-- Fix 3: Dedup group_messages + UNIQUE constraint
--
-- group_messages tinha apenas índice simples, sem UNIQUE. Webhook retries
-- da UAZAPI inserem a mesma mensagem várias vezes.
-- Padrão idêntico ao Bug H (migration 064) que corrigiu messages.
-- ============================================================================

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) - COUNT(DISTINCT (organization_id, whatsapp_msg_id))
  INTO dup_count
  FROM public.group_messages
  WHERE whatsapp_msg_id IS NOT NULL;

  IF dup_count > 0 THEN
    RAISE NOTICE 'group_messages: % duplicatas encontradas. Removendo...', dup_count;
  ELSE
    RAISE NOTICE 'group_messages: nenhuma duplicata encontrada.';
  END IF;
END $$;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, whatsapp_msg_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.group_messages
  WHERE whatsapp_msg_id IS NOT NULL
)
DELETE FROM public.group_messages
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Substitui o índice simples por UNIQUE (DROP seguro — será recriado)
DROP INDEX IF EXISTS idx_group_messages_whatsapp_msg_id;

CREATE UNIQUE INDEX IF NOT EXISTS group_messages_org_whatsapp_msg_id_unique
  ON public.group_messages (organization_id, whatsapp_msg_id)
  WHERE whatsapp_msg_id IS NOT NULL;

COMMENT ON INDEX public.group_messages_org_whatsapp_msg_id_unique IS
  'Migration 114: impede duplicatas de group_messages por webhook retry. '
  'Mesmo padrão do messages_org_whatsapp_msg_id_unique (migration 064).';

-- ============================================================================
-- Rollback (não executar — apenas referência)
-- ============================================================================
-- DROP INDEX IF EXISTS public.idx_messages_content_fts;
-- DROP INDEX IF EXISTS public.idx_messages_org_lead;
-- DROP INDEX CONCURRENTLY IF EXISTS public.group_messages_org_whatsapp_msg_id_unique;
-- CREATE INDEX IF NOT EXISTS idx_group_messages_whatsapp_msg_id
--   ON group_messages (organization_id, whatsapp_msg_id)
--   WHERE whatsapp_msg_id IS NOT NULL;
