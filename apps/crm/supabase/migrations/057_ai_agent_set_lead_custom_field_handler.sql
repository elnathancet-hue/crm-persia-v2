-- ============================================================
-- MIGRATION 057: AI Agent — handler set_lead_custom_field
-- ------------------------------------------------------------
-- PR-FLOW-PIVOT PR 8 (mai/2026): adiciona `set_lead_custom_field` ao
-- CHECK constraint de `agent_tools.native_handler`.
--
-- Permite a IA escrever em `lead_custom_field_values` durante a
-- conversa. Paridade com `edit_lead_ia: true` do flow.json do Jordan
-- Moura (Humana Saúde — referência do flow pivot).
--
-- Handler resolve `custom_field` por `field_key` (slug) + faz upsert
-- no valor (TEXT). Lookup é cross-org-safe via `organization_id`
-- explícito na query.
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
      'set_lead_custom_field'
    )
  );

COMMENT ON CONSTRAINT agent_tools_native_handler_check ON public.agent_tools IS
  'PR-FLOW-PIVOT PR 8 (mai/2026): valida que native_handler é um valor conhecido. Lista cresce com PRs novos que adicionam handlers. Mantém NATIVE_HANDLERS em @persia/shared/ai-agent/types.ts em sync.';

COMMIT;
