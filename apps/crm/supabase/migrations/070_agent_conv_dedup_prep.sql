-- PR-1 Auditoria Flow (mai/2026): preparacao pra UNIQUE em agent_conversations.
--
-- Endereca achados criticos de duas rodadas de auditoria
-- (POST_CODEX_AUDIT_AGENT_FLOW_353.md, rodadas 5 + 8 + 9):
--
-- 1. Rodada 5 #critica: agent_conversations sem UNIQUE em
--    (org, lead, crm_conversation_id) permite duplicacao sob concorrencia
--    de webhooks. Esta migration faz o PREP (log + auditoria) e a 071
--    aplica o UNIQUE de fato.
--
-- 2. Rodada 8 #media: agent_knowledge_chunks sem indice composto faz
--    seq scan em buildFullModeBlock. Adicionado idx_chunks_source_chunk.
--
-- 3. Rodada 9 #media: migration 054 forcou behavior_mode='flow' mas
--    nao limpou o array legado `actions_executed` (que continha stage
--    names antigos pre-pivot). Cleanup aqui.
--
-- Esta migration NUNCA falha — sempre roda (operacoes idempotentes).
-- A 071 valida que nao restou duplicata e cria a UNIQUE; se restar,
-- 071 falha com mensagem dizendo pro operador inspecionar
-- agent_conversations_merge_log e DELETAR manualmente.
--
-- Convencao mai/2026: dry-run log primeiro, DELETE manual depois.
-- Diferente da 063 (conversations duplicadas) que auto-mergeava porque
-- conversations tem FKs simples; agent_conversations tem agent_runs e
-- pending_messages como filhos com ON DELETE CASCADE, entao DELETE
-- auto perderia runs/audit/pending — opera manual e seguro.

