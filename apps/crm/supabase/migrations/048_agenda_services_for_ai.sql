-- ============================================================
-- MIGRATION 048: estende agenda_services para uso pelo AI Agent
-- ------------------------------------------------------------
-- Hoje `agenda_services` (031) tem name/description/duration_minutes/
-- price_cents/is_active. AI Agent precisa de mais alguns campos pra
-- agendar conversacionalmente sem inventar:
--
--   - slug                : identificador human-readable que o LLM usa
--                           (mesmo padrao de `automation_tools.slug`)
--   - default_channel     : whatsapp/phone/online/in_person — IA herda
--                           pro appointment criado
--   - default_location    : endereco fisico (se in_person)
--   - default_meeting_url : URL de reuniao online (se online)
--
-- Backfill do slug pra rows existentes: gera a partir do name
-- (lowercase + hyphens). Update em uma passada via expressao SQL.
--
-- Todos os campos sao additive — comportamento existente preservado.
-- Index no slug pra lookup rapido durante create_appointment handler.
-- ============================================================

BEGIN;

ALTER TABLE public.agenda_services
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS default_channel TEXT
    CHECK (default_channel IS NULL OR default_channel IN ('whatsapp','phone','online','in_person')),
  ADD COLUMN IF NOT EXISTS default_location TEXT,
  ADD COLUMN IF NOT EXISTS default_meeting_url TEXT;

-- Backfill: gera slug a partir do name pra rows existentes onde slug
-- ainda esta NULL. Lowercase + substitui nao-alfanumericos por hifen
-- + remove hifen do inicio/fim. Determinístico.
--
-- Nao usa unaccent() (depende de extensao opcional) — em vez disso o
-- regex `[^a-z0-9]+` simplesmente trata acentos como separadores. Ex:
-- "Consulta inicial" -> "consulta-inicial"; "Avaliação 3D" -> "avalia-o-3d".
-- Acima nao e ideal mas funciona — cliente pode editar slug depois via UI.
UPDATE public.agenda_services
SET slug = regexp_replace(
  regexp_replace(
    lower(name),
    '[^a-z0-9]+', '-', 'g'
  ),
  '^-+|-+$', '', 'g'
)
WHERE slug IS NULL;

-- Constraint de formato + unique por org. Aplicada DEPOIS do backfill
-- pra nao quebrar com rows existentes.
ALTER TABLE public.agenda_services
  ADD CONSTRAINT agenda_services_slug_format
    CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{0,79}$');

CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_services_org_slug
  ON public.agenda_services (organization_id, slug)
  WHERE slug IS NOT NULL;

COMMIT;
