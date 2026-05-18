-- ============================================================
-- MIGRATION 047: AI Agent — agent_runs.is_test flag
-- ------------------------------------------------------------
-- Tester fiel (PR-AI-AGENT-TESTER-FAITHFUL, mai/2026) executa o
-- pipeline real (tryEnqueueForNativeAgent + executeDebouncedBatch)
-- com provider stub. Cria registros REAIS em agent_runs +
-- agent_steps + agent_conversations — auditoria completa, mesmo
-- custo OpenAI real.
--
-- Pra dashboards de custo/uso filtrarem testes facilmente, marca
-- run com is_test=true. Hoje a convenção tester era
-- "inbound_message_id IS NULL", mas isso conflita com futuras
-- features (ex: runs disparados por scheduler tambem nao tem
-- inbound). Coluna explicita resolve.
--
-- Default false: 100% das rows existentes ficam como producao
-- (correto). UI Tester insere com is_test=true via param novo.
-- ============================================================

BEGIN;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

-- Index parcial pra dashboards filtrarem custos de prod
-- rapidamente. Apenas runs de prod (is_test=false) sao indexados.
CREATE INDEX IF NOT EXISTS idx_agent_runs_org_prod_created
  ON public.agent_runs (organization_id, created_at DESC)
  WHERE is_test = FALSE;

COMMIT;
