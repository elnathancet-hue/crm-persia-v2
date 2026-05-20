-- ============================================================
-- MIGRATION 054: AI Agent — pivot pra canvas visual (React Flow)
-- ------------------------------------------------------------
-- DECISÃO ARQUITETURAL (mai/2026):
--   Stages lineares + auto_actions por stage = IA "dona do workflow",
--   forçada a decidir QUANDO chamar tool/transferir etapa. Resultado:
--   Bug #7 (IA alucinava agendamento sem chamar create_appointment),
--   Bug #8 (IA presa em etapa fazendo funil inline). Documentado em
--   project_ai_agent_live_test_session.md.
--
--   Pivot: AI Agent vira node de um canvas visual (@xyflow/react). O
--   FLUXO é o cérebro — IA é UMA peça. Cliente desenha "agendamento
--   criado → Notificar equipe + Mover funil pra Reunião agendada" via
--   linha visual. Runtime emite evento quando create_appointment retorna
--   sucesso e segue edges deterministicamente. IA não precisa "lembrar"
--   de nada além de chamar a tool.
--
-- ESTA MIGRATION:
--   1. DROP agent_stages + agent_stage_tools (obsoletos pelo canvas).
--   2. ADD agent_flows (1 row por agent_config com nodes/edges JSONB).
--   3. MIGRATE agent_conversations.current_stage_id (UUID FK) →
--      current_node_id (TEXT) — NodeID do React Flow é string client-side.
--   4. UPDATE agent_configs.behavior_mode CHECK: aceita só 'flow' (mantém
--      coluna pra futuro multi-modo).
--
-- DESTRUTIVO POR DESIGN:
--   Não há cliente em prod usando AI Agent (em construção). Drop direto
--   sem deprecation. Tudo o que sobrevive — CRM, Agenda, leads, tags,
--   conversations, messages, appointments, notification_templates,
--   followups, knowledge sources/chunks, runs/steps, cost limits,
--   scheduled jobs — fica intacto.
--
-- PRESERVA (NÃO TOCA):
--   agent_configs, agent_tools, agent_conversations (rename de coluna),
--   agent_notification_templates, agent_followups, agent_followup_runs,
--   agent_knowledge_sources, agent_knowledge_chunks, agent_runs,
--   agent_steps, agent_cost_limits, agent_scheduled_jobs,
--   agent_scheduled_runs, agent_indexing_jobs,
--   agent_calendar_connections, agent_usage_daily.
--
-- TYPES no @persia/shared:
--   FlowNode (discriminated union: entry | ai_agent | action | condition)
--   FlowEdge (source/target + sourceHandle nomeado)
--   FlowConfig (nodes + edges + viewport + enabled_tools)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. DROP stages + junction (CASCADE remove FKs em conversations)
-- ============================================================

-- Primeiro removemos o FK em agent_conversations.current_stage_id pra
-- poder dropar agent_stages sem CASCADE explodir referências externas.
ALTER TABLE public.agent_conversations
  DROP CONSTRAINT IF EXISTS agent_conversations_current_stage_id_fkey;

DROP TABLE IF EXISTS public.agent_stage_tools CASCADE;
DROP TABLE IF EXISTS public.agent_stages CASCADE;

-- ============================================================
-- 2. MIGRATE agent_conversations
--    current_stage_id (UUID) → current_node_id (TEXT)
--    actions_executed continua array mas armazena node_ids agora.
--    actions_executed_detail continua JSONB com keys "on_enter:<node_id>".
-- ============================================================

ALTER TABLE public.agent_conversations
  DROP COLUMN IF EXISTS current_stage_id;

ALTER TABLE public.agent_conversations
  ADD COLUMN IF NOT EXISTS current_node_id TEXT;

COMMENT ON COLUMN public.agent_conversations.current_node_id IS
  'PR-FLOW-PIVOT (mai/2026): ID do node ativo no canvas (string do React Flow). Substitui current_stage_id UUID. NULL = conversa não entrou no flow ainda.';

-- ============================================================
-- 3. UPDATE agent_configs.behavior_mode CHECK
--    Antes: 'stages' | 'actions' (legados)
--    Agora: 'flow' fixo (mantém coluna pra futuro multi-modo)
-- ============================================================

-- Atualiza rows existentes pra 'flow' antes de trocar o CHECK (senão
-- o ALTER falha em rows com valor antigo).
UPDATE public.agent_configs
  SET behavior_mode = 'flow'
  WHERE behavior_mode IS NULL OR behavior_mode NOT IN ('flow');

ALTER TABLE public.agent_configs
  ALTER COLUMN behavior_mode SET DEFAULT 'flow';

