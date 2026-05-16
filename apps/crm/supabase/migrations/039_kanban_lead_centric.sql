-- ============================================================
-- MIGRATION 039: Kanban lead-centric (FASE 0)
-- ------------------------------------------------------------
-- Refactor estrutural: Kanban deixa de renderizar `deals` e passa
-- a renderizar `leads`. Cada lead aparece exatamente 1x no Kanban.
-- Deals continuam existindo como subentidade do lead (oportunidades
-- comerciais listadas no drawer do lead).
--
-- ANTES: deal.stage_id + deal.pipeline_id controlam coluna do Kanban.
--        Lead com N deals abertos = N cards no Kanban (confuso).
--
-- DEPOIS: lead.stage_id + lead.pipeline_id + lead.sort_order +
--         lead.expected_value controlam coluna. Deals viram histórico
--         de oportunidades comerciais do lead.
--
-- DECISOES:
--   - lead.pipeline_id NULLABLE (com ON DELETE SET NULL):
--     lead pode existir fora de funil (ex.: chegou via webhook,
--     ainda nao foi triado). UI vai mostrar coluna "Sem funil"
--     ou esconder ate ser atribuido.
--   - Trigger BEFORE UPDATE stage_id sincroniza lead.status com
--     outcome do stage (falha → lost, bem_sucedido → customer).
--   - Drop trigger lead_auto_deal: deal nao e mais criado
--     automaticamente. User cria deal manualmente quando ha
--     oportunidade real (opt-in).
--   - deals.lead_id agora NOT NULL + ON DELETE CASCADE:
--     deal sem lead nao faz sentido (era SET NULL pra permitir
--     "deal orfao" — caso de uso eliminado).
--   - Backfill: pra cada lead com deals, copia pipeline/stage do
--     deal mais recente (criado_at DESC). Lead sem deal vai pro
--     primeiro stage do pipeline default da org.
--
-- ROLLBACK manual (se precisar): script abaixo no rollback section.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Adicionar colunas em leads
-- ------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES public.pipelines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_value DECIMAL(12,2);

COMMENT ON COLUMN public.leads.pipeline_id IS 'Funil em que o lead esta. NULL = lead sem funil (ex.: pendente de triagem).';
COMMENT ON COLUMN public.leads.stage_id IS 'Etapa do funil em que o lead esta. Controla coluna do Kanban.';
COMMENT ON COLUMN public.leads.sort_order IS 'Posicao do lead dentro da coluna do Kanban (drag-drop).';
COMMENT ON COLUMN public.leads.expected_value IS 'Valor esperado de venda em R$. Mostrado no card do Kanban e agregado por coluna.';

-- ------------------------------------------------------------
-- 2. Backfill: lead herda pipeline/stage do deal mais recente
-- ------------------------------------------------------------
WITH latest_deal_per_lead AS (
  SELECT DISTINCT ON (lead_id)
    lead_id,
    pipeline_id,
    stage_id,
    value
  FROM public.deals
  WHERE lead_id IS NOT NULL
  ORDER BY lead_id, created_at DESC
)
UPDATE public.leads l
SET
  pipeline_id = ld.pipeline_id,
  stage_id = ld.stage_id,
  expected_value = ld.value
FROM latest_deal_per_lead ld
WHERE l.id = ld.lead_id;

-- ------------------------------------------------------------
-- 3. Lead sem deal → primeiro stage do pipeline default da org
-- ------------------------------------------------------------
WITH first_stage_per_org AS (
  SELECT DISTINCT ON (p.organization_id)
    p.organization_id,
    p.id AS pipeline_id,
    ps.id AS stage_id
  FROM public.pipelines p
  JOIN public.pipeline_stages ps ON ps.pipeline_id = p.id
  WHERE p.is_default = true
  ORDER BY p.organization_id, ps.sort_order ASC, ps.created_at ASC
)
UPDATE public.leads l
SET
  pipeline_id = fs.pipeline_id,
  stage_id = fs.stage_id
FROM first_stage_per_org fs
WHERE l.organization_id = fs.organization_id
  AND l.pipeline_id IS NULL;

-- ------------------------------------------------------------
-- 4. Index pra query principal do Kanban
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_kanban
  ON public.leads (organization_id, pipeline_id, stage_id, sort_order);

-- ------------------------------------------------------------
-- 5. Trigger: sincroniza lead.status com outcome do stage destino
-- ------------------------------------------------------------
-- Quando lead vai pra stage com outcome='falha' → lead.status='lost'
-- Quando lead vai pra stage com outcome='bem_sucedido' → lead.status='customer'
-- Em 'em_andamento' ou NULL, mantem status atual.

CREATE OR REPLACE FUNCTION public.sync_lead_status_from_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_outcome TEXT;
BEGIN
  IF NEW.stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Skip se nao houve mudanca real de stage
  IF TG_OP = 'UPDATE' AND OLD.stage_id IS NOT DISTINCT FROM NEW.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT outcome INTO v_outcome
  FROM public.pipeline_stages
  WHERE id = NEW.stage_id;

  IF v_outcome = 'falha' THEN
    NEW.status := 'lost';
  ELSIF v_outcome = 'bem_sucedido' THEN
    NEW.status := 'customer';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_stage_status_sync ON public.leads;
CREATE TRIGGER trg_lead_stage_status_sync
  BEFORE INSERT OR UPDATE OF stage_id ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_lead_status_from_stage();

-- ------------------------------------------------------------
-- 6. Drop trigger antigo lead_auto_deal
-- ------------------------------------------------------------
-- Lead nao cria mais deal automaticamente. User cria deal manualmente
-- quando ha oportunidade comercial (opt-in via drawer do lead).

DROP TRIGGER IF EXISTS lead_auto_deal ON public.leads;
DROP FUNCTION IF EXISTS public.ensure_lead_has_deal();

-- ------------------------------------------------------------
-- 7. deals.lead_id NOT NULL + ON DELETE CASCADE
-- ------------------------------------------------------------
-- Deal sem lead nao tem sentido pos-refactor. Limpar orfaos primeiro
-- (se houver) e depois ajustar constraint.

DELETE FROM public.deals WHERE lead_id IS NULL;

ALTER TABLE public.deals
  ALTER COLUMN lead_id SET NOT NULL;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_lead_id_fkey;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

COMMIT;

-- ============================================================
-- ROLLBACK MANUAL (se necessario apos commit):
-- ------------------------------------------------------------
-- BEGIN;
--   -- 1. Reverter constraint de deals.lead_id
--   ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_lead_id_fkey;
--   ALTER TABLE public.deals ALTER COLUMN lead_id DROP NOT NULL;
--   ALTER TABLE public.deals ADD CONSTRAINT deals_lead_id_fkey
--     FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
--
--   -- 2. Recriar trigger lead_auto_deal (via re-run da migration 035)
--
--   -- 3. Drop trigger novo + funcao
--   DROP TRIGGER IF EXISTS trg_lead_stage_status_sync ON public.leads;
--   DROP FUNCTION IF EXISTS public.sync_lead_status_from_stage();
--
--   -- 4. Drop colunas adicionadas
--   ALTER TABLE public.leads
--     DROP COLUMN IF EXISTS pipeline_id,
--     DROP COLUMN IF EXISTS stage_id,
--     DROP COLUMN IF EXISTS sort_order,
--     DROP COLUMN IF EXISTS expected_value;
--
--   DROP INDEX IF EXISTS public.idx_leads_kanban;
-- COMMIT;
-- ============================================================
