-- 094: claim atomico de jobs de follow-up
-- Evita que dois workers processem o mesmo job simultaneamente.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_agent_followup_job(
  p_job_id UUID,
  p_worker_id TEXT DEFAULT 'followups-tick'
)
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  config_id UUID,
  agent_conversation_id UUID,
  crm_conversation_id UUID,
  lead_id UUID,
  followup_id UUID,
  sequence_key TEXT,
  order_index INTEGER,
  send_at TIMESTAMPTZ,
  status TEXT,
  attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.agent_followup_jobs j
  SET
    status = 'sending',
    attempts = j.attempts + 1,
    locked_at = now(),
    locked_by = COALESCE(NULLIF(p_worker_id, ''), 'followups-tick'),
    updated_at = now()
  WHERE j.id = p_job_id
    AND j.status = 'queued'
    AND j.send_at <= now()
  RETURNING
    j.id,
    j.organization_id,
    j.config_id,
    j.agent_conversation_id,
    j.crm_conversation_id,
    j.lead_id,
    j.followup_id,
    j.sequence_key,
    j.order_index,
    j.send_at,
    j.status,
    j.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_followup_job(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_agent_followup_job(UUID, TEXT) TO service_role;

COMMIT;
