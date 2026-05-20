-- ============================================================
-- MIGRATION 058: segment_memberships — tracking persistente de
-- entradas em segmentação pra disparar agent_flows runtime.
-- ------------------------------------------------------------
-- PR-FLOW-PIVOT PR 12 (mai/2026): segments hoje são rule-based,
-- avaliadas em runtime via findMatchingLeadIds. Pra detectar
-- ENTRADA (lead começou a casar com as rules), precisamos de
-- estado persistente comparável.
--
-- Strategy V1:
--   1. Tabela armazena (segment_id, lead_id, joined_at)
--   2. Helper `evaluateLeadSegmentMembership` rodado após mutação
--      de lead avalia TODOS os segments da org, faz upsert do que
--      casa, retorna IDs dos segments recém-adicionados
--   3. Callers disparam triggerAgentFlowsForSegmentEntry pra cada
--      ID novo
--
-- V1 NÃO faz:
--   - Track de "saída" (lead que parou de casar). Quando voltar a
--     casar, dispara de novo (idempotência fica no flow). Adicionar
--     `left_at` em V2 quando tivermos caso de uso.
--   - Cleanup automático. Lead deletado → CASCADE remove memberships.
--     Segment deletado → CASCADE também.
--
-- IDEMPOTÊNCIA: PRIMARY KEY (segment_id, lead_id) garante upsert
-- safe (ON CONFLICT DO NOTHING no insert).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.segment_memberships (
  segment_id UUID NOT NULL REFERENCES public.segments(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (segment_id, lead_id)
);

-- Index pra lookup reverso (todos os segments de um lead) — usado
-- pelo evaluator pra computar diff.
CREATE INDEX IF NOT EXISTS idx_segment_memberships_lead
  ON public.segment_memberships(organization_id, lead_id);

-- Index pra lookup forward (todos os leads de um segment) — usado
-- por relatórios futuros + UI.
CREATE INDEX IF NOT EXISTS idx_segment_memberships_segment
  ON public.segment_memberships(organization_id, segment_id);

-- RLS: org-scoped. Aplicação CRM (anon + user) só vê memberships
-- da própria org. Admin (service_role) bypass automático.
ALTER TABLE public.segment_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS segment_memberships_select_own_org
  ON public.segment_memberships;
CREATE POLICY segment_memberships_select_own_org
  ON public.segment_memberships
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS segment_memberships_insert_own_org
  ON public.segment_memberships;
CREATE POLICY segment_memberships_insert_own_org
  ON public.segment_memberships
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS segment_memberships_delete_own_org
  ON public.segment_memberships;
CREATE POLICY segment_memberships_delete_own_org
  ON public.segment_memberships
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.segment_memberships IS
  'PR-FLOW-PIVOT PR 12 (mai/2026): tracking persistente de leads em segmentações pra detectar entrada (joined_at) e disparar flows com entry trigger segment_entered.';

COMMIT;
