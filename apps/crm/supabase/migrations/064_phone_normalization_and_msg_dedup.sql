-- Bug H fix (mai/2026): phone normalization + messages dedup
--
-- Sintomas em prod (continuação do Bug C):
--   1. "Elnathan NICOLAS" voltou a aparecer DUPLICADO mesmo após Bug C
--      porque UNIQUE(org, phone) só compara strings — "558699421406" e
--      "+558699421406" são considerados diferentes.
--   2. Mensagens duplicadas em `messages` com mesmo whatsapp_msg_id por
--      causa de webhook retry/replay + SELECT-then-INSERT dedup race.
--
-- Esta migration faz 4 coisas:
--   1. Cleanup: deleta mensagens duplicadas em (org, whatsapp_msg_id)
--   2. UNIQUE em messages(org, whatsapp_msg_id) — impede dedup race
--   3. Normaliza leads.phone existentes pra E.164 com '+'
--   4. Merge de leads que ficaram duplicados depois da normalização
--      (ex: já existia "558..." e "+558..." pro mesmo contato)
--
-- ORDEM CRÍTICA: cleanup ANTES dos índices/constraints, senão eles
-- falham por já ter duplicatas.
--
-- Idempotente: pode rodar 2x sem efeito colateral.

-- ============================================================================
-- Step 1: Cleanup messages duplicadas em (org, whatsapp_msg_id)
-- Mantém a mais antiga de cada grupo.
-- ============================================================================

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) - COUNT(DISTINCT (organization_id, whatsapp_msg_id))
  INTO dup_count
  FROM public.messages
  WHERE whatsapp_msg_id IS NOT NULL;

  IF dup_count > 0 THEN
    RAISE NOTICE 'Found % duplicate messages by (org, whatsapp_msg_id). Cleaning up...', dup_count;
  ELSE
    RAISE NOTICE 'No duplicate messages found by (org, whatsapp_msg_id).';
  END IF;
END $$;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, whatsapp_msg_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.messages
  WHERE whatsapp_msg_id IS NOT NULL
)
DELETE FROM public.messages
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ============================================================================
-- Step 2: UNIQUE em messages(org, whatsapp_msg_id) — impede dedup race
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS messages_org_whatsapp_msg_id_unique
  ON public.messages (organization_id, whatsapp_msg_id)
  WHERE whatsapp_msg_id IS NOT NULL;

COMMENT ON INDEX public.messages_org_whatsapp_msg_id_unique IS
  'Bug H fix (mai/2026): impede dois INSERTs com mesmo whatsapp_msg_id. '
  'Webhook UAZAPI faz retry/replay — sem este índice, dedup SELECT-then-INSERT '
  'tinha race window.';

-- ============================================================================
-- Step 3: Normaliza leads.phone existentes pra E.164 com '+'
--
-- Regra:
--   - Se phone já começa com '+', mantém como está
--   - Se phone é só dígitos, prepende '+' (assumindo já tem código país)
--   - Se phone tem formatos antigos (parênteses, espaços), normaliza
-- ============================================================================

DO $$
DECLARE
  updated_count integer;
BEGIN
  -- Conta quantos vão mudar
  SELECT COUNT(*) INTO updated_count
  FROM public.leads
  WHERE phone IS NOT NULL
    AND phone != ''
    AND phone NOT LIKE '+%';

  IF updated_count > 0 THEN
    RAISE NOTICE 'Normalizing % leads.phone to E.164 format...', updated_count;
  ELSE
    RAISE NOTICE 'No leads.phone need normalization.';
  END IF;
END $$;

-- Caso 1: phone é só dígitos puros → prepende '+'
UPDATE public.leads
SET phone = '+' || phone
WHERE phone IS NOT NULL
  AND phone ~ '^[0-9]+$'
  AND phone NOT LIKE '+%';

-- Caso 2: phone tem formatos como "(11) 98765-4321" → extrai dígitos + '+'
UPDATE public.leads
SET phone = '+' || regexp_replace(phone, '[^0-9]', '', 'g')
WHERE phone IS NOT NULL
  AND phone != ''
  AND phone NOT LIKE '+%'
  AND phone !~ '^[0-9]+$'
  AND regexp_replace(phone, '[^0-9]', '', 'g') != '';

-- Caso 3: phone vazio ou só caracteres não-numéricos → NULL (lixo)
UPDATE public.leads
SET phone = NULL
WHERE phone IS NOT NULL
  AND phone != ''
  AND regexp_replace(phone, '[^0-9+]', '', 'g') NOT LIKE '+%'
  AND regexp_replace(phone, '[^0-9]', '', 'g') = '';

-- ============================================================================
-- Step 4: Merge de leads que ficaram duplicados DEPOIS da normalização
--
-- Ex: existia lead A com phone="558699421406" e lead B com phone="+558699421406"
-- Após step 3, ambos viram "+558699421406" e violam UNIQUE(org, phone).
-- Antes que viole, mesclamos: mantém o mais antigo (created_at ASC) e
-- re-aponta tudo do dropado pro keep.
-- ============================================================================

DO $$
DECLARE
  dup_groups integer;
