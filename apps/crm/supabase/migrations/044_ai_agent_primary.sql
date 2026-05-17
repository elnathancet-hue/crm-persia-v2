-- ============================================================
-- MIGRATION 044: AI Agent — agente principal (PR 3/6)
-- ------------------------------------------------------------
-- Adiciona is_primary boolean em agent_configs. Cada organizacao
-- tem 1 (e apenas 1) agente principal, que e o "router" que recebe
-- a primeira mensagem do lead.
--
-- Agentes secundarios (is_primary=false) so respondem se baterem
-- com alguma condicao de entrada (tabela agent_entry_conditions,
-- migration 045). Uma vez que o secundario pegou o lead, ele fica
-- responsavel ate o handoff humano (stickiness via
-- agent_conversations.config_id, que ja existe).
--
-- Unique partial index garante que so pode haver 1 primary ativo
-- por org. Update concorrente: aplicacao seta is_primary=false em
-- todos da org antes de setar=true no escolhido (transacional).
-- ============================================================

BEGIN;

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

-- Unique partial index — apenas 1 agente principal por org.
CREATE UNIQUE INDEX IF NOT EXISTS agent_configs_one_primary_per_org
  ON public.agent_configs (organization_id)
  WHERE is_primary = true;

COMMENT ON COLUMN public.agent_configs.is_primary IS
  'PR-AGENT-INTEGRATION-3 (mai/2026): agente principal da org. Unico TRUE por organization_id (unique partial index). Recebe a primeira msg do lead e roteia pra secundarios baseado em agent_entry_conditions.';

COMMIT;

-- Rollback (manual):
--   DROP INDEX IF EXISTS public.agent_configs_one_primary_per_org;
--   ALTER TABLE public.agent_configs DROP COLUMN IF EXISTS is_primary;
