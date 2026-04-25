-- ============================================================
-- MIGRATION 023: AI Agent notification templates
-- ------------------------------------------------------------
-- Scope:
--   - One table: agent_notification_templates (per-config templates
--     que o agente dispara via handler `trigger_notification`).
--   - Cada template vira implicitamente um tool registrado pra o LLM
--     enxergar — o registro real do tool fica em agent_tools (criado
--     pelo runtime / server action quando o template é salvo).
--   - RLS: agent (read), admin/owner (write).
--
-- Additive only; runtime ignora a tabela quando trigger_notification
-- ainda não estiver shipped no enum (mas já está, então ativa direto).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_notification_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('phone', 'group')),
  target_address TEXT NOT NULL,
  body_template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Nome eh case-insensitive unico por agente — o LLM resolve por nome,
  -- entao colisao quebraria a referencia.
  UNIQUE (config_id, name),
  CHECK (char_length(name) BETWEEN 3 AND 60),
  CHECK (char_length(description) BETWEEN 10 AND 500),
  CHECK (char_length(body_template) BETWEEN 1 AND 1500),
  CHECK (char_length(target_address) BETWEEN 5 AND 80)
);

CREATE INDEX IF NOT EXISTS idx_agent_notification_templates_config_status
  ON public.agent_notification_templates (config_id, status);

ALTER TABLE public.agent_notification_templates ENABLE ROW LEVEL SECURITY;

-- Agentes leem (runtime resolve template ao executar handler), admin/owner
-- escrevem (UI da aba Notificacoes).
CREATE POLICY "agent_notification_templates_select" ON public.agent_notification_templates
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));
CREATE POLICY "agent_notification_templates_insert" ON public.agent_notification_templates
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_notification_templates_update" ON public.agent_notification_templates
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_notification_templates_delete" ON public.agent_notification_templates
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   DROP TABLE IF EXISTS public.agent_notification_templates;
-- COMMIT;