BEGIN
  SELECT COUNT(*) INTO dup_groups
  FROM (
    SELECT organization_id, phone, COUNT(*) AS cnt
    FROM public.leads
    WHERE phone IS NOT NULL
    GROUP BY organization_id, phone
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_groups > 0 THEN
    RAISE NOTICE 'Found % duplicate (org, phone) lead groups after normalization. Merging...', dup_groups;
  ELSE
    RAISE NOTICE 'No duplicate leads after normalization.';
  END IF;
END $$;

-- Build merge plan: 1 row per drop_lead
CREATE TEMP TABLE IF NOT EXISTS _lead_h_merge_plan ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    organization_id,
    phone,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, phone
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY organization_id, phone
      ORDER BY created_at ASC, id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS keep_id
  FROM public.leads
  WHERE phone IS NOT NULL
)
SELECT id AS drop_id, keep_id
FROM ranked
WHERE rn > 1;

-- Re-aponta FKs antes de deletar
UPDATE public.messages m
SET lead_id = cmp.keep_id
FROM _lead_h_merge_plan cmp
WHERE m.lead_id = cmp.drop_id;

UPDATE public.conversations c
SET lead_id = cmp.keep_id
FROM _lead_h_merge_plan cmp
WHERE c.lead_id = cmp.drop_id;

UPDATE public.lead_activities la
SET lead_id = cmp.keep_id
FROM _lead_h_merge_plan cmp
WHERE la.lead_id = cmp.drop_id;

UPDATE public.deals d
SET lead_id = cmp.keep_id
FROM _lead_h_merge_plan cmp
WHERE d.lead_id = cmp.drop_id;

UPDATE public.lead_tags lt
SET lead_id = cmp.keep_id
FROM _lead_h_merge_plan cmp
WHERE lt.lead_id = cmp.drop_id;

UPDATE public.agent_conversations ac
SET lead_id = cmp.keep_id
FROM _lead_h_merge_plan cmp
WHERE ac.lead_id = cmp.drop_id;

-- Deleta os leads duplicados
DELETE FROM public.leads l
USING _lead_h_merge_plan cmp
WHERE l.id = cmp.drop_id;

-- Conversations agora podem violar UNIQUE(org, lead) se o merge criou
-- 2+ active no mesmo lead. Re-roda o merge de conversations da migration 063.
-- (Reutilizamos o mesmo padrão.)
DO $$
DECLARE
  conv_dup_groups integer;
BEGIN
  SELECT COUNT(*) INTO conv_dup_groups
  FROM (
    SELECT organization_id, lead_id, COUNT(*) AS cnt
    FROM public.conversations
    WHERE status IN ('active', 'waiting_human')
    GROUP BY organization_id, lead_id
    HAVING COUNT(*) > 1
  ) dups;

  IF conv_dup_groups > 0 THEN
    RAISE NOTICE 'Found % duplicate (org, lead) conversations after lead merge. Merging conv...', conv_dup_groups;
  END IF;
END $$;

-- Build conv merge plan
CREATE TEMP TABLE IF NOT EXISTS _conv_h_merge_plan ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, lead_id
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY organization_id, lead_id
      ORDER BY created_at ASC, id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS keep_id
  FROM public.conversations
  WHERE status IN ('active', 'waiting_human')
)
SELECT id AS drop_id, keep_id
FROM ranked
WHERE rn > 1;

-- Re-aponta messages das convs duplicadas
UPDATE public.messages m
SET conversation_id = cmp.keep_id
FROM _conv_h_merge_plan cmp
WHERE m.conversation_id = cmp.drop_id;

-- Re-aponta agent_conversations.crm_conversation_id
UPDATE public.agent_conversations ac
SET crm_conversation_id = cmp.keep_id
FROM _conv_h_merge_plan cmp
WHERE ac.crm_conversation_id = cmp.drop_id;

-- Re-aponta agent_followup_runs
UPDATE public.agent_followup_runs afr
SET conversation_id = cmp.keep_id
FROM _conv_h_merge_plan cmp
WHERE afr.conversation_id = cmp.drop_id;

-- Deleta convs duplicadas
DELETE FROM public.conversations c
USING _conv_h_merge_plan cmp
WHERE c.id = cmp.drop_id;

-- ============================================================================
-- Step 5: Verificação final
-- ============================================================================

DO $$
DECLARE
  lead_dups integer;
  msg_dups integer;
  conv_dups integer;
BEGIN
  SELECT COUNT(*) INTO lead_dups
  FROM (
    SELECT organization_id, phone FROM public.leads
    WHERE phone IS NOT NULL
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ) x;

  SELECT COUNT(*) INTO msg_dups
  FROM (
    SELECT organization_id, whatsapp_msg_id FROM public.messages
    WHERE whatsapp_msg_id IS NOT NULL
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ) x;

  SELECT COUNT(*) INTO conv_dups
  FROM (
    SELECT organization_id, lead_id FROM public.conversations
    WHERE status IN ('active', 'waiting_human')
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ) x;

  RAISE NOTICE 'POST-MIGRATION: lead_dups=%, msg_dups=%, conv_dups=% (todos devem ser 0)', lead_dups, msg_dups, conv_dups;

  IF lead_dups + msg_dups + conv_dups > 0 THEN
    RAISE WARNING 'Migration deixou duplicatas. Investigar manualmente.';
  END IF;
END $$;

-- ============================================================================
-- Rollback (manual):
--   DROP INDEX IF EXISTS public.messages_org_whatsapp_msg_id_unique;
--   -- Phones já normalizados não fazem sentido reverter.
-- ============================================================================
