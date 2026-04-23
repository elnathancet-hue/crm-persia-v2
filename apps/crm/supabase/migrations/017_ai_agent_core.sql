-- ============================================================
-- MIGRATION 017: native AI Agent core
-- ------------------------------------------------------------
-- Scope:
--   - Core runtime tables only. RAG/FAQ/docs ship later in 018.
--   - One schema for configs, stages, tool registry, stage allowlists,
--     conversation state, runs, and step audit.
--   - RLS follows the existing CRM org_id pattern.
--
-- Safe on live DB: additive tables/policies only.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  scope_type TEXT NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('department', 'pipeline', 'global')),
  scope_id UUID,
  model TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  guardrails JSONB NOT NULL DEFAULT '{
    "max_iterations": 5,
    "timeout_seconds": 30,
    "cost_ceiling_tokens": 20000,
    "allow_human_handoff": true
  }'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_stages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  situation TEXT NOT NULL,
  instruction TEXT NOT NULL DEFAULT '',
  transition_hint TEXT,
  rag_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (config_id, slug)
);

CREATE TABLE IF NOT EXISTS public.agent_tools (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  input_schema JSONB NOT NULL,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('native', 'n8n_webhook')),
  native_handler TEXT CHECK (
    native_handler IS NULL OR native_handler IN (
      'transfer_to_user',
      'transfer_to_stage',
      'transfer_to_agent',
      'add_tag',
      'assign_source',
      'assign_product',
      'assign_department',
      'round_robin_user',
      'round_robin_agent',
      'send_audio',
      'trigger_notification',
      'schedule_event',
      'stop_agent'
    )
  ),
  webhook_url TEXT,
  webhook_secret TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (config_id, name),
  CHECK (
    (execution_mode = 'native' AND native_handler IS NOT NULL AND webhook_url IS NULL)
    OR
    (execution_mode = 'n8n_webhook' AND native_handler IS NULL AND webhook_url IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.agent_stage_tools (
  stage_id UUID NOT NULL REFERENCES public.agent_stages(id) ON DELETE CASCADE,
  tool_id UUID NOT NULL REFERENCES public.agent_tools(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (stage_id, tool_id)
);

CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  crm_conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  current_stage_id UUID REFERENCES public.agent_stages(id) ON DELETE SET NULL,
  history_summary TEXT,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  tokens_used_total INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used_total >= 0),
  human_handoff_at TIMESTAMPTZ,
  human_handoff_reason TEXT,
  last_interaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  inbound_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'fallback', 'canceled')),
  model TEXT NOT NULL,
  tokens_input INTEGER NOT NULL DEFAULT 0 CHECK (tokens_input >= 0),
  tokens_output INTEGER NOT NULL DEFAULT 0 CHECK (tokens_output >= 0),
  cost_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_usd_cents >= 0),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  error_msg TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_steps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 0,
  step_type TEXT NOT NULL CHECK (step_type IN ('llm', 'tool', 'guardrail')),
  tool_id UUID REFERENCES public.agent_tools(id) ON DELETE SET NULL,
  native_handler TEXT CHECK (
    native_handler IS NULL OR native_handler IN (
      'transfer_to_user',
      'transfer_to_stage',
      'transfer_to_agent',
      'add_tag',
      'assign_source',
      'assign_product',
      'assign_department',
      'round_robin_user',
      'round_robin_agent',
      'send_audio',
      'trigger_notification',
      'schedule_event',
      'stop_agent'
    )
  ),
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_configs_org_status
  ON public.agent_configs (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_configs_org_scope
  ON public.agent_configs (organization_id, scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_agent_stages_config_order
  ON public.agent_stages (config_id, order_index);
CREATE INDEX IF NOT EXISTS idx_agent_tools_config_enabled
  ON public.agent_tools (config_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_agent_stage_tools_tool
  ON public.agent_stage_tools (tool_id);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_org_crm
  ON public.agent_conversations (organization_id, crm_conversation_id);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_org_lead
  ON public.agent_conversations (organization_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation_created
  ON public.agent_runs (agent_conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run_order
  ON public.agent_steps (run_id, order_index);

ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_stage_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_steps ENABLE ROW LEVEL SECURITY;

-- Configs/stages/tools are readable by org members; mutations are admin-only.
CREATE POLICY "agent_configs_select" ON public.agent_configs
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));
CREATE POLICY "agent_configs_insert" ON public.agent_configs
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_configs_update" ON public.agent_configs
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_configs_delete" ON public.agent_configs
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "agent_stages_select" ON public.agent_stages
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));
CREATE POLICY "agent_stages_insert" ON public.agent_stages
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_stages_update" ON public.agent_stages
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_stages_delete" ON public.agent_stages
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "agent_tools_select" ON public.agent_tools
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));
CREATE POLICY "agent_tools_insert" ON public.agent_tools
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_tools_update" ON public.agent_tools
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_tools_delete" ON public.agent_tools
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "agent_stage_tools_select" ON public.agent_stage_tools
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));
CREATE POLICY "agent_stage_tools_insert" ON public.agent_stage_tools
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_stage_tools_update" ON public.agent_stage_tools
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_stage_tools_delete" ON public.agent_stage_tools
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

-- Runtime state is admin-readable from UI; service_role writes during webhook.
CREATE POLICY "agent_conversations_select" ON public.agent_conversations
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_conversations_insert" ON public.agent_conversations
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_conversations_update" ON public.agent_conversations
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "agent_runs_select" ON public.agent_runs
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_runs_insert" ON public.agent_runs
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_runs_update" ON public.agent_runs
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "agent_steps_select" ON public.agent_steps
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_steps_insert" ON public.agent_steps
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   DROP TABLE IF EXISTS public.agent_steps;
--   DROP TABLE IF EXISTS public.agent_runs;
--   DROP TABLE IF EXISTS public.agent_conversations;
--   DROP TABLE IF EXISTS public.agent_stage_tools;
--   DROP TABLE IF EXISTS public.agent_tools;
--   DROP TABLE IF EXISTS public.agent_stages;
--   DROP TABLE IF EXISTS public.agent_configs;
-- COMMIT;
