-- 081: group_memberships — rastrear saída de grupo (left_at)
--
-- Auditoria grupos+leads P3 (mai/2026):
-- Tab "Grupos" no LeadInfoDrawer mostrava memberships históricas como ativas.
-- Sem `left_at`, não havia como distinguir quem ainda está no grupo de quem saiu.
--
-- Solução: coluna `left_at TIMESTAMPTZ` nullable.
--   NULL  = ainda membro (ou status desconhecido para entradas pré-migration)
--   NOT NULL = saiu em `left_at`
--
-- O webhook UAZAPI `EventType: "groups"` com `action: "remove"` agora popula
-- `left_at` em vez de ser ignorado. O `participant_count` é decrementado via
-- RPC `decrement_group_participant_count` (criado na migration 080).

ALTER TABLE public.group_memberships
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

-- Índice para filtrar membros ativos eficientemente
CREATE INDEX IF NOT EXISTS idx_group_memberships_active
  ON public.group_memberships(organization_id, group_id)
  WHERE left_at IS NULL;
