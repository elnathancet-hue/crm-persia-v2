-- ============================================================
-- MIGRATION 035: Invariante "todo lead tem deal" (PR-A · LEADFIX)
-- ------------------------------------------------------------
-- Garante que TODO lead inserido em qualquer caminho (tab Leads,
-- webhook UAZAPI, /api/crm n8n, booking publico, importacao CSV,
-- AI agent, integracao futura, ate Supabase Studio direto)
-- recebe um deal automatico no funil padrao da org.
--
-- ANTES: lead criado sem deal vinculado ficava INVISIVEL no Kanban
--        (que renderiza deals, nao leads). PR-CRMOPS4 cobriu 2
--        caminhos na camada de aplicacao (createLead action +
--        webhook isNewLead). 3 caminhos restantes (n8n, booking,
--        importacao) + qualquer caminho futuro continuavam quebrados.
--
-- DEPOIS: trigger de DB AFTER INSERT em `leads` cria o deal.
--         Defense-in-depth real — independe de TypeScript.
--
-- DECISOES:
--   - SECURITY DEFINER: trigger sempre tem permissao mesmo se RLS
--     bloquear pipelines/pipeline_stages pro caller.
--   - search_path = public, pg_temp: previne SQL injection via
--     schema poisoning (boa pratica obrigatoria em DEFINER).
--   - Idempotente: se lead ja tem deal, skip silencioso.
--   - Tolerante: se org nao tem pipeline OU nao tem stage com
--     outcome='em_andamento', NAO falha o INSERT do lead. Apenas
--     skipa o auto-deal e permite a UI manual depois (degradacao
--     consciente).
--
-- BACKFILL: ao final, cria deals retroativos pra TODO lead orfao
-- existente (NOT EXISTS deals.lead_id). Resolve o bug atual em prod.
--
-- CONVENCOES:
--   - Idempotente (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS)
--   - Logging via RAISE NOTICE (sai no log do Postgres se debugar
--     precisar)
--   - Rollback no final
-- ============================================================

-- ------------------------------------------------------------
-- 1. FUNCAO: ensure_lead_has_deal()
-- ------------------------------------------------------------
-- Resolve "primeiro pipeline + primeira stage em_andamento" da org
-- e cria deal vinculado ao lead recem-inserido.
--
-- Nao usa o helper TS getDefaultPipelineStage (esse e pra UI). Aqui
-- replicamos a logica em SQL puro pra independencia da camada de
-- aplicacao.

CREATE OR REPLACE FUNCTION public.ensure_lead_has_deal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pipeline_id uuid;
  v_stage_id uuid;
  v_deal_title text;
