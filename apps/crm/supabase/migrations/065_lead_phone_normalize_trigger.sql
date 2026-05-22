-- Bug I fix (mai/2026): DB trigger normaliza leads.phone sempre.
--
-- Sintoma em prod (continuação do Bug C/E/H): mesmo APÓS migration 064
-- ter normalizado phones existentes pra E.164 com '+', novos leads
-- voltaram a ser criados com formato inconsistente (ex: "558699421406"
-- sem '+' coexistindo com "+558699421406" do mesmo contato).
--
-- Análise: UAZAPI envia o telefone em ~5 formatos no mesmo webhook
-- (chat.phone, chat.wa_chatid, chat.wa_chatlid, message.chatid,
-- message.sender_pn). Qualquer código (app, n8n flow custom, Supabase
-- Studio direto, scripts terceiros) que escolha um campo errado e pule
-- a normalização Zod do `phoneBR.parse()` gera lead com formato diferente.
-- UNIQUE(org, phone) é case-sensitive em strings — "+558..." ≠ "558...".
--
-- Esta migration coloca a normalização no ÚLTIMO BASTÃO (defesa em
-- profundidade): um BEFORE INSERT/UPDATE trigger que força:
--   - Remove tudo que não é dígito do phone
--   - Prepende '+' (E.164 implícito — assumindo país já incluso)
--   - NULL se ficar só "+" (era lixo)
--
-- Resultado: independente de QUAL código tente inserir/atualizar
-- leads.phone, o banco sempre armazena no formato canônico "+DDIDDDNUMERO".
--
-- Idempotente: trigger usa CREATE OR REPLACE; re-cleanup é UPDATE no-op
-- se phones já estiverem normalizados.
--
-- COMPATIBILIDADE: não muda o schema (só adiciona function + trigger),
-- então código que lê phone continua funcionando. O ÚNICO efeito visível
-- pra app é que phones agora sempre saem do banco com '+'.

-- ============================================================================
-- Step 1: Função de normalização
-- ============================================================================

CREATE OR REPLACE FUNCTION public.normalize_lead_phone()
RETURNS TRIGGER AS $$
DECLARE
  digits text;
BEGIN
  -- NULL ou vazio: deixa NULL (lead sem telefone é válido)
  IF NEW.phone IS NULL OR NEW.phone = '' THEN
    NEW.phone := NULL;
    RETURN NEW;
  END IF;

  -- Extrai só os dígitos. Trata:
  --   "+55 86 9942-1406"           → "558699421406"
  --   "558699421406@s.whatsapp.net" → "558699421406" (perdeu @ e depois)
  --   "(11) 98765-4321"             → "11987654321"
  --   "+558699421406"               → "558699421406"
  --   "558699421406"                → "558699421406"
  digits := regexp_replace(NEW.phone, '[^0-9]', '', 'g');

  -- Se ficou string vazia (era só caracteres não-numéricos), trata como NULL
  IF digits = '' THEN
    NEW.phone := NULL;
    RETURN NEW;
  END IF;

  -- Formato canônico final: "+digits"
  NEW.phone := '+' || digits;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.normalize_lead_phone() IS
  'Bug I fix (mai/2026): força leads.phone no formato canônico "+digits". '
  'Defense in depth — funciona pra app, n8n, Supabase Studio, qualquer cliente. '
  'Aciona no BEFORE INSERT/UPDATE OF phone (ver trigger tr_normalize_lead_phone).';

-- ============================================================================
-- Step 2: Trigger BEFORE INSERT/UPDATE em leads.phone
-- ============================================================================

DROP TRIGGER IF EXISTS tr_normalize_lead_phone ON public.leads;

CREATE TRIGGER tr_normalize_lead_phone
BEFORE INSERT OR UPDATE OF phone ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.normalize_lead_phone();

COMMENT ON TRIGGER tr_normalize_lead_phone ON public.leads IS
  'Bug I fix (mai/2026): garante leads.phone sempre em "+digits" antes de '
  'persistir. Idempotente — re-aplicar com mesmo valor não muda nada.';

-- ============================================================================
-- Step 3: Re-normaliza phones existentes
--
-- UPDATE no-op (phone = phone) dispara o trigger e normaliza tudo
-- que não esteja no formato canônico. Idempotente.
-- ============================================================================

DO $$
DECLARE
  before_count integer;
  after_count integer;
BEGIN
  -- Conta quantos NÃO estão no formato canônico antes
  SELECT COUNT(*) INTO before_count
  FROM public.leads
  WHERE phone IS NOT NULL
    AND phone != ''
    AND phone NOT SIMILAR TO '\+[0-9]+';

  IF before_count > 0 THEN
    RAISE NOTICE 'Re-normalizing % leads.phone via trigger...', before_count;
  END IF;

  -- Toca em todos os leads com phone — trigger faz o trabalho
  UPDATE public.leads SET phone = phone WHERE phone IS NOT NULL;

  -- Conta quantos ainda estão fora do formato (deve ser 0)
  SELECT COUNT(*) INTO after_count
  FROM public.leads
  WHERE phone IS NOT NULL
    AND phone != ''
    AND phone NOT SIMILAR TO '\+[0-9]+';

  IF after_count > 0 THEN
    RAISE WARNING 'Após trigger, % leads.phone ainda fora do formato. Investigar.', after_count;
  ELSE
    RAISE NOTICE 'Todos os leads.phone agora estão no formato canônico "+digits".';
  END IF;
END $$;

