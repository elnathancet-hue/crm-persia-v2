-- Migration 099: Performance indexes — lead_activities, agent_runs, agent_steps
-- Identified in performance audit (jun/2026).
--
-- 1. lead_activities(lead_id, created_at DESC)
--    Drawer "Histórico" do lead faz:
--      SELECT ... FROM lead_activities WHERE lead_id=? ORDER BY created_at DESC
--    Sem índice = full scan na tabela. Composto com created_at evita sort separado.
--
-- 2. lead_activities(organization_id, created_at DESC)
--    listOrgActivities (tab Atividades global) faz:
--      SELECT ... FROM lead_activities WHERE organization_id=? ORDER BY created_at DESC
--    Tabela cresce com toda ação de lead — índice crítico para orgs grandes.
--
-- 3. agent_runs(organization_id, agent_conversation_id, created_at)
--    assertWithinRateLimits é chamado em CADA mensagem inbound com agente ativo:
--      SELECT id FROM agent_runs
--        WHERE organization_id=? AND agent_conversation_id=? AND created_at >= now()-60s
--    Três colunas, todas necessárias no filtro — índice composto cobre exatamente.
--
-- 4. agent_runs(organization_id) WHERE status='running'   [partial]
--    Segunda checagem de rate limit: max concurrent runs por org.
--      SELECT id FROM agent_runs WHERE organization_id=? AND status='running'
--    Partial index descarta runs terminados (99%+ das linhas), tornando-o minúsculo.
--
-- 5. agent_runs(organization_id, created_at DESC)
--    listRuns (Histórico AI) e cost-limits daily aggregation:
--      SELECT * FROM agent_runs WHERE organization_id=? ORDER BY created_at DESC LIMIT N
--
-- 6. agent_steps(run_id, order_index)
--    attachSteps busca steps de N runs de uma vez:
--      SELECT * FROM agent_steps WHERE run_id IN (...) ORDER BY order_index ASC

-- 1. lead_activities por lead
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id_created_at
  ON public.lead_activities(lead_id, created_at DESC);

-- 2. lead_activities por org (timeline global)
CREATE INDEX IF NOT EXISTS idx_lead_activities_org_created_at
  ON public.lead_activities(organization_id, created_at DESC);

-- 3. agent_runs — rate limit por conversa (hot path)
CREATE INDEX IF NOT EXISTS idx_agent_runs_org_conv_created_at
  ON public.agent_runs(organization_id, agent_conversation_id, created_at);

-- 4. agent_runs — concurrent runs (partial, só rows 'running')
CREATE INDEX IF NOT EXISTS idx_agent_runs_org_running
  ON public.agent_runs(organization_id)
  WHERE status = 'running';

-- 5. agent_runs — listagem + cost aggregation
CREATE INDEX IF NOT EXISTS idx_agent_runs_org_created_at
  ON public.agent_runs(organization_id, created_at DESC);

-- 6. agent_steps — por run_id + ordem
CREATE INDEX IF NOT EXISTS idx_agent_steps_run_id_order
  ON public.agent_steps(run_id, order_index);
