-- ============================================================
-- MIGRATION 059: google_calendar_connections — OAuth foundation
-- ------------------------------------------------------------
-- PR-FLOW-PIVOT PR 14a (mai/2026): tabela dedicada pra armazenar
-- conexões Google Calendar por org. Foundation pra PRs futuros
-- (14b: substitui create_appointment, 14c: bidirectional sync).
--
-- Strategy V1:
--   - 1 conexão por org (PK organization_id). V2 pode expandir
--     pra N conexões (1 por agent humano) se cliente pedir.
--   - Tokens armazenados em texto plano. V2 introduz encryption
--     via pgsodium quando outros secrets também migrarem.
--   - calendar_list cacheada em JSONB — refresh sob demanda na
--     server action (não tem TTL, cliente recarrega manualmente).
--   - is_active permite "soft disconnect" sem perder histórico
--     (V2 pode auditar reconnections).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  google_account_email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  -- Default calendar usado pela IA quando criar eventos (futuro PR 14b).
  default_calendar_id TEXT,
  -- Cache da lista de calendars do usuário [{ id, summary, primary, timeZone }].
  -- Refresh via server action; sem TTL automático em V1.
  calendar_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Scopes concedidos no OAuth — guarda pra detectar quando precisa reconectar
  -- (se cliente adicionar feature que precise de scope novo).
  scope TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  connected_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.google_calendar_connections IS
  'PR-FLOW-PIVOT PR 14a (mai/2026): OAuth Google Calendar por org. V1 plaintext tokens (V2 encryption pgsodium).';

-- ============================================================
-- RLS — org-scoped, somente admin/owner lê/escreve
-- ============================================================
ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro ativo da org pode ler (UI mostra status).
DROP POLICY IF EXISTS gcal_conn_select_own_org
  ON public.google_calendar_connections;
CREATE POLICY gcal_conn_select_own_org
  ON public.google_calendar_connections
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND is_active = true
    )
  );

-- INSERT/UPDATE/DELETE: somente admin/owner (server action enforça via
-- requireRole, RLS é defense-in-depth).
DROP POLICY IF EXISTS gcal_conn_write_own_org
  ON public.google_calendar_connections;
CREATE POLICY gcal_conn_write_own_org
  ON public.google_calendar_connections
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'owner')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM organization_members
      WHERE user_id = auth.uid()
        AND is_active = true
        AND role IN ('admin', 'owner')
    )
  );

-- ============================================================
-- Trigger pra atualizar updated_at automaticamente
-- ============================================================
CREATE OR REPLACE FUNCTION public.gcal_conn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gcal_conn_set_updated_at
  ON public.google_calendar_connections;
CREATE TRIGGER gcal_conn_set_updated_at
  BEFORE UPDATE ON public.google_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.gcal_conn_update_timestamp();

COMMIT;