BEGIN
  -- Idempotency check: lead ja tem deal? skip
  -- (cobre caso de re-insert via UPSERT ou cenarios estranhos)
  IF EXISTS (
    SELECT 1 FROM public.deals
    WHERE lead_id = NEW.id
      AND organization_id = NEW.organization_id
  ) THEN
    RETURN NEW;
  END IF;

  -- Resolve funil padrao (mais antigo da org) + primeira stage
  -- em_andamento. JOIN unico evita 2 round-trips.
  SELECT p.id, ps.id
  INTO v_pipeline_id, v_stage_id
  FROM public.pipelines p
  INNER JOIN public.pipeline_stages ps
    ON ps.pipeline_id = p.id
   AND ps.organization_id = p.organization_id
   AND ps.outcome = 'em_andamento'
  WHERE p.organization_id = NEW.organization_id
  ORDER BY p.created_at ASC, ps.sort_order ASC
  LIMIT 1;

  -- Org nao tem pipeline OU nao tem stage em_andamento? Skip
  -- silencioso — caller pode criar deal manual depois pela UI.
  IF v_pipeline_id IS NULL OR v_stage_id IS NULL THEN
    RAISE NOTICE 'ensure_lead_has_deal: org % sem pipeline/stage default — lead % sem auto-deal',
      NEW.organization_id, NEW.id;
    RETURN NEW;
  END IF;

  -- Titulo do deal: nome do lead -> phone -> "Novo lead". Coerce
  -- pra evitar string vazia.
  v_deal_title := COALESCE(
    NULLIF(TRIM(NEW.name), ''),
    NULLIF(TRIM(NEW.phone), ''),
    'Novo lead'
  );

  -- Cria o deal. Se falhar (constraint, RLS), o INSERT do lead NAO
  -- e revertido — apenas log e segue.
  BEGIN
    INSERT INTO public.deals (
      organization_id,
      lead_id,
      pipeline_id,
      stage_id,
      title,
      value,
      status
    ) VALUES (
      NEW.organization_id,
      NEW.id,
      v_pipeline_id,
      v_stage_id,
      v_deal_title,
      0,
      'open'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ensure_lead_has_deal: falha criando deal pro lead % (org %): %',
      NEW.id, NEW.organization_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_lead_has_deal() IS
  'PR-A LEADFIX: cria deal automatico no funil padrao quando lead e inserido. Idempotente, tolerante a falhas, multi-tenant.';

-- ------------------------------------------------------------
-- 2. TRIGGER: lead_auto_deal AFTER INSERT
-- ------------------------------------------------------------
-- AFTER INSERT (nao BEFORE) — precisa do NEW.id ja persistido pra
-- vincular o deal. FOR EACH ROW pra processar bulk inserts.

DROP TRIGGER IF EXISTS lead_auto_deal ON public.leads;

CREATE TRIGGER lead_auto_deal
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_lead_has_deal();

COMMENT ON TRIGGER lead_auto_deal ON public.leads IS
  'PR-A LEADFIX: garante invariante "todo lead tem deal". Defense-in-depth no DB independe da camada de aplicacao.';

-- ------------------------------------------------------------
-- 3. BACKFILL: leads orfaos existentes
-- ------------------------------------------------------------
-- Cria deal retroativo pra todo lead que esta no DB sem nenhum
-- deal vinculado. Resolve o bug atual em prod (leads pre-PR-CRMOPS4
-- + leads criados via caminhos service_role nao cobertos).
--
-- Algoritmo: 1 INSERT massivo com SELECT que ja resolve pipeline+
-- stage default por org. Usa LATERAL pra resolver per-org sem N+1.

INSERT INTO public.deals (
  organization_id,
  lead_id,
  pipeline_id,
  stage_id,
  title,
  value,
  status,
  created_at,
  updated_at
)
SELECT
  l.organization_id,
  l.id AS lead_id,
  defaults.pipeline_id,
  defaults.stage_id,
  COALESCE(NULLIF(TRIM(l.name), ''), NULLIF(TRIM(l.phone), ''), 'Novo lead') AS title,
  0 AS value,
  'open' AS status,
  l.created_at,  -- preserva data original do lead pra ordenar Kanban corretamente
  NOW()
FROM public.leads l
CROSS JOIN LATERAL (
  SELECT p.id AS pipeline_id, ps.id AS stage_id
  FROM public.pipelines p
  INNER JOIN public.pipeline_stages ps
    ON ps.pipeline_id = p.id
   AND ps.organization_id = p.organization_id
   AND ps.outcome = 'em_andamento'
  WHERE p.organization_id = l.organization_id
  ORDER BY p.created_at ASC, ps.sort_order ASC
  LIMIT 1
) defaults
WHERE NOT EXISTS (
  SELECT 1 FROM public.deals d
  WHERE d.lead_id = l.id
    AND d.organization_id = l.organization_id
);

-- ------------------------------------------------------------
-- 4. INDEX defensivo: query do trigger
-- ------------------------------------------------------------
-- O trigger faz EXISTS em deals.lead_id em CADA insert de lead.
-- Garante que existe index pra essa lookup (provavelmente ja existe
-- mas e idempotente).

CREATE INDEX IF NOT EXISTS idx_deals_lead_id_org
  ON public.deals (lead_id, organization_id)
  WHERE lead_id IS NOT NULL;

-- ============================================================
-- ROLLBACK MANUAL (executar se precisar reverter)
-- ============================================================
-- DROP TRIGGER IF EXISTS lead_auto_deal ON public.leads;
-- DROP FUNCTION IF EXISTS public.ensure_lead_has_deal();
-- -- (deals criados pelo backfill ficam — remover seria perda de dado)
-- ============================================================