-- Drop CHECK antigo (nome canônico postgres-generated; tentamos
-- ambos os formatos possíveis defensivamente).
ALTER TABLE public.agent_configs
  DROP CONSTRAINT IF EXISTS agent_configs_behavior_mode_check;

ALTER TABLE public.agent_configs
  ADD CONSTRAINT agent_configs_behavior_mode_check
    CHECK (behavior_mode = 'flow');

COMMENT ON COLUMN public.agent_configs.behavior_mode IS
  'PR-FLOW-PIVOT (mai/2026): único valor aceito é "flow" (canvas visual via @xyflow/react). Coluna mantida pra futuro multi-modo; deprecated values "stages"/"actions" removidos.';

-- ============================================================
-- 4. ADD agent_flows (1 row por agent_config)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_flows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_config_id UUID NOT NULL UNIQUE REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- nodes: array de FlowNode (discriminated union: entry|ai_agent|action|condition).
  -- Cada node tem {id, type, position: {x,y}, data: {...}}. Veja types em
  -- @persia/shared/ai-agent/flow.ts pra shape exato.
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- edges: array de FlowEdge {id, source, target, sourceHandle, targetHandle?}.
  -- sourceHandle nomeia o output do node origem (ex: "agendamento_criado"
  -- pra AI node, "yes"/"no" pra condition). Determina qual branch dispara.
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- viewport: pan/zoom do canvas pra persistir estado de visualização.
  viewport JSONB NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}'::jsonb,
  -- enabled_tools: allowlist de agent_tools.id que a IA pode chamar em
  -- TODO o flow (escopo global, não per-node). V2 pode adicionar override
  -- por AI node.
  enabled_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- version: incrementa a cada save. Permite optimistic locking + audit.
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agent_flows_nodes_array CHECK (jsonb_typeof(nodes) = 'array'),
  CONSTRAINT agent_flows_edges_array CHECK (jsonb_typeof(edges) = 'array'),
  CONSTRAINT agent_flows_viewport_object CHECK (jsonb_typeof(viewport) = 'object'),
  CONSTRAINT agent_flows_enabled_tools_array CHECK (jsonb_typeof(enabled_tools) = 'array'),
  CONSTRAINT agent_flows_version_positive CHECK (version > 0)
);

CREATE INDEX IF NOT EXISTS idx_agent_flows_organization
  ON public.agent_flows (organization_id);

-- Trigger pra atualizar updated_at automaticamente (reusa função
-- existente do projeto).
CREATE TRIGGER set_updated_at_agent_flows
  BEFORE UPDATE ON public.agent_flows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 5. RLS — mesmo padrão de agent_configs
--    SELECT: agent+ (todos com role >= viewer veem)
--    INSERT/UPDATE/DELETE: admin+ (só donos/admins editam)
-- ============================================================

ALTER TABLE public.agent_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_flows_select" ON public.agent_flows
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent', 'viewer'));

CREATE POLICY "agent_flows_insert" ON public.agent_flows
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "agent_flows_update" ON public.agent_flows
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "agent_flows_delete" ON public.agent_flows
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

COMMENT ON TABLE public.agent_flows IS
  'PR-FLOW-PIVOT (mai/2026): canvas visual do AI Agent (@xyflow/react). 1 row por agent_config. Substitui agent_stages + agent_stage_tools + action_config. Runtime em apps/crm/src/lib/ai-agent/flow-executor.ts interpreta nodes/edges como grafo.';

COMMIT;

-- ============================================================
-- Rollback (manual — não automatizado):
-- ============================================================
-- BEGIN;
--   -- Re-cria agent_stages + junction (vazio — dados perdidos)
--   -- Restaura current_stage_id em agent_conversations
--   -- Re-aceita behavior_mode IN ('stages','actions')
--   -- Drop agent_flows
--   DROP TABLE IF EXISTS public.agent_flows CASCADE;
--   ALTER TABLE public.agent_configs
--     DROP CONSTRAINT IF EXISTS agent_configs_behavior_mode_check;
--   ALTER TABLE public.agent_configs
--     ADD CONSTRAINT agent_configs_behavior_mode_check
--       CHECK (behavior_mode IN ('stages', 'actions'));
--   ALTER TABLE public.agent_configs
--     ALTER COLUMN behavior_mode SET DEFAULT 'stages';
--   ALTER TABLE public.agent_conversations
--     DROP COLUMN IF EXISTS current_node_id;
--   ALTER TABLE public.agent_conversations
--     ADD COLUMN current_stage_id UUID;
--   -- agent_stages + agent_stage_tools precisariam ser recriadas
--   -- conforme migration 017 — não automatizado aqui.
-- COMMIT;
