-- Migration 104: Motor de Distribuição por Fila
-- Conecta as filas existentes ao pipeline inbound.
-- Depende de: queues, queue_members, conversations, organizations.

-- 1. Novos campos na tabela queues
ALTER TABLE public.queues
  ADD COLUMN IF NOT EXISTS is_active      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS set_lead_owner BOOLEAN NOT NULL DEFAULT true;

-- 2. queue_id nas conversations (para rastrear de qual fila veio)
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS queue_id UUID REFERENCES public.queues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_queue_id
  ON public.conversations (queue_id)
  WHERE queue_id IS NOT NULL;

-- 3. Log de distribuição (base para balanceamento justo)
CREATE TABLE IF NOT EXISTS public.queue_distribution_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  queue_id        UUID        NOT NULL REFERENCES public.queues(id)         ON DELETE CASCADE,
  assigned_to     UUID        NOT NULL,
  conversation_id UUID,
  lead_id         UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_queue_dist_log_queue
  ON public.queue_distribution_log (queue_id, created_at DESC);

-- 4. Função de distribuição uniforme
--    Escolhe o membro da fila com menos conversas ativas no momento.
--    Retorna NULL se a fila não tiver membros ativos.
CREATE OR REPLACE FUNCTION public.pick_agent_from_queue(
  p_org_id   UUID,
  p_queue_id UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id UUID;
BEGIN
  SELECT qm.user_id INTO v_agent_id
  FROM public.queue_members qm
  LEFT JOIN public.conversations c
    ON c.assigned_to = qm.user_id::text
    AND c.organization_id = p_org_id
    AND c.status NOT IN ('closed', 'resolved')
  WHERE qm.queue_id        = p_queue_id
    AND qm.organization_id = p_org_id
  GROUP BY qm.user_id, qm.created_at
  ORDER BY COUNT(c.id) ASC, qm.created_at ASC
  LIMIT 1;

  RETURN v_agent_id;
END;
$$;

COMMENT ON FUNCTION public.pick_agent_from_queue IS
  'Seleciona o membro da fila com menos conversas ativas (distribuicao uniforme). '
  'Retorna NULL se a fila nao tiver membros.';
