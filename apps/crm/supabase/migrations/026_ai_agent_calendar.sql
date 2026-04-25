-- ============================================================
-- MIGRATION 026: AI Agent Google Calendar integration
-- ------------------------------------------------------------
-- Scope:
--   - agent_calendar_connections: per-org OAuth connections (multi).
--     Refresh token guardado encrypted via Supabase Vault.
--   - agent_configs.calendar_connection_id: cada agente APONTA pra
--     uma connection (1:1 opcional).
--   - schedule_event handler ja esta no native_handler enum, so
--     habilita via tool-presets shipped flag (PR7.3a).
--
-- SEGURANCA: refresh_token NUNCA armazenado cleartext na tabela.
-- Usamos Supabase Vault (https://supabase.com/docs/guides/database/vault)
-- — coluna armazena o ID do secret no Vault, decrypt via
-- vault.secrets() em SECURITY DEFINER function.
-- ============================================================

BEGIN;

-- Vault extension precisa estar habilitada. Supabase ja vem com isso
-- ligado por default em projetos novos; CREATE IF NOT EXISTS eh idempotente.
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE TABLE IF NOT EXISTS public.agent_calendar_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connected_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  google_account_email TEXT NOT NULL,
  google_calendar_id TEXT NOT NULL DEFAULT 'primary',
  display_name TEXT NOT NULL,
  -- ID do secret no Vault, NAO o token cleartext.
  encrypted_refresh_token_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  last_refreshed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Evita conexoes duplicadas pro mesmo google_account_email + calendar
  -- na mesma org.
  UNIQUE (organization_id, google_account_email, google_calendar_id),
  CHECK (char_length(display_name) BETWEEN 1 AND 100),
  CHECK (char_length(google_account_email) BETWEEN 5 AND 254),
  CHECK (char_length(google_calendar_id) BETWEEN 1 AND 200)
);

-- Per-agent assignment: nullable FK. Quando null, handler retorna
-- "calendario nao configurado".
ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS calendar_connection_id UUID
  REFERENCES public.agent_calendar_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_calendar_connections_org_status
  ON public.agent_calendar_connections (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_configs_calendar_connection
  ON public.agent_configs (calendar_connection_id)
  WHERE calendar_connection_id IS NOT NULL;

-- RLS
ALTER TABLE public.agent_calendar_connections ENABLE ROW LEVEL SECURITY;

-- Connections: admin/owner mutam. Agents leem (precisam saber
-- display_name pra mostrar). encrypted_refresh_token_id NUNCA deve ir
-- pro client — server actions devem omitir esse campo.
CREATE POLICY "agent_calendar_connections_select" ON public.agent_calendar_connections
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));
CREATE POLICY "agent_calendar_connections_insert" ON public.agent_calendar_connections
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_calendar_connections_update" ON public.agent_calendar_connections
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_calendar_connections_delete" ON public.agent_calendar_connections
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

-- ============================================================
-- RPC pra resolver refresh token (service_role-only)
-- Codex usa isso no runtime pra trocar por access_token via Google.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_calendar_refresh_token(
  p_connection_id UUID,
  p_organization_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret_id UUID;
  v_secret TEXT;
BEGIN
  SELECT encrypted_refresh_token_id INTO v_secret_id
  FROM public.agent_calendar_connections
  WHERE id = p_connection_id
    AND organization_id = p_organization_id
    AND status = 'active';

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = v_secret_id;

  RETURN v_secret;
END;
$$;

-- Helper pra criar/atualizar conexao com token gravado direto no Vault.
-- Server action chama isso ao final do OAuth flow.
CREATE OR REPLACE FUNCTION public.upsert_calendar_connection(
  p_organization_id UUID,
  p_user_id UUID,
  p_google_email TEXT,
  p_google_calendar_id TEXT,
  p_display_name TEXT,
  p_refresh_token TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_existing_id UUID;
  v_existing_secret_id UUID;
  v_secret_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT id, encrypted_refresh_token_id
  INTO v_existing_id, v_existing_secret_id
  FROM public.agent_calendar_connections
  WHERE organization_id = p_organization_id
    AND google_account_email = p_google_email
    AND google_calendar_id = p_google_calendar_id;

  IF v_existing_id IS NOT NULL THEN
    -- Reuse o secret existente: update value
    PERFORM vault.update_secret(v_existing_secret_id, p_refresh_token);

    UPDATE public.agent_calendar_connections
    SET
      connected_by_user_id = p_user_id,
      display_name = p_display_name,
      status = 'active',
      last_refreshed_at = v_now,
      last_error = NULL,
      updated_at = v_now
    WHERE id = v_existing_id;

    RETURN v_existing_id;
  END IF;

  -- Cria novo secret no Vault
  v_secret_id := vault.create_secret(
    p_refresh_token,
    'agent_calendar_refresh_' || p_google_email || '_' || p_organization_id::text,
    'Google Calendar refresh token (auto-generated)'
  );

  INSERT INTO public.agent_calendar_connections (
    organization_id,
    connected_by_user_id,
    google_account_email,
    google_calendar_id,
    display_name,
    encrypted_refresh_token_id,
    status,
    last_refreshed_at
  ) VALUES (
    p_organization_id,
    p_user_id,
    p_google_email,
    p_google_calendar_id,
    p_display_name,
    v_secret_id,
    'active',
    v_now
  )
  RETURNING id INTO v_existing_id;

  RETURN v_existing_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_calendar_refresh_token(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_calendar_connection(UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_calendar_refresh_token(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_calendar_connection(UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.upsert_calendar_connection(UUID, UUID, TEXT, TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS public.get_calendar_refresh_token(UUID, UUID);
--   ALTER TABLE public.agent_configs DROP COLUMN IF EXISTS calendar_connection_id;
--   DROP TABLE IF EXISTS public.agent_calendar_connections;
--   -- Vault secrets antigos ficam orfaos; rodar SELECT vault.delete_secret(id)
--   -- pra cada um manualmente se quiser limpar.
-- COMMIT;
