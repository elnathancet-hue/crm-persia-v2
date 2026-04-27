-- Migration 029 — pipeline_stages.outcome
--
-- Adiciona campo `outcome` que agrupa as etapas em 3 categorias terminais
-- (em_andamento, falha, bem_sucedido). UI do Kanban usa pra filtrar por
-- bucket e o drawer de configuracao mostra 3 colunas.
--
-- Backfill: pattern matching no nome da etapa pra inferir o outcome
-- inicial. Usuario pode reclassificar via UI depois.
--
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS pra retry.

-- 1. Adiciona coluna nullable
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS outcome TEXT;

-- 2. Backfill por pattern matching no nome (case-insensitive). Stages
--    com nomes claramente terminais positivos viram 'bem_sucedido',
--    terminais negativos viram 'falha', resto fica 'em_andamento'.
--    NAO usa unaccent (evita dependencia de extension) — patterns sao
--    todos sem acento e funcionam mesmo se o nome tem acento, porque
--    `lower("Negócio fechado") ILIKE '%fechad%'` casa.
UPDATE public.pipeline_stages
SET outcome = CASE
  WHEN lower(name) ~ '(fechad|ganho|convertid|sucesso|won)' THEN 'bem_sucedido'
  WHEN lower(name) ~ '(perdid|descartad|cancelad|falha|lost|abandonad)' THEN 'falha'
  ELSE 'em_andamento'
END
WHERE outcome IS NULL;

-- 3. Trava em NOT NULL com default
ALTER TABLE public.pipeline_stages
  ALTER COLUMN outcome SET NOT NULL,
  ALTER COLUMN outcome SET DEFAULT 'em_andamento';

-- 4. CHECK constraint pros 3 valores aceitos
ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_outcome_check;
ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_outcome_check
  CHECK (outcome IN ('em_andamento', 'falha', 'bem_sucedido'));

-- 5. Index pra queries que filtram por outcome (kanban view)
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline_outcome
  ON public.pipeline_stages (pipeline_id, outcome, sort_order);