-- ============================================================================
-- Step 1: Tabela de log permanente (audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_conversations_merge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  crm_conversation_id UUID NOT NULL,
  duplicate_id UUID NOT NULL,
  kept_id UUID NOT NULL,
  duplicate_current_node_id TEXT,
  kept_current_node_id TEXT,
  duplicate_updated_at TIMESTAMPTZ,
  kept_updated_at TIMESTAMPTZ,
  reason TEXT NOT NULL DEFAULT 'pr1_dry_run',
  resolved_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_conv_merge_log_unresolved
  ON public.agent_conversations_merge_log (organization_id, detected_at)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE public.agent_conversations_merge_log IS
  'Audit trail de duplicatas detectadas em agent_conversations antes de aplicar UNIQUE. '
  'Cada linha = uma agent_conversations que seria deletada se merge automatico fosse aplicado. '
  'Operador inspeciona, decide o merge (re-apontar agent_runs/pending_messages), deleta a duplicate_id, '
  'marca resolved_at, e roda migration 071 pra aplicar UNIQUE.';

-- ============================================================================
-- Step 2: Detectar e logar duplicatas existentes
-- ============================================================================
-- Criterio de "kept": linha com current_node_id NOT NULL (conversa em
-- andamento ganha sobre conversa zerada). Desempate: updated_at mais
-- recente. Determinístico — mesmo cenario sempre escolhe a mesma keep.
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  WITH ranked AS (
    SELECT
      id,
      organization_id,
      lead_id,
      crm_conversation_id,
      current_node_id,
      updated_at,
      ROW_NUMBER() OVER (
        PARTITION BY organization_id, lead_id, crm_conversation_id
        ORDER BY (current_node_id IS NOT NULL) DESC, updated_at DESC, id ASC
      ) AS rn,
      FIRST_VALUE(id) OVER (
        PARTITION BY organization_id, lead_id, crm_conversation_id
        ORDER BY (current_node_id IS NOT NULL) DESC, updated_at DESC, id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      ) AS kept_id,
      FIRST_VALUE(current_node_id) OVER (
        PARTITION BY organization_id, lead_id, crm_conversation_id
        ORDER BY (current_node_id IS NOT NULL) DESC, updated_at DESC, id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      ) AS kept_current_node_id,
      FIRST_VALUE(updated_at) OVER (
        PARTITION BY organization_id, lead_id, crm_conversation_id
        ORDER BY (current_node_id IS NOT NULL) DESC, updated_at DESC, id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      ) AS kept_updated_at
    FROM public.agent_conversations
    WHERE crm_conversation_id IS NOT NULL
  )
  INSERT INTO public.agent_conversations_merge_log (
    organization_id,
    lead_id,
    crm_conversation_id,
    duplicate_id,
    kept_id,
    duplicate_current_node_id,
    kept_current_node_id,
    duplicate_updated_at,
    kept_updated_at,
    reason
  )
  SELECT
    organization_id,
    lead_id,
    crm_conversation_id,
    id,
    kept_id,
    current_node_id,
    kept_current_node_id,
    updated_at,
    kept_updated_at,
    'pr1_dry_run'
  FROM ranked
  WHERE rn > 1
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS dup_count = ROW_COUNT;

  IF dup_count > 0 THEN
    RAISE NOTICE
      'Encontradas % linhas duplicadas em agent_conversations. '
      'Inspecione public.agent_conversations_merge_log antes de aplicar a migration 071. '
      'Operador precisa: (1) re-apontar agent_runs.agent_conversation_id e '
      'pending_messages.agent_conversation_id de duplicate_id pra kept_id, '
      '(2) DELETE FROM agent_conversations WHERE id IN duplicate_id, '
      '(3) UPDATE merge_log SET resolved_at = now() WHERE resolved_at IS NULL, '
      '(4) rodar migration 071 pra aplicar UNIQUE.',
      dup_count;
  ELSE
    RAISE NOTICE
      'Nenhuma duplicata detectada em agent_conversations. '
      'Migration 071 pode rodar imediatamente apos esta.';
  END IF;
END $$;

-- ============================================================================
-- Step 3: Indice composto pra acelerar buildFullModeBlock (R8 #5)
-- ============================================================================
-- buildKnowledgeBlock em modo 'full' faz SELECT em agent_knowledge_chunks
-- com JOIN em agent_knowledge_sources filtrando por org+config+indexing_status,
-- ordenado por source_id + chunk_index. Sem este indice = seq scan em
-- orgs com docs grandes.
CREATE INDEX IF NOT EXISTS idx_chunks_source_chunk
  ON public.agent_knowledge_chunks (source_id, chunk_index);

-- ============================================================================
-- Step 4: Cleanup actions_executed legado (R9 #5)
-- ============================================================================
-- Migration 054 pivotou behavior_mode pra 'flow' mas preservou o array
-- legado `actions_executed` (que continha stage names antigos como
-- "qualificacao", "fechamento" etc). actions_executed_detail (PR #265)
-- e o canonical agora, com keys tipo "on_enter:<node_uuid>".
--
-- Limpa `actions_executed` em conversas migradas (que tem
-- current_node_id setado ou actions_executed_detail populado) pra evitar
-- confusao em scripts/queries que ainda iterarem o array legado.
-- Conversas pre-migration sem flow nao sao tocadas.
UPDATE public.agent_conversations
SET actions_executed = '[]'::jsonb
WHERE actions_executed IS NOT NULL
  AND jsonb_array_length(actions_executed) > 0
  AND (
    current_node_id IS NOT NULL
    OR (actions_executed_detail IS NOT NULL AND actions_executed_detail::text <> '{}')
  );

-- ============================================================================
-- Rollback (manual):
--
-- DROP INDEX IF EXISTS idx_chunks_source_chunk;
-- DROP INDEX IF EXISTS idx_agent_conv_merge_log_unresolved;
-- DROP TABLE IF EXISTS public.agent_conversations_merge_log;
--
-- Nota: o cleanup do `actions_executed` em Step 4 e irreversivel.
-- Os valores antigos (stage names legacy) nao sao recuperaveis sem
-- backup. Por design — o array legado e dado morto pos-pivot 054.
-- ============================================================================
