-- Migration 125: index parcial em flow_executions para o followup worker.
--
-- O worker em apps/crm/src/lib/flows/followup.ts filtra:
--   status = 'waiting'  AND  metadata->>'resume_at' <= now()
--
-- Sem index, cada tick faz full table scan em todas as execucoes "waiting".
-- O index parcial (WHERE status = 'waiting') cobre apenas as linhas relevantes.
--
-- Nota: expressao de texto puro — cast ::timestamptz nao e IMMUTABLE (depende
-- do timezone da sessao, proibido em indexes). ISO 8601 ordena corretamente
-- como texto, entao a comparacao <= funciona sem cast.

CREATE INDEX IF NOT EXISTS idx_flow_executions_resume_at
  ON public.flow_executions (
    (metadata->>'resume_at')
  )
  WHERE status = 'waiting';
