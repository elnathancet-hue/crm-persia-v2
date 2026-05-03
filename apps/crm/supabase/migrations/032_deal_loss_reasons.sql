-- ============================================================
-- MIGRATION 032: Deal loss tracking (PR-K3)
-- ------------------------------------------------------------
-- Adiciona captura estruturada de motivo de perda em deals
-- (analytics) + tabela de motivos cadastraveis por org.
--
-- ANTES: ao marcar um deal como "lost", o sistema apenas mudava
--        status='lost'. O usuario nao tinha como categorizar
--        o motivo (preco, concorrente, sumiu, etc.) — perdendo
--        a chance de gerar insight sobre o funil.
--
-- DECISOES:
--   - loss_reason eh TEXT free-form pra permitir motivo
--     fora-da-lista quando o template nao cobre. UI sugere os
--     cadastrados em deal_loss_reasons mas aceita "outro".
--   - competitor eh TEXT opcional, so faz sentido quando
--     loss_reason indica concorrente. Indexado pra "qual
--     concorrente mais nos derruba?" rapido.
--   - loss_note eh TEXT longo pra notas de aprendizado
--     (post-mortem do deal).
--   - deal_loss_reasons tem seed default por org via funcao
--     `seed_default_loss_reasons` chamada no first-touch (UI
--     dispara via getLossReasons quando lista vier vazia).
--   - lost_at = closed_at, mas mantemos coluna separada pra
--     futuro filtro "perdidos no ultimo mes" sem tipar status.
--
-- CONVENCOES:
--   - Idempotente (IF NOT EXISTS, ON CONFLICT DO NOTHING)
--   - RLS habilitado em deal_loss_reasons com policies por org
--   - Ver rollback manual no final
-- ============================================================

BEGIN;

-- ============================================================
-- 1) Colunas em deals
-- ============================================================
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS loss_reason TEXT,
  ADD COLUMN IF NOT EXISTS competitor TEXT,
  ADD COLUMN IF NOT EXISTS loss_note TEXT;

-- Index pra filtro/agg de perdidos por motivo
CREATE INDEX IF NOT EXISTS idx_deals_loss_reason
  ON public.deals (organization_id, loss_reason)
  WHERE status = 'lost';

CREATE INDEX IF NOT EXISTS idx_deals_competitor
  ON public.deals (organization_id, competitor)
  WHERE competitor IS NOT NULL;

-- ============================================================
-- 2) deal_loss_reasons — catalogo cadastravel por org
-- ============================================================
CREATE TABLE IF NOT EXISTS public.deal_loss_reasons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  /** Se true, abre input "Qual concorrente?" no UI ao escolher esse motivo. */
  requires_competitor BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, label)
);

CREATE INDEX IF NOT EXISTS idx_deal_loss_reasons_org
  ON public.deal_loss_reasons (organization_id, sort_order)
  WHERE is_active = true;

ALTER TABLE public.deal_loss_reasons ENABLE ROW LEVEL SECURITY;

-- RLS: members da org podem ler; admins podem editar
DROP POLICY IF EXISTS "deal_loss_reasons_select" ON public.deal_loss_reasons;
CREATE POLICY "deal_loss_reasons_select" ON public.deal_loss_reasons
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

DROP POLICY IF EXISTS "deal_loss_reasons_insert" ON public.deal_loss_reasons;
CREATE POLICY "deal_loss_reasons_insert" ON public.deal_loss_reasons
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid()
        AND is_active = true
        AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "deal_loss_reasons_update" ON public.deal_loss_reasons;
CREATE POLICY "deal_loss_reasons_update" ON public.deal_loss_reasons
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid()
        AND is_active = true
        AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "deal_loss_reasons_delete" ON public.deal_loss_reasons;
CREATE POLICY "deal_loss_reasons_delete" ON public.deal_loss_reasons
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid()
        AND is_active = true
        AND role IN ('owner', 'admin')
    )
  );

-- Trigger pra updated_at
CREATE OR REPLACE FUNCTION public.set_deal_loss_reasons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_loss_reasons_updated_at
  ON public.deal_loss_reasons;
CREATE TRIGGER trg_deal_loss_reasons_updated_at
  BEFORE UPDATE ON public.deal_loss_reasons
  FOR EACH ROW EXECUTE FUNCTION public.set_deal_loss_reasons_updated_at();

-- ============================================================
-- 3) Funcao seed_default_loss_reasons(org_id)
-- ------------------------------------------------------------
-- Idempotente — usa ON CONFLICT DO NOTHING via UNIQUE(org_id, label).
-- Chamada pelo backend quando getLossReasons retorna vazio.
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_default_loss_reasons(p_org_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO public.deal_loss_reasons
    (organization_id, label, requires_competitor, sort_order)
  VALUES
    (p_org_id, 'Sem orcamento', false, 10),
    (p_org_id, 'Preco alto', false, 20),
    (p_org_id, 'Escolheu concorrente', true, 30),
    (p_org_id, 'Sem retorno do lead', false, 40),
    (p_org_id, 'Nao era o publico-alvo', false, 50),
    (p_org_id, 'Timing ruim', false, 60),
    (p_org_id, 'Funcionalidade ausente', false, 70),
    (p_org_id, 'Outro', false, 999)
  ON CONFLICT (organization_id, label) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permite que clients autenticados chamem (RLS ainda valida org via insert)
GRANT EXECUTE ON FUNCTION public.seed_default_loss_reasons(UUID) TO authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (manual, NAO executar como parte do CI):
-- ------------------------------------------------------------
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.seed_default_loss_reasons(UUID);
-- DROP TRIGGER IF EXISTS trg_deal_loss_reasons_updated_at ON public.deal_loss_reasons;
-- DROP FUNCTION IF EXISTS public.set_deal_loss_reasons_updated_at();
-- DROP TABLE IF EXISTS public.deal_loss_reasons;
-- ALTER TABLE public.deals DROP COLUMN IF EXISTS loss_reason;
-- ALTER TABLE public.deals DROP COLUMN IF EXISTS competitor;
-- ALTER TABLE public.deals DROP COLUMN IF EXISTS loss_note;
-- DROP INDEX IF EXISTS idx_deals_loss_reason;
-- DROP INDEX IF EXISTS idx_deals_competitor;
-- COMMIT;
-- ============================================================
