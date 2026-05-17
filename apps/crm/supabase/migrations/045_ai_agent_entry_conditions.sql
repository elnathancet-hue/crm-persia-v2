-- ============================================================
-- MIGRATION 045: AI Agent — entry conditions (PR 3/6)
-- ------------------------------------------------------------
-- Tabela agent_entry_conditions guarda as regras de roteamento pra
-- agentes secundarios. Quando a primeira msg do lead chega, o
-- executor avalia conditions de cada agente nao-principal — se
-- alguma bate (OR logic), seta agent_conversations.config_id pro
-- secundario e o lead "fica preso" nele (stickiness).
--
-- Tipos de condition:
--   - tag_match: condition_value = { tag_name: string }
--   - segment_match: condition_value = { segment_id: uuid }
--   - message_contains: condition_value = { keyword: string }
--     (case-insensitive substring match na primeira msg)
--   - pipeline_stage_match: condition_value = { stage_id: uuid }
--   - lead_status_match: condition_value = { status: string }
--
-- Priority: avaliacao desc. Em caso de empate, ordem de criacao.
-- Apenas o PRIMEIRO match vence (sem chains).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_entry_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_config_id UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  condition_type TEXT NOT NULL CHECK (condition_type IN (
    'tag_match',
    'segment_match',
    'message_contains',
    'pipeline_stage_match',
    'lead_status_match'
  )),
  condition_value JSONB NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_entry_conditions_org_config
  ON public.agent_entry_conditions(organization_id, agent_config_id);

CREATE INDEX IF NOT EXISTS agent_entry_conditions_eval_order
  ON public.agent_entry_conditions(organization_id, priority DESC, created_at ASC);

ALTER TABLE public.agent_entry_conditions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_entry_conditions_select" ON public.agent_entry_conditions
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));
CREATE POLICY "agent_entry_conditions_insert" ON public.agent_entry_conditions
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_entry_conditions_update" ON public.agent_entry_conditions
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_entry_conditions_delete" ON public.agent_entry_conditions
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

COMMENT ON TABLE public.agent_entry_conditions IS
  'PR-AGENT-INTEGRATION-3 (mai/2026): regras de roteamento pra agentes secundarios. OR logic — primeiro match (ordenado por priority desc, created_at asc) ganha. Agente principal nao precisa de conditions (ele e o fallback).';

COMMIT;

-- Rollback (manual):
--   DROP TABLE IF EXISTS public.agent_entry_conditions;
