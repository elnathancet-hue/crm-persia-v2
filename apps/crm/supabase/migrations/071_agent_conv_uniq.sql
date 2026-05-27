-- PR-1 Auditoria Flow (mai/2026): UNIQUE em agent_conversations (org, lead, crm_conv).
--
-- Endereca rodada 5 #critica do POST_CODEX_AUDIT_AGENT_FLOW_353.md:
-- SELECT-then-INSERT em executor.ts:534-603 sem captura de 23505 permite
-- 2 webhooks paralelos criarem 2 linhas pro mesmo lead. Stickiness do
-- PR #339 so age quando ja existe linha — primeira mensagem fica vulneravel.
--
-- Esta migration aplica a UNIQUE de fato. Pre-requisito: migration 070
-- ja rodou e nenhuma duplicata existe (ou foram deletadas manualmente).
--
-- Comportamento:
--   * env limpo (sem duplicatas): aplica UNIQUE imediatamente. ✓
--   * env sujo (com duplicatas): RAISE EXCEPTION. Migration falha com
--     mensagem dizendo pro operador inspecionar agent_conversations_merge_log,
--     deletar duplicatas manualmente, e rodar de novo.
--
-- Idempotente: CREATE UNIQUE INDEX IF NOT EXISTS no final, entao rodar
-- 2x nao quebra.

-- ============================================================================
-- Gate: zero duplicatas antes de aplicar UNIQUE
-- ============================================================================
DO $$
DECLARE
  dup_groups INTEGER;
  dup_total INTEGER;
BEGIN
  SELECT
    COUNT(*),
    COALESCE(SUM(cnt), 0)
  INTO dup_groups, dup_total
  FROM (
    SELECT organization_id, lead_id, crm_conversation_id, COUNT(*) AS cnt
    FROM public.agent_conversations
    WHERE crm_conversation_id IS NOT NULL
    GROUP BY organization_id, lead_id, crm_conversation_id
    HAVING COUNT(*) > 1
  ) d;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION
      'Migration 071 abortada: % grupo(s) duplicado(s) com % linhas totais em agent_conversations. '
      'Pre-requisitos pra aplicar a UNIQUE: '
      '(1) inspecione public.agent_conversations_merge_log (populada pela migration 070); '
      '(2) re-aponte agent_runs.agent_conversation_id e pending_messages.agent_conversation_id '
      'de duplicate_id pra kept_id; '
      '(3) DELETE FROM agent_conversations WHERE id IN (duplicate_id); '
      '(4) UPDATE agent_conversations_merge_log SET resolved_at = now() WHERE resolved_at IS NULL; '
      '(5) rode esta migration de novo.',
      dup_groups, dup_total;
  ELSE
    RAISE NOTICE 'Nenhuma duplicata detectada. Aplicando UNIQUE...';
  END IF;
END $$;

-- ============================================================================
-- UNIQUE partial (preserva linhas legacy onde crm_conversation_id e null)
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS agent_conversations_org_lead_crm_uniq
  ON public.agent_conversations (organization_id, lead_id, crm_conversation_id)
  WHERE crm_conversation_id IS NOT NULL;

COMMENT ON INDEX public.agent_conversations_org_lead_crm_uniq IS
  'PR-1 Auditoria (mai/2026): impede 2+ agent_conversations pro mesmo '
  '(org, lead, crm_conv). Race window em SELECT-then-INSERT no executor '
  'agora cai em 23505 capturado por catch + re-SELECT.';

-- ============================================================================
-- Rollback (manual):
-- DROP INDEX IF EXISTS public.agent_conversations_org_lead_crm_uniq;
-- ============================================================================