-- ============================================================================
-- Step 4: Merge leads que ficaram duplicados pós re-normalização
--
-- Se algum lead foi criado entre migration 064 e agora com phone diferente,
-- ao re-normalizar pode ter colidido com outro. Resolvemos via merge
-- (mantém o mais antigo, re-aponta tudo). Mesmo padrão das migrations
-- 063 e 064.
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
    RAISE NOTICE 'Found % (org, phone) duplicate groups after trigger normalize. Merging...', dup_groups;
  END IF;
END $$;

-- Build merge plan (idempotente — só popula se houver duplicatas)
CREATE TEMP TABLE IF NOT EXISTS _lead_i_merge_plan ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    organization_id,
    phone,
    avatar_url IS NOT NULL AS has_avatar,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, phone
      -- Prioridade do KEEP:
      --   1. Lead com avatar (visualmente o "principal")
      --   2. Lead mais antigo (criado primeiro)
      --   3. ID asc (desempate determinístico)
      ORDER BY (avatar_url IS NOT NULL) DESC, created_at ASC, id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY organization_id, phone
      ORDER BY (avatar_url IS NOT NULL) DESC, created_at ASC, id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS keep_id
  FROM public.leads
  WHERE phone IS NOT NULL
)
SELECT id AS drop_id, keep_id
FROM ranked
WHERE rn > 1;

-- Re-aponta FKs (mesmo padrão das migrations 063/064)
UPDATE public.messages m
SET lead_id = cmp.keep_id
FROM _lead_i_merge_plan cmp
WHERE m.lead_id = cmp.drop_id;

UPDATE public.conversations c
SET lead_id = cmp.keep_id
FROM _lead_i_merge_plan cmp
WHERE c.lead_id = cmp.drop_id;

UPDATE public.lead_activities la
SET lead_id = cmp.keep_id
FROM _lead_i_merge_plan cmp
WHERE la.lead_id = cmp.drop_id;

UPDATE public.deals d
SET lead_id = cmp.keep_id
FROM _lead_i_merge_plan cmp
WHERE d.lead_id = cmp.drop_id;

UPDATE public.lead_tags lt
SET lead_id = cmp.keep_id
FROM _lead_i_merge_plan cmp
WHERE lt.lead_id = cmp.drop_id;

UPDATE public.agent_conversations ac
SET lead_id = cmp.keep_id
FROM _lead_i_merge_plan cmp
WHERE ac.lead_id = cmp.drop_id;

-- Avatar transfer: se o KEEP não tinha avatar mas o DROP tinha, copia
UPDATE public.leads l
SET avatar_url = (
  SELECT d.avatar_url
  FROM public.leads d
  JOIN _lead_i_merge_plan cmp ON cmp.drop_id = d.id
  WHERE cmp.keep_id = l.id
    AND d.avatar_url IS NOT NULL
  ORDER BY d.created_at ASC
  LIMIT 1
)
WHERE l.id IN (SELECT keep_id FROM _lead_i_merge_plan)
  AND l.avatar_url IS NULL;

-- Deleta leads duplicados
DELETE FROM public.leads l
USING _lead_i_merge_plan cmp
WHERE l.id = cmp.drop_id;

-- ============================================================================
-- Step 5: Merge conversations que ficaram duplicadas pós lead merge
--
-- UNIQUE(org, lead, status='active|waiting_human') da migration 063
-- pode ser violado se o lead merge juntou 2 conversations ativas no
-- mesmo lead. Resolve mesclando-as.
-- ============================================================================

CREATE TEMP TABLE IF NOT EXISTS _conv_i_merge_plan ON COMMIT DROP AS
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

UPDATE public.messages m
SET conversation_id = cmp.keep_id
FROM _conv_i_merge_plan cmp
WHERE m.conversation_id = cmp.drop_id;

UPDATE public.agent_conversations ac
SET crm_conversation_id = cmp.keep_id
FROM _conv_i_merge_plan cmp
WHERE ac.crm_conversation_id = cmp.drop_id;

UPDATE public.agent_followup_runs afr
SET conversation_id = cmp.keep_id
FROM _conv_i_merge_plan cmp
WHERE afr.conversation_id = cmp.drop_id;

DELETE FROM public.conversations c
USING _conv_i_merge_plan cmp
WHERE c.id = cmp.drop_id;

-- ============================================================================
-- Step 6: Verificação final
-- ============================================================================

DO $$
DECLARE
  bad_phones integer;
  lead_dups integer;
  conv_dups integer;
BEGIN
  SELECT COUNT(*) INTO bad_phones
  FROM public.leads
  WHERE phone IS NOT NULL
    AND phone != ''
    AND phone NOT SIMILAR TO '\+[0-9]+';

  SELECT COUNT(*) INTO lead_dups
  FROM (
    SELECT organization_id, phone FROM public.leads
    WHERE phone IS NOT NULL
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ) x;

  SELECT COUNT(*) INTO conv_dups
  FROM (
    SELECT organization_id, lead_id FROM public.conversations
    WHERE status IN ('active', 'waiting_human')
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ) x;

  RAISE NOTICE 'POST-MIGRATION: bad_phones=%, lead_dups=%, conv_dups=% (todos devem ser 0)',
    bad_phones, lead_dups, conv_dups;

  IF bad_phones + lead_dups + conv_dups > 0 THEN
    RAISE WARNING 'Migration 065 deixou inconsistências. Investigar manualmente.';
  ELSE
    RAISE NOTICE 'Migration 065 OK. Trigger ativo, dados consistentes, duplicatas impossíveis.';
  END IF;
END $$;

-- ============================================================================
-- Rollback (manual):
--   DROP TRIGGER IF EXISTS tr_normalize_lead_phone ON public.leads;
--   DROP FUNCTION IF EXISTS public.normalize_lead_phone();
--   -- Phones já normalizados permanecem no formato canônico (sem rollback).
-- ============================================================================
