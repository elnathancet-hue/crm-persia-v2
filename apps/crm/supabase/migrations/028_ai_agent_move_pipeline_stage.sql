-- Migration 028 — AI Agent: native handler `move_pipeline_stage`
--
-- Adiciona um novo handler nativo que permite o agente mover o lead
-- de uma etapa do Kanban (pipeline_stages) para outra. O CHECK
-- constraint original em 017_ai_agent_core.sql restringe o conjunto
-- de valores aceitos em `agent_tools.native_handler` — precisamos
-- recriar a constraint pra incluir 'move_pipeline_stage'.
--
-- Idempotente: usa DROP CONSTRAINT IF EXISTS antes de recriar.
-- Seguro pra retry caso `supabase db push` falhe no meio do bloco.

ALTER TABLE public.agent_tools DROP CONSTRAINT IF EXISTS agent_tools_native_handler_check;

ALTER TABLE public.agent_tools ADD CONSTRAINT agent_tools_native_handler_check CHECK (
  native_handler IS NULL OR native_handler IN (
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
    'move_pipeline_stage'
  )
);
