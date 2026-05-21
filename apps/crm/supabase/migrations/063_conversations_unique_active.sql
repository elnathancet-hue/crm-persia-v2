-- Bug C fix (mai/2026): conversations duplicadas pro mesmo lead.
--
-- Sintoma em prod: contato "Elnathan NICOLAS" apareceu em 2 conversations
-- separadas na sidebar do chat — mesmo lead_id, mesmo telefone, mas 2
-- conversations criadas em momentos diferentes (ambas com status='active').
--
-- Causa raiz: SELECT-then-INSERT em apps/crm/src/lib/ai-agent/executor.ts
-- e apps/crm/src/lib/whatsapp/incoming-pipeline.ts. Em condições de race
-- (2 mensagens chegando do mesmo lead em <100ms via webhook UAZAPI), 2
-- requests veem `null` na busca de conv ativa → ambos INSERT criam
-- conversation nova → duplicação.
--
-- Esta migration faz 2 coisas:
--   1. Pre-flight: conta duplicados pra log de auditoria
--   2. Merge: consolida cada grupo duplicado mesclando dados na conv mais
--      antiga (KEEP) e deletando as outras (DROP)
--   3. UNIQUE partial index garante que não acontece mais:
--      (org, lead) com status IN ('active','waiting_human') é único
--
-- Idempotente: pode rodar 2x sem efeito colateral (CREATE UNIQUE INDEX
-- IF NOT EXISTS + merge no-op se não houver dupes).
--
-- TABELAS AFETADAS PELO MERGE:
--   - messages.conversation_id (NOT NULL, ON DELETE CASCADE)
--     → UPDATE pra keep_id antes do DELETE da conv duplicada
--   - agent_conversations.crm_conversation_id (nullable, ON DELETE CASCADE)
--     → UPDATE pra keep_id pra preservar histórico do agente
--   - agent_followup_runs.conversation_id (UUID sem FK, logical reference)
--     → UPDATE pra keep_id (idempotency log do follow-up)
--
-- Critério de KEEP: conversation mais antiga (created_at ASC), desempate
-- por id ASC. Determinístico — mesmo cenário sempre escolhe a mesma conv.

-- Step 1: Pre-flight count (info no log)
DO $$
DECLARE
  dup_groups integer;
  dup_total integer;
BEGIN
  SELECT
    COUNT(*),
    COALESCE(SUM(cnt), 0)
  INTO dup_groups, dup_total
  FROM (
    SELECT organization_id, lead_id, COUNT(*) AS cnt
    FROM public.conversations
    WHERE status IN ('active', 'waiting_human')
    GROUP BY organization_id, lead_id
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_groups > 0 THEN
    RAISE NOTICE 'Found % duplicate (org, lead) groups with % total conversations. Merging...',
      dup_groups, dup_total;
  ELSE
    RAISE NOTICE 'No duplicate active conversations found. Skipping merge.';
  END IF;
END $$;

-- Step 2: Build merge plan (which conv to keep, which to drop, per group)
CREATE TEMP TABLE conv_merge_plan ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    organization_id,
    lead_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, lead_id
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY organization_id, lead_id
      ORDER BY created_at ASC, id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS keep_id
  FROM public.conversations
  WHERE status IN ('active', 'waiting_human')
)
SELECT id AS drop_id, keep_id
FROM ranked
WHERE rn > 1;

-- Step 3: Re-apontar messages (FK NOT NULL — precisa rodar ANTES do DELETE)
UPDATE public.messages m
SET conversation_id = cmp.keep_id
FROM conv_merge_plan cmp
WHERE m.conversation_id = cmp.drop_id;

-- Step 4: Re-apontar agent_conversations.crm_conversation_id
UPDATE public.agent_conversations ac
SET crm_conversation_id = cmp.keep_id
FROM conv_merge_plan cmp
WHERE ac.crm_conversation_id = cmp.drop_id;

-- Step 5: Re-apontar agent_followup_runs.conversation_id (logical FK, sem
-- REFERENCES; conservamos pra idempotency log continuar funcionando)
UPDATE public.agent_followup_runs afr
SET conversation_id = cmp.keep_id
FROM conv_merge_plan cmp
WHERE afr.conversation_id = cmp.drop_id;

-- Step 6: Deletar as conversations duplicadas (agora vazias)
DELETE FROM public.conversations c
USING conv_merge_plan cmp
WHERE c.id = cmp.drop_id;

-- Step 7: UNIQUE partial index garantindo que não acontece de novo.
-- Partial: só status active/waiting_human são únicos por (org, lead).
-- Conversations closed/archived podem coexistir múltiplas (histórico).
CREATE UNIQUE INDEX IF NOT EXISTS conversations_org_lead_active_unique
  ON public.conversations (organization_id, lead_id)
  WHERE status IN ('active', 'waiting_human');

-- Step 8: Comentário no índice pra documentação no DB
COMMENT ON INDEX public.conversations_org_lead_active_unique IS
  'Bug C fix (mai/2026): impede 2+ conversations ativas pro mesmo lead. '
  'Forçar via DB pq application-level SELECT-then-INSERT tinha race window.';

-- ============================================================================
-- Rollback (manual, NÃO faz sentido reverter merge — dados já foram unidos):
-- DROP INDEX IF EXISTS public.conversations_org_lead_active_unique;
-- ============================================================================
