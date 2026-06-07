-- Migration 106: Catálogo de Produtos/Serviços + vínculo com leads
--
-- Cria:
--   org_products   — catálogo de produtos/serviços da org
--   lead_products  — relação lead ↔ produto (N:N com quantidade e desconto)
--
-- RLS: membros ativos da org podem ler e escrever.
--      Deleção restrita a admin (role check via organization_members.role).

BEGIN;

-- ---------------------------------------------------------------
-- 1. Catálogo de produtos da org
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_products (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  description     TEXT,
  price           NUMERIC(12,2) NOT NULL DEFAULT 0,
  photo_url       TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_products_org
  ON public.org_products (organization_id, is_active, name);

COMMENT ON TABLE public.org_products IS
  'Catálogo de produtos/serviços da org. Vinculados a leads via lead_products.';

-- ---------------------------------------------------------------
-- 2. Relação lead ↔ produto
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_products (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id         UUID        NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  product_id      UUID        NOT NULL REFERENCES public.org_products(id) ON DELETE CASCADE,
  quantity        NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,  -- pode diferir do preço catalog (negociação)
  discount        NUMERIC(12,2) NOT NULL DEFAULT 0,  -- desconto em R$ por unidade
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_products_lead
  ON public.lead_products (organization_id, lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_products_product
  ON public.lead_products (organization_id, product_id);

COMMENT ON TABLE public.lead_products IS
  'Produtos/serviços vinculados a um lead. Total = SUM((unit_price - discount) * quantity).';

-- ---------------------------------------------------------------
-- 3. Trigger updated_at automático em ambas as tabelas
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_products_updated_at ON public.org_products;
CREATE TRIGGER trg_org_products_updated_at
  BEFORE UPDATE ON public.org_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_lead_products_updated_at ON public.lead_products;
CREATE TRIGGER trg_lead_products_updated_at
  BEFORE UPDATE ON public.lead_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------
-- 4. RLS — org_products
-- ---------------------------------------------------------------
ALTER TABLE public.org_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_products_select" ON public.org_products;
CREATE POLICY "org_products_select" ON public.org_products
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

DROP POLICY IF EXISTS "org_products_insert" ON public.org_products;
CREATE POLICY "org_products_insert" ON public.org_products
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

DROP POLICY IF EXISTS "org_products_update" ON public.org_products;
CREATE POLICY "org_products_update" ON public.org_products
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

DROP POLICY IF EXISTS "org_products_delete" ON public.org_products;
CREATE POLICY "org_products_delete" ON public.org_products
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('admin', 'owner')
    )
  );

-- ---------------------------------------------------------------
-- 5. RLS — lead_products
-- ---------------------------------------------------------------
ALTER TABLE public.lead_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_products_select" ON public.lead_products;
CREATE POLICY "lead_products_select" ON public.lead_products
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

DROP POLICY IF EXISTS "lead_products_insert" ON public.lead_products;
CREATE POLICY "lead_products_insert" ON public.lead_products
  FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

DROP POLICY IF EXISTS "lead_products_update" ON public.lead_products;
CREATE POLICY "lead_products_update" ON public.lead_products
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

DROP POLICY IF EXISTS "lead_products_delete" ON public.lead_products;
CREATE POLICY "lead_products_delete" ON public.lead_products
  FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

COMMIT;
