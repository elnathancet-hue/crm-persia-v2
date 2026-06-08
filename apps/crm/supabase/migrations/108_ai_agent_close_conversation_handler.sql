-- ============================================================
-- MIGRATION 108: AI Agent — handler close_conversation
-- ------------------------------------------------------------
-- Auditoria Automacoes (jun/2026): adiciona `close_conversation` ao
-- CHECK constraint de `agent_tools.native_handler`.
--
-- Semântica: fecha a conversa atual (conversations.status='closed')
-- sem encerrar o agente ou transferir pra humano. Lead continua ativo.
-- Diferente de stop_agent (pausa agent_conversation) — aqui apenas a
-- conversa WhatsApp é encerrada. Um novo inbound cria nova conversa e
-- o agente pode retomar normalmente.
--
-- IDEMPOTENCIA: ALTER TABLE DROP/ADD CONSTRAINT — re-rodar sobrescreve.
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
      'remove_tag',
      -- Auditoria Automacoes (jun/2026)
      'close_conversation'
    )
  );

COMMENT ON CONSTRAINT agent_tools_native_handler_check ON public.agent_tools IS
  'Auditoria Automacoes (jun/2026): valida que native_handler é um valor conhecido. Lista cresce com PRs novos que adicionam handlers. Mantém NATIVE_HANDLERS em @persia/shared/ai-agent/types.ts em sync.';

COMMIT;
