-- 093: fila materializada para follow-up de automacao
-- Transforma a elegibilidade calculada em jobs auditaveis por conversa/etapa.
-- Cada fila pertence a uma sequencia, identificada pela ultima mensagem da
-- empresa. Assim a etapa nao duplica no mesmo ciclo, mas pode recomecar quando
-- a empresa fala novamente apos uma resposta do cliente.

BEGIN;

ALTER TABLE public.agent_followup_runs
  ADD COLUMN IF NOT EXISTS sequence_key TEXT;

UPDATE public.agent_followup_runs
SET sequence_key = COALESCE(sequence_key, 'legacy:' || conversation_id::TEXT)
WHERE sequence_key IS NULL;

ALTER TABLE public.agent_followup_runs
  ALTER COLUMN sequence_key SET NOT NULL;

ALTER TABLE public.agent_followup_runs
  DROP CONSTRAINT IF EXISTS agent_followup_runs_followup_id_conversation_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_followup_runs_followup_conv_seq
  ON public.agent_followup_runs (followup_id, conversation_id, sequence_key);

CREATE TABLE IF NOT EXISTS public.agent_followup_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  agent_conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  crm_conversation_id UUID,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  followup_id UUID NOT NULL REFERENCES public.agent_followups(id) ON DELETE CASCADE,
  sequence_key TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  send_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'cancelled', 'failed', 'skipped')),
  cancel_reason TEXT,
  skip_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_conversation_id, followup_id, sequence_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_followup_jobs_due
  ON public.agent_followup_jobs (status, send_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_agent_followup_jobs_org_config_status
  ON public.agent_followup_jobs (organization_id, config_id, status, send_at);

CREATE INDEX IF NOT EXISTS idx_agent_followup_jobs_conversation_status
  ON public.agent_followup_jobs (organization_id, agent_conversation_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_followup_jobs_sequence
  ON public.agent_followup_jobs (organization_id, agent_conversation_id, sequence_key);

ALTER TABLE public.agent_followup_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_followup_jobs_select" ON public.agent_followup_jobs;

CREATE POLICY "agent_followup_jobs_select" ON public.agent_followup_jobs
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

-- Escrita fica restrita ao service_role usado pelo runtime.

COMMIT;
