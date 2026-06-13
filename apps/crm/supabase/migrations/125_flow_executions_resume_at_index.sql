-- Migration 125: index parcial em flow_executions para o followup worker.
--
-- O worker em apps/crm/src/lib/flows/followup.ts filtra:
--   status = 'waiting'  AND  metadata->>'resume_at' <= now()
--
-- Sem index, cada tick faz full table scan em todas as execucoes "waiting".
-- O index parcial (WHERE status = 'waiting') cobre apenas as linhas relevantes,
-- e a expressao ::timestamptz permite comparacao <= direta sem cast em runtime.

CREATE INDEX IF NOT EXISTS idx_flow_executions_resume_at
  ON public.flow_executions (
    ((metadata->>'resume_at')::timestamptz)
  )
  WHERE status = 'waiting';
