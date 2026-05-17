-- ============================================================
-- MIGRATION 043: AI Agent — handler send_media
-- ------------------------------------------------------------
-- Estende o CHECK constraint de `agent_tools.native_handler` pra
-- aceitar 'send_media'. Sem isso, materializePresetTool falha ao
-- inserir tool desse handler.
--
-- Agente passa a poder enviar imagens, PDFs, videos, audios e
-- documentos da Biblioteca de midia (automation_tools table) quando
-- a tool e habilitada na stage.
--
-- Re-cria o constraint completo (lista de migrations 017 + 040 +
-- send_media).
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
      -- PR-AGENDA-TOOLS (mai/2026): handlers de Agenda
      'create_appointment',
      'list_lead_appointments',
      'cancel_appointment',
      'reschedule_appointment',
      -- PR-AI-AGENT-HUMAN-D (mai/2026): envio de midia da biblioteca
      'send_media'
    )
  );

COMMIT;

-- Rollback manual:
--   1) DELETE FROM public.agent_tools WHERE native_handler = 'send_media';
--   2) Re-cria o constraint sem 'send_media'.
