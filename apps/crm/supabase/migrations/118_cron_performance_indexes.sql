-- Migration 118: Índices para queries do cron e lista de conversas
--
-- Contexto: spike de disco I/O identificado em jun/2026. Além dos
-- spikes pontuais de criação de índices (migrations 098/099/114),
-- há I/O de baseline contínuo de 3 queries sem índice adequado:
--
-- 1. processFollowUps (cron/all, a cada minuto):
--    flow_executions WHERE status='waiting' AND metadata->>'resume_at' <= now
--    → O índice idx_flow_exec_status filtra por status, mas a avaliação
--      JSONB de metadata->>'resume_at' é linear no número de rows waiting.
--    → Fix: índice de expressão JSONB partial (só rows waiting).
--
-- 2. runFollowupsTick → loadCandidateConversations (cron/all, a cada minuto):
--    agent_conversations WHERE organization_id=X AND config_id=Y
--      AND human_handoff_at IS NULL AND last_interaction_at < threshold
--    → Nenhum índice cobre (org, config_id, last_interaction_at).
--      Lê todas as convs do org+config e filtra human_handoff_at em memória.
--    → Fix: índice composto partial (exclui rows com handoff ativo).
--
-- 3. getConversations (chat — carregado a cada visita à página):
--    conversations WHERE organization_id=X AND status != 'closed'
--      ORDER BY last_message_at DESC
--    → idx_conversations_org cobre org, mas não combina com o sort.
--      PostgreSQL faz sort + filter depois do scan por org.
--    → Fix: índice partial (só abertas) com sort embutido.
--
-- Todos os 3 índices são PARCIAIS — excluem a maioria das rows
-- (closed, com handoff, sem resume_at) tornando-os compactos.

-- ============================================================================
-- Fix 1: flow_executions — expressão JSONB pra processFollowUps
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_flow_exec_resume_at_waiting
  ON public.flow_executions ((metadata->>'resume_at'))
  WHERE status = 'waiting';

COMMENT ON INDEX public.idx_flow_exec_resume_at_waiting IS
  'Migration 118: permite que processFollowUps filtre/ordene por '
  'metadata->>''resume_at'' sem iterar todas as rows waiting. '
  'Partial: só materializa rows com status=waiting (<<total).';

-- ============================================================================
-- Fix 2: agent_conversations — candidatas ao followup tick
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_agent_conv_followup_candidates
  ON public.agent_conversations (organization_id, config_id, last_interaction_at ASC)
  WHERE human_handoff_at IS NULL;

COMMENT ON INDEX public.idx_agent_conv_followup_candidates IS
  'Migration 118: loadCandidateConversations no runFollowupsTick '
  '(cron 1min). Filtra candidatas ao follow-up por (org, config, '
  'last_interaction_at) descartando convs com handoff ativo.';

-- ============================================================================
-- Fix 3: conversations — lista de chat (getConversations)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_conversations_org_open_last_msg
  ON public.conversations (organization_id, last_message_at DESC NULLS LAST)
  WHERE status != 'closed';

COMMENT ON INDEX public.idx_conversations_org_open_last_msg IS
  'Migration 118: getConversations carrega todas as convs abertas '
  'ordenadas por last_message_at. Índice partial exclui closed (bulk '
  'histórico) e embute o sort — evita sort separado sobre idx_org.';

-- ============================================================================
-- Rollback (referência — não executar)
-- ============================================================================
-- DROP INDEX IF EXISTS public.idx_flow_exec_resume_at_waiting;
-- DROP INDEX IF EXISTS public.idx_agent_conv_followup_candidates;
-- DROP INDEX IF EXISTS public.idx_conversations_org_open_last_msg;
