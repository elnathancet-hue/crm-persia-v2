-- ============================================================
-- MIGRATION 046: AI Agent — behavior_mode (stages vs actions) (PR 4/6)
-- ------------------------------------------------------------
-- Coexistencia entre 2 modelos mentais de "etapas":
--
--   stages (legado): cada agent_stage tem `instruction` text livre que
--                    funciona como sub-prompt — executor TROCA o system
--                    prompt por etapa, criando uma state machine.
--
--   actions (novo):  agent_stages viram acoes tipadas. system_prompt do
--                    agente fica fixo. Cada agent_stage tem `action_type`
--                    enum que diz QUE acao tomar (qualificar/enviar
--                    material/agendar/etc) — executor injeta lista no
--                    contexto, LLM escolhe.
--
-- Default: 'stages' pra rows existentes (zero migration de dados,
-- comportamento intacto). Wizard de criacao novo passa a usar 'actions'.
--
-- agent_stages.action_type e NULLABLE — so faz sentido quando
-- behavior_mode='actions'. Quando 'stages', e ignorado. Sem CHECK
-- cruzado pra simplificar (validacao na aplicacao).
-- ============================================================

BEGIN;

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS behavior_mode TEXT NOT NULL DEFAULT 'stages'
    CHECK (behavior_mode IN ('stages', 'actions'));

ALTER TABLE public.agent_stages
  ADD COLUMN IF NOT EXISTS action_type TEXT NULL
    CHECK (action_type IN (
      'qualify',
      'send_material',
      'schedule',
      'add_tag',
      'move_pipeline',
      'transfer',
      'free_message'
    ));

COMMENT ON COLUMN public.agent_configs.behavior_mode IS
  'PR-AGENT-INTEGRATION-4 (mai/2026): stages=legado (sub-prompt por etapa), actions=novo (system_prompt unico + acoes tipadas). Default stages preserva agentes existentes. Wizard novo cria com actions.';

COMMENT ON COLUMN public.agent_stages.action_type IS
  'PR-AGENT-INTEGRATION-4: tipo da acao quando agent_configs.behavior_mode=actions. Ignorado quando mode=stages. Validacao cruzada na aplicacao.';

COMMIT;

-- Rollback (manual):
--   ALTER TABLE public.agent_stages DROP COLUMN IF EXISTS action_type;
--   ALTER TABLE public.agent_configs DROP COLUMN IF EXISTS behavior_mode;
