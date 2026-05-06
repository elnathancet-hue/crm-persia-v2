-- ============================================================
-- MAINTENANCE: Cleanup de deals duplicados
-- ------------------------------------------------------------
-- Detecta leads com mais de um deal aberto (status='open') no
-- mesmo pipeline, e arquiva os duplicados (mantem o mais antigo).
--
-- CONTEXTO: PR-CRMOPS4 + criacao manual sobreposta criaram alguns
-- deals duplicados antes do PR-A LEADFIX consolidar tudo via
-- trigger. Esse SQL e one-shot — roda manualmente, reviewa o que
-- vai mudar, depois confirma.
--
-- USO: rodar PASSO 1 primeiro (apenas SELECT — nao altera nada).
--      Se o resultado fizer sentido, rodar PASSO 2 (UPDATE).
-- ============================================================

-- ------------------------------------------------------------
-- PASSO 1: DIAGNOSTICO (read-only)
-- ------------------------------------------------------------
-- Lista todos os leads com >1 deal aberto, mostrando qual e o
-- mais antigo (sera mantido) e qual sera arquivado.

WITH duplicates AS (
  SELECT
    d.lead_id,
    d.organization_id,
    d.pipeline_id,
    COUNT(*) AS deal_count,
    MIN(d.created_at) AS first_deal_at,
    MAX(d.created_at) AS last_deal_at
  FROM public.deals d
  WHERE d.status = 'open'
    AND d.lead_id IS NOT NULL
  GROUP BY d.lead_id, d.organization_id, d.pipeline_id
  HAVING COUNT(*) > 1
)
SELECT
  l.name AS lead_name,
  l.phone AS lead_phone,
  dup.deal_count,
  dup.first_deal_at AS deal_a_manter,
  dup.last_deal_at AS deal_mais_recente,
  dup.organization_id,
  dup.pipeline_id
FROM duplicates dup
LEFT JOIN public.leads l ON l.id = dup.lead_id
ORDER BY dup.deal_count DESC, dup.first_deal_at;

-- ------------------------------------------------------------
-- PASSO 2: ARQUIVAR DUPLICADOS (use apenas apos revisar PASSO 1)
-- ------------------------------------------------------------
-- Marca os deals duplicados (todos exceto o mais antigo de cada
-- lead+pipeline) como status='archived'. Preserva activity log,
-- messages e historico vinculado — apenas tira do Kanban ativo.
--
-- DESCOMENTE AS LINHAS ABAIXO PARA EXECUTAR:

/*
WITH ranked_deals AS (
  SELECT
    d.id,
    d.lead_id,
    d.pipeline_id,
    d.organization_id,
    ROW_NUMBER() OVER (
      PARTITION BY d.lead_id, d.organization_id, d.pipeline_id
      ORDER BY d.created_at ASC
    ) AS rn
  FROM public.deals d
  WHERE d.status = 'open'
    AND d.lead_id IS NOT NULL
)
UPDATE public.deals
SET
  status = 'archived',
  updated_at = NOW()
WHERE id IN (
  SELECT id FROM ranked_deals WHERE rn > 1
)
RETURNING id, lead_id, pipeline_id, status;
*/

-- ------------------------------------------------------------
-- PASSO 3: VERIFICACAO POS-CLEANUP
-- ------------------------------------------------------------
-- Confirma que nao restou nenhum lead com >1 deal aberto.

/*
SELECT
  d.lead_id,
  COUNT(*) AS deal_count
FROM public.deals d
WHERE d.status = 'open'
  AND d.lead_id IS NOT NULL
GROUP BY d.lead_id
HAVING COUNT(*) > 1;
-- Resultado esperado: 0 linhas
*/

-- ============================================================
-- PREVENCAO FUTURA
-- ============================================================
-- O trigger `lead_auto_deal` (migration 035) ja previne duplicatas
-- via IF EXISTS check antes de criar deal.
--
-- Risco residual: se o usuario criar deal MANUAL via UI no mesmo
-- pipeline onde o lead ja tem deal aberto, vai criar duplicata
-- intencionalmente. Caso de uso valido em alguns negocios (ex:
-- lead com 2 oportunidades distintas: site + ecommerce). Por isso
-- nao colocamos UNIQUE constraint no DB.
-- ============================================================
