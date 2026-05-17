-- ============================================================
-- MIGRATION 040: AI Agent — handlers de Agenda
-- ------------------------------------------------------------
-- Adiciona 4 valores no CHECK constraint de `agent_tools.native_handler`:
--   - create_appointment
--   - list_lead_appointments
--   - cancel_appointment
--   - reschedule_appointment
--
-- Sem isso, o LLM não consegue agendar/listar/cancelar/reagendar pelo
-- chat — operador tem que sair do chat e usar UI da Agenda manual.
--
-- Constraint completo original em migration 017_ai_agent_core.sql.
-- Re-cria com os 4 novos valores anexados.
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
      -- PR-AGENDA-TOOLS (mai/2026): handlers novos pra Agenda
      'create_appointment',
      'list_lead_appointments',
      'cancel_appointment',
      'reschedule_appointment'
    )
  );

COMMIT;

-- ============================================================
-- ROLLBACK MANUAL (se necessario):
--   ALTER TABLE public.agent_tools
--     DROP CONSTRAINT agent_tools_native_handler_check;
--   ALTER TABLE public.agent_tools
--     ADD CONSTRAINT agent_tools_native_handler_check CHECK (
--       native_handler IS NULL OR native_handler IN (
--         'transfer_to_user', ..., 'move_pipeline_stage'  -- lista original
--       )
--     );
--   -- E remover registros que usam os handlers novos:
--   DELETE FROM public.agent_tools
--   WHERE native_handler IN (
--     'create_appointment', 'list_lead_appointments',
--     'cancel_appointment', 'reschedule_appointment'
--   );
-- ============================================================
