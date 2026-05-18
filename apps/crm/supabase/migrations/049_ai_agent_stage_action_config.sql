-- ============================================================
-- MIGRATION 049: AI Agent — action_config em etapas + idempotencia
-- ------------------------------------------------------------
-- Base estrutural da Opção C do plano A+C ("logica clara das tools").
--
-- PR 3 do plano (PR #248). PR 4 vai wirar o executor pra ler estes
-- campos e disparar as acoes automaticamente; PR 5 expoe via UI.
--
-- O QUE MUDA:
--
-- 1. agent_stages.action_config JSONB
--    Lista de acoes concretas que devem disparar AUTOMATICAMENTE quando
--    a conversa entrar nesta etapa. Cada item e um discriminated union:
--
--    {
--      "auto_actions": [
--        { "type": "add_tag", "tag_name": "qualificado" },
--        { "type": "send_media", "slug": "catalogo-2026" },
--        { "type": "trigger_notification", "template_name": "Lead novo" },
--        { "type": "move_pipeline_stage", "stage_name": "Negociacao" }
--      ]
--    }
--
--    Default '{}' pra rows existentes (zero acoes = comportamento atual).
--    Validacao em aplicacao via normalizeStageActionConfig.
--
-- 2. agent_conversations.actions_executed JSONB
--    Lista de stage_ids onde as acoes ja dispararam pra esta conversa.
--    Garante idempotencia — se o lead volta a entrar na mesma etapa
--    (raro mas possivel via transfer_to_stage), nao re-dispara as
--    mesmas acoes. Default '[]'.
--
-- ZERO BREAKING — coexistencia preservada:
--   - Rows existentes: action_config = '{}' (sem auto-actions = comportamento atual)
--   - Mesmo behavior_mode='stages' funciona igual
--   - Mesmo behavior_mode='actions' (com action_type setado) funciona
--     igual ate o PR 4 conectar
-- ============================================================

BEGIN;

ALTER TABLE public.agent_stages
  ADD COLUMN IF NOT EXISTS action_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS actions_executed JSONB NOT NULL DEFAULT '[]'::jsonb;

-- CHECK leve: garante que action_config e objeto e actions_executed e
-- array. Validacao do shape interno fica em aplicacao (helper shared).
ALTER TABLE public.agent_stages
  ADD CONSTRAINT agent_stages_action_config_object
    CHECK (jsonb_typeof(action_config) = 'object');

ALTER TABLE public.agent_conversations
  ADD CONSTRAINT agent_conversations_actions_executed_array
    CHECK (jsonb_typeof(actions_executed) = 'array');

COMMIT;
