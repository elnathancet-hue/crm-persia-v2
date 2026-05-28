-- PR 5 prep do plano docs/ai-agent/11-openai-responses-migration.md
-- (mai/2026).
--
-- Persiste qual API OpenAI foi usada em cada run (Chat Completions ou
-- Responses API). Sem isso, comparar custo/latencia/qualidade entre
-- modos exigia grep nos logs do EasyPanel — agora SQL direto.
--
-- Coluna NULLABLE: runs anteriores a essa migration ficam com NULL =
-- "desconhecido" (provavel "chat", default historico). Backfill nao
-- necessario — analytics agrupa "chat" + NULL juntos quando precisa.
--
-- CHECK constraint: aceita "chat" | "responses". Aplica os mesmos
-- valores que `OpenAiApiMode` em
-- apps/crm/src/lib/ai-agent/flow/openai-api-mode.ts. Migrations futuras
-- estendem se novos modos surgirem.

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS provider_mode TEXT NULL;

ALTER TABLE public.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_provider_mode_check;

ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_provider_mode_check
  CHECK (provider_mode IS NULL OR provider_mode IN ('chat', 'responses'));

-- Index parcial pra dashboards de observabilidade (filtra so runs com
-- mode setado). Em escala alta, agrupar por mode + dia fica O(log n).
-- Nota: agent_runs usa `created_at` (migration 017), nao `started_at`.
CREATE INDEX IF NOT EXISTS idx_agent_runs_provider_mode_created
  ON public.agent_runs (provider_mode, created_at DESC)
  WHERE provider_mode IS NOT NULL;

COMMENT ON COLUMN public.agent_runs.provider_mode IS
  'OpenAI API usada nesse run (chat | responses). NULL = legacy/desconhecido. Setado em runtime apos cada turno via flow runner.';
