-- ============================================================
-- MIGRATION 027: AI Agent follow-up automatico
-- ------------------------------------------------------------
-- Scope:
--   - agent_followups: regras de "X horas apos ultima resposta do
--     lead numa conversa, dispara template Y". Diferente de
--     scheduled_jobs (cron + filtros): aqui e por-conversa, baseado
--     em inatividade do lead.
--   - agent_followup_runs: idempotency log. UNIQUE(followup_id,
--     conversation_id) garante que mesmo se o cron rodar 2x na
--     mesma janela, o lead so recebe o lembrete uma vez.
--
-- Runtime (tick periodico que busca conversas inativas e dispara) e
-- responsabilidade de PR posterior do Codex. Esta migration ja deixa
-- o schema pronto + RLS + index pra runtime ler eficiente.
--
-- IMPORTANTE: SEM functions PL/pgSQL nesta migration pra evitar bug
-- do SQL Editor com $$ (vivido em PR #57). Tudo e DDL puro + RLS.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.agent_followups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_id UUID NOT NULL REFERENCES public.agent_notification_templates(id) ON DELETE RESTRICT,
  -- Horas de inatividade da conversa apos as quais o follow-up dispara.
  -- 1h <= delay <= 720h (30 dias). Range mirror do
  -- FOLLOWUP_DELAY_HOURS_MIN/MAX em packages/shared/src/ai-agent/followups.ts.
  delay_hours INTEGER NOT NULL CHECK (delay_hours BETWEEN 1 AND 720),
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Ordem de exibicao no editor. Disparo NAO depende de ordem — cada
  -- follow-up tem seu proprio gatilho independente.
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Mesma combinacao name+config nao faz sentido (cliente nao distingue
  -- "Follow-up 1" e outro "Follow-up 1" no mesmo agente).
  UNIQUE (config_id, name),
  -- Mirror do FOLLOWUP_NAME_MIN/MAX_CHARS em shared.
  CHECK (char_length(name) BETWEEN 3 AND 80)
);

-- Idempotency log: 1 disparo por (followup_id, conversation_id).
-- O runtime checa esta tabela ANTES de disparar pra nao spam o lead.
-- Cleanup periodico (>90d) recomendado mas nao automatico (evita race
-- com cron tick concorrente).
CREATE TABLE IF NOT EXISTS public.agent_followup_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  followup_id UUID NOT NULL REFERENCES public.agent_followups(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Idempotency garantia. Insert com conflict = no-op.
  UNIQUE (followup_id, conversation_id)
);

-- Indexes
-- Runtime tick filtra por (org, config, enabled) pra carregar follow-ups
-- ativos. Order index pra exibicao no editor.
CREATE INDEX IF NOT EXISTS idx_agent_followups_org_config
  ON public.agent_followups (organization_id, config_id, is_enabled);

-- Lookup rapido pra "ja disparei esse followup nessa conversation?"
CREATE INDEX IF NOT EXISTS idx_agent_followup_runs_followup_conv
  ON public.agent_followup_runs (followup_id, conversation_id);

-- Cleanup de runs antigos vai filtrar por fired_at.
CREATE INDEX IF NOT EXISTS idx_agent_followup_runs_fired_at
  ON public.agent_followup_runs (fired_at);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.agent_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_followup_runs ENABLE ROW LEVEL SECURITY;

-- DROP IF EXISTS antes de cada CREATE POLICY pra deixar a migration
-- idempotente. Postgres NAO tem `CREATE POLICY IF NOT EXISTS`, entao
-- re-executar a migration apos uma falha parcial (ex: comando anterior
-- abortou por conflito) explode com 42710 "policy already exists".
-- Esse padrao DROP+CREATE permite re-rodar sem dor.
DROP POLICY IF EXISTS "agent_followups_select" ON public.agent_followups;
DROP POLICY IF EXISTS "agent_followups_insert" ON public.agent_followups;
DROP POLICY IF EXISTS "agent_followups_update" ON public.agent_followups;
DROP POLICY IF EXISTS "agent_followups_delete" ON public.agent_followups;
DROP POLICY IF EXISTS "agent_followup_runs_select" ON public.agent_followup_runs;

-- agent_followups: agentes leem (executor pode precisar consultar),
-- admins/owners mutam.
CREATE POLICY "agent_followups_select" ON public.agent_followups
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));
CREATE POLICY "agent_followups_insert" ON public.agent_followups
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_followups_update" ON public.agent_followups
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_followups_delete" ON public.agent_followups
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

-- agent_followup_runs: read pra admin/owner (debugging). Write apenas
-- via service_role (runtime) — sem policy de insert/update/delete pra
-- bloquear escrita por usuarios autenticados. Service role bypassa RLS.
CREATE POLICY "agent_followup_runs_select" ON public.agent_followup_runs
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   DROP TABLE IF EXISTS public.agent_followup_runs;
--   DROP TABLE IF EXISTS public.agent_followups;
-- COMMIT;
