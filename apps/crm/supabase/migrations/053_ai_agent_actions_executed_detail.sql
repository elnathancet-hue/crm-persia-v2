-- ============================================================
-- MIGRATION 053: agent_conversations.actions_executed_detail
-- ------------------------------------------------------------
-- PR3 (mai/2026 — opcao C) "per-action retry tracking".
--
-- CONTEXTO:
--   Migration 049 introduziu agent_conversations.actions_executed
--   (JSONB array de stage_ids) como flag idempotency por etapa. Quando
--   o lead entrava numa stage, runStageAutoActionsIfPending rodava
--   TODAS as auto_actions ON_ENTER e marcava stage_id no array — re-
--   entrada na mesma etapa pulava tudo.
--
--   Problema: se 1 das N acoes da etapa falhasse (provider down, etc),
--   a stage AINDA era marcada como visitada. Retry naive (re-rodar
--   tudo) causaria duplicacao de side effects nao-idempotentes
--   (send_media manda WhatsApp 2x, trigger_notification notifica
--   equipe 2x).
--
-- ESTA MIGRATION:
--   Adiciona coluna `actions_executed_detail JSONB DEFAULT '{}'` com
--   shape estruturado por stage_id e por action_index:
--
--   {
--     "<stage_id>": {
--       "succeeded": [0, 2],
--       "failed": {
--         "1": { "attempts": 2, "last_error": "provider timeout" }
--       }
--     }
--   }
--
--   Runtime (proximo PR step) usa esse detail pra:
--     - Pular acoes ja em `succeeded` na re-entrada
--     - Re-tentar acoes em `failed` ate MAX_RETRIES (default 3)
--     - Marcar stage_id no array legado `actions_executed` SOMENTE
--       quando TODAS as acoes completaram (success ou max_retries
--       exceeded)
--
-- RETROCOMPAT:
--   - Rows existentes recebem `'{}'` (sem detail) — runtime trata
--     como "nunca rodou nada" pra essa stage. Combinado com o
--     `actions_executed` legado, runtime sabe distinguir:
--       * stage_id em actions_executed E sem detail → legado, ja
--         rodou (PR pre-053), nao re-roda
--       * stage_id NAO em actions_executed E sem detail → primeira
--         entrada, roda tudo
--       * detail presente → consulta succeeded/failed por index
--
-- IDEMPOTENCIA: ADD COLUMN IF NOT EXISTS — re-rodar nao quebra.
-- CHECK: garante shape de objeto (defensive); validacao interna em
-- aplicacao via normalizeActionsExecutedDetail.
-- ============================================================

BEGIN;

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS actions_executed_detail JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.agent_conversations
  DROP CONSTRAINT IF EXISTS agent_conversations_actions_executed_detail_object;

ALTER TABLE public.agent_conversations
  ADD CONSTRAINT agent_conversations_actions_executed_detail_object
    CHECK (jsonb_typeof(actions_executed_detail) = 'object');

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   ALTER TABLE public.agent_conversations
--     DROP CONSTRAINT IF EXISTS agent_conversations_actions_executed_detail_object;
--   ALTER TABLE public.agent_conversations
--     DROP COLUMN IF EXISTS actions_executed_detail;
-- COMMIT;
