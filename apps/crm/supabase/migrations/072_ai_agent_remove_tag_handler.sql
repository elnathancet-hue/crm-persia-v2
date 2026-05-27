-- ============================================================
-- MIGRATION 072: AI Agent — handler remove_tag
-- ------------------------------------------------------------
-- PR-6 Auditoria (mai/2026): endereca rodada 1 #3 + rodada 4 matriz do
-- POST_CODEX_AUDIT_AGENT_FLOW_353.md. `remove_tag` ja aparecia no
-- catalogo da UI e no FlowActionType, mas o runtime nao tinha handler.
-- Resultado: cliente arrastava o card "Remover tag", configurava
-- tag_name, salvava e ativava o agente. Em runtime, o flow runner
-- emitia guardrail event "handler nao implementado" e seguia a edge
-- default — silenciosamente, sem remover nada.
--
-- Decidido no plano da rodada: IMPLEMENTAR (50 LOC + 1 teste) em vez de
-- remover do catalogo. Cliente ja ve a opcao na UI; remover gera
-- regressao percebida. Implementar e baixo custo e fecha o gap.
--
-- Esta migration so adiciona o valor ao CHECK constraint. O handler
-- vive em apps/crm/src/lib/ai-agent/tools/remove-tag.ts e o registry
-- em apps/crm/src/lib/ai-agent/tools/registry.ts.
--
-- IDEMPOTENCIA: DROP/ADD CONSTRAINT — re-rodar sobrescreve.
-- ============================================================

BEGIN;

ALTER TABLE public.agent_tools
  DROP CONSTRAINT IF EXISTS agent_tools_native_handler_check;

ALTER TABLE public.agent_tools
  ADD CONSTRAINT agent_tools_native_handler_check CHECK (
    native_handler IS NULL OR native_handler IN (
      -- Handlers originais (migration 017)
      'transfer_to_user',
      'transfer_to_stage',
      'transfer_to_agent',
      'add_tag',
      'assign_source',
      'assign_product',
      'assign_department',
      'round_robin_user',
      'round_robin_agent',
      'send_audio',
      'trigger_notification',
      'schedule_event',
      'stop_agent',
      'move_pipeline_stage',
      -- PR-AGENDA-TOOLS (mai/2026)
      'create_appointment',
      'list_lead_appointments',
      'cancel_appointment',
      'reschedule_appointment',
      -- PR-AI-AGENT-HUMAN-D (mai/2026)
      'send_media',
      -- PR-FLOW-PIVOT PR 7 (mai/2026)
      'emit_event',
      -- PR-FLOW-PIVOT PR 8 (mai/2026)
      'set_lead_custom_field',
      -- PR-6 Auditoria (mai/2026)
      'remove_tag'
    )
  );

COMMENT ON CONSTRAINT agent_tools_native_handler_check ON public.agent_tools IS
  'PR-6 Auditoria (mai/2026): adiciona remove_tag. Espelhar com NATIVE_HANDLERS em @persia/shared/ai-agent/types.ts.';

COMMIT;

-- ============================================================
-- ROLLBACK MANUAL:
--   ALTER TABLE public.agent_tools
--     DROP CONSTRAINT agent_tools_native_handler_check;
--   -- Re-adicionar o constraint da migration 057 (versao anterior).
-- ============================================================
