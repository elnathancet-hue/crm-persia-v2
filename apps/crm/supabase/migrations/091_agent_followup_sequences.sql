-- 091: follow-up de automacao como sequencia por conversa
-- Evolui agent_followups de gatilhos independentes para filas encadeadas:
-- - cada etapa tem janela de envio
-- - cada conversa tem estado proprio
-- - cada envio fica auditavel em agent_followup_runs

BEGIN;

ALTER TABLE public.agent_followups
  ADD COLUMN IF NOT EXISTS send_window_start TIME NOT NULL DEFAULT TIME '08:00',
  ADD COLUMN IF NOT EXISTS send_window_end   TIME NOT NULL DEFAULT TIME '18:00',
  ADD COLUMN IF NOT EXISTS require_ai_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.agent_followup_runs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sending', 'sent', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

UPDATE public.agent_followup_runs
SET sent_at = COALESCE(sent_at, fired_at)
WHERE sent_at IS NULL
  AND status = 'sent';

CREATE TABLE IF NOT EXISTS public.agent_followup_conversation_states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  agent_conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  current_followup_id UUID REFERENCES public.agent_followups(id) ON DELETE SET NULL,
  current_order_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'eligible', 'sent', 'paused', 'cancelled', 'finished')),
  next_run_at TIMESTAMPTZ,
  last_company_message_at TIMESTAMPTZ,
  last_lead_message_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  pause_reason TEXT,
  cancel_reason TEXT,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_followup_states_org_config_status
  ON public.agent_followup_conversation_states (organization_id, config_id, status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_agent_followup_states_current_followup
  ON public.agent_followup_conversation_states (current_followup_id)
  WHERE current_followup_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_followup_runs_conv_status
  ON public.agent_followup_runs (organization_id, conversation_id, status);

ALTER TABLE public.agent_followup_conversation_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_followup_states_select" ON public.agent_followup_conversation_states;

CREATE POLICY "agent_followup_states_select" ON public.agent_followup_conversation_states
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

-- Escrita fica restrita ao service_role usado pelo runtime.

COMMIT;
