-- Migration 031 — Produtos do org + lead_products (m2n) + lead_comments
--
-- Suporta as tabs "Produtos" e "Comentarios" do drawer "Informacoes do
-- lead" (Fase 4 da reformulacao do /crm).
--
-- Tres tabelas:
--   1. products: catalogo de produtos do org (CRUD livre)
--   2. lead_products: m2n com snapshot de unit_price (preserva
--      historico mesmo se o preco do produto mudar depois)
--   3. lead_comments: comentarios internos do time sobre o lead
--
-- RLS: padrao do projeto (get_user_org_role com agent+ pra ler/escrever,
-- admin+ pra deletar).
--
-- Idempotente: usa IF NOT EXISTS / DROP POLICY IF EXISTS pra retry.

-- ============================================================
-- 1. PRODUCTS — catalogo
-- ============================================================
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(12, 2) DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_org_active
  ON public.products (organization_id, is_active);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select" ON public.products;
CREATE POLICY "products_select" ON public.products
  FOR SELECT USING (
    public.get_user_org_role(organization_id) IN ('owner', 'admin', 'agent', 'viewer')
  );

DROP POLICY IF EXISTS "products_insert" ON public.products;
CREATE POLICY "products_insert" ON public.products
  FOR INSERT WITH CHECK (
    public.get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

DROP POLICY IF EXISTS "products_update" ON public.products;
CREATE POLICY "products_update" ON public.products
  FOR UPDATE
  USING (public.get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'))
  WITH CHECK (public.get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

DROP POLICY IF EXISTS "products_delete" ON public.products;
CREATE POLICY "products_delete" ON public.products
  FOR DELETE USING (
    public.get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 2. LEAD_PRODUCTS — produtos vinculados a um lead
-- Snapshot de unit_price: preserva o valor cobrado no momento da
-- vinculacao, independente de mudancas futuras no products.price.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lead_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_products_lead
  ON public.lead_products (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_products_org
  ON public.lead_products (organization_id);

ALTER TABLE public.lead_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_products_select" ON public.lead_products;
CREATE POLICY "lead_products_select" ON public.lead_products
  FOR SELECT USING (
    public.get_user_org_role(organization_id) IN ('owner', 'admin', 'agent', 'viewer')
  );

DROP POLICY IF EXISTS "lead_products_insert" ON public.lead_products;
CREATE POLICY "lead_products_insert" ON public.lead_products
  FOR INSERT WITH CHECK (
    public.get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

DROP POLICY IF EXISTS "lead_products_update" ON public.lead_products;
CREATE POLICY "lead_products_update" ON public.lead_products
  FOR UPDATE
  USING (public.get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'))
  WITH CHECK (public.get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

DROP POLICY IF EXISTS "lead_products_delete" ON public.lead_products;
CREATE POLICY "lead_products_delete" ON public.lead_products
  FOR DELETE USING (
    public.get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

-- ============================================================
-- 3. LEAD_COMMENTS — comentarios internos do time
-- author_id eh nullable (ON DELETE SET NULL) pra preservar o historico
-- mesmo se o usuario for removido depois.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lead_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_comments_lead
  ON public.lead_comments (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_comments_org
  ON public.lead_comments (organization_id);

ALTER TABLE public.lead_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_comments_select" ON public.lead_comments;
CREATE POLICY "lead_comments_select" ON public.lead_comments
  FOR SELECT USING (
    public.get_user_org_role(organization_id) IN ('owner', 'admin', 'agent', 'viewer')
  );

DROP POLICY IF EXISTS "lead_comments_insert" ON public.lead_comments;
CREATE POLICY "lead_comments_insert" ON public.lead_comments
  FOR INSERT WITH CHECK (
    public.get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

-- Update e Delete: so o autor (ou admin+) pode mexer.
DROP POLICY IF EXISTS "lead_comments_update" ON public.lead_comments;
CREATE POLICY "lead_comments_update" ON public.lead_comments
  FOR UPDATE
  USING (
    author_id = auth.uid()
    OR public.get_user_org_role(organization_id) IN ('owner', 'admin')
  )
  WITH CHECK (
    author_id = auth.uid()
    OR public.get_user_org_role(organization_id) IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS "lead_comments_delete" ON public.lead_comments;
CREATE POLICY "lead_comments_delete" ON public.lead_comments
  FOR DELETE USING (
    author_id = auth.uid()
    OR public.get_user_org_role(organization_id) IN ('owner', 'admin')
  );
