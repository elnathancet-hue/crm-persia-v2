-- ============================================================
-- MIGRATION 052: seed retroativo de transfer_to_stage (+ transfer_to_agent)
--                pra agentes JA criados via template, multi-stage,
--                que esqueceram dessas tools no applyTemplate antigo.
-- ------------------------------------------------------------
-- CONTEXTO (Bug #8, descoberto em 18/mai/2026):
--   `applyTemplate` (apps/crm/src/actions/ai-agent/configs.ts) so
--   adicionava tools mencionadas em auto_actions + tools de agenda +
--   transfer_to_user. transfer_to_stage NUNCA era adicionado, mesmo
--   pra agentes multi-stage. Resultado: a IA via no system prompt
--   `transition_hint` falando "VOCE DEVE chamar transfer_to_stage",
--   mas a tool nao estava na lista do API call — entao a IA ficava
--   presa na etapa inicial e fazia qualificacao/apresentacao/agendamento
--   todos inline. Auto_actions de etapas 2-N nunca disparavam.
--
-- CORRECAO DE CODIGO:
--   Esta PR tambem ajusta `configs.ts` pra adicionar transfer_to_stage
--   (quando stages.length > 1) e transfer_to_agent incondicionalmente.
--   Esta migration cobre apenas os agentes JA criados em prod.
--
-- ESCOPO:
--   So mexe em configs com >= 2 agent_stages. Idempotente:
--     - Skip se ja existe agent_tool com mesmo (config_id, native_handler).
--     - Skip se ja existe agent_stage_tools com mesmo (stage_id, tool_id).
--
-- INPUT_SCHEMA: copiado de packages/shared/src/ai-agent/tool-presets.ts
--   (PR3 — transfer_to_stage / transfer_to_agent). Mantemos em sync.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Insere transfer_to_stage em agent_tools pra configs multi-stage
--    que ainda nao tem a tool. ON CONFLICT DO NOTHING garante
--    idempotency (UNIQUE constraint em agent_tools name por config_id).
-- ============================================================

WITH multi_stage_configs AS (
  SELECT DISTINCT c.id AS config_id, c.organization_id
  FROM public.agent_configs c
  JOIN public.agent_stages s ON s.config_id = c.id
  GROUP BY c.id, c.organization_id
  HAVING COUNT(s.id) >= 2
),
missing_transfer_to_stage AS (
  SELECT mc.config_id, mc.organization_id
  FROM multi_stage_configs mc
  WHERE NOT EXISTS (
    SELECT 1 FROM public.agent_tools t
    WHERE t.config_id = mc.config_id
      AND t.native_handler = 'transfer_to_stage'
  )
)
INSERT INTO public.agent_tools (
  organization_id,
  config_id,
  name,
  description,
  input_schema,
  execution_mode,
  native_handler,
  webhook_url,
  webhook_secret,
  is_enabled
)
SELECT
  m.organization_id,
  m.config_id,
  'transfer_to_stage',
  'Mandatory: call this tool whenever the CURRENT stage''s transition condition is met (the stage''s transition_hint defines it). DO NOT continue conversing in the current stage when the lead has fulfilled the conditions to advance — that would skip auto-actions of later stages and leave the funnel broken. The system prompt lists all stages of this agent — use the stage''s exact `situation` (name) as target_stage_name; never UUIDs.',
  '{"type":"object","properties":{"target_stage_name":{"type":"string","description":"Nome (situation) EXATO da etapa de destino, conforme listado no catalogo de etapas do agente no system prompt."},"reason":{"type":"string"}}}'::jsonb,
  'native',
  'transfer_to_stage',
  NULL,
  NULL,
  true
FROM missing_transfer_to_stage m;

-- ============================================================
-- 2. transfer_to_agent — adiciona em TODOS os agent_configs que ainda
--    nao tem (independente de single/multi stage; agente sem squad
--    simplesmente ignora a tool sem custo).
-- ============================================================

WITH missing_transfer_to_agent AS (
  SELECT c.id AS config_id, c.organization_id
  FROM public.agent_configs c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.agent_tools t
    WHERE t.config_id = c.id
      AND t.native_handler = 'transfer_to_agent'
  )
)
INSERT INTO public.agent_tools (
  organization_id,
  config_id,
  name,
  description,
  input_schema,
  execution_mode,
  native_handler,
  webhook_url,
  webhook_secret,
  is_enabled
)
SELECT
  m.organization_id,
  m.config_id,
  'transfer_to_agent',
  'Hand the conversation to a DIFFERENT agent (ex: Recepcao -> Vendas). Use the target agent''s name — the system prompt lists available agents. Do NOT use UUIDs.',
  '{"type":"object","properties":{"target_agent_name":{"type":"string","description":"Nome (EXATO) do agente de destino conforme listado no catalogo de agentes do system prompt."},"reason":{"type":"string"}}}'::jsonb,
  'native',
  'transfer_to_agent',
  NULL,
  NULL,
  true
FROM missing_transfer_to_agent m;

-- ============================================================
-- 3. Linka as tools recem-criadas (transfer_to_stage + transfer_to_agent)
--    em TODAS as stages de cada config via agent_stage_tools. Sem isso,
--    loadAllowedTools filtra elas fora — a IA continuaria sem ver.
--
--    Idempotency: NOT EXISTS subquery + unique (stage_id, tool_id)
--    no junction (ja constraint da tabela). ON CONFLICT DO NOTHING
--    cobre se outro processo concorrente inserir antes.
-- ============================================================

INSERT INTO public.agent_stage_tools (organization_id, stage_id, tool_id, is_enabled)
SELECT
  s.organization_id,
  s.id AS stage_id,
  t.id AS tool_id,
  true
FROM public.agent_stages s
JOIN public.agent_tools t ON t.config_id = s.config_id
WHERE t.native_handler IN ('transfer_to_stage', 'transfer_to_agent')
  AND NOT EXISTS (
    SELECT 1 FROM public.agent_stage_tools st
    WHERE st.stage_id = s.id AND st.tool_id = t.id
  )
ON CONFLICT (stage_id, tool_id) DO NOTHING;

COMMIT;

-- ============================================================
-- Verificacao manual (rodar no SQL Editor pos-push):
-- ============================================================
-- Configs multi-stage SEM transfer_to_stage (esperado: 0 rows):
--   SELECT c.id, c.name
--     FROM public.agent_configs c
--     JOIN public.agent_stages s ON s.config_id = c.id
--     WHERE NOT EXISTS (
--       SELECT 1 FROM public.agent_tools t
--       WHERE t.config_id = c.id AND t.native_handler = 'transfer_to_stage'
--     )
--     GROUP BY c.id, c.name
--     HAVING COUNT(s.id) >= 2;
--
-- transfer_to_stage tools cuja allowlist NAO inclui todas as stages do
-- config (esperado: 0 rows):
--   SELECT t.id, t.config_id, COUNT(s.id) AS total_stages,
--          COUNT(st.id) AS linked_stages
--     FROM public.agent_tools t
--     JOIN public.agent_stages s ON s.config_id = t.config_id
--     LEFT JOIN public.agent_stage_tools st
--       ON st.tool_id = t.id AND st.stage_id = s.id
--     WHERE t.native_handler = 'transfer_to_stage'
--     GROUP BY t.id, t.config_id
--     HAVING COUNT(s.id) <> COUNT(st.id);
-- ============================================================
