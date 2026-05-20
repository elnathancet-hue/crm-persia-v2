-- ============================================================
-- MIGRATION 062: MCP server connections + agent_tools extension
-- ------------------------------------------------------------
-- PR-FLOW-PIVOT PR 15 (mai/2026): Model Context Protocol (MCP)
-- como tools da IA. Cliente conecta servidores MCP externos
-- (HTTP/JSON-RPC) e a IA pode chamá-los alongside as tools native.
--
-- Strategy:
--   - 1 tabela mcp_server_connections (1+ servers por org)
--   - cached_tools JSONB armazena lista de tools discovered via
--     `tools/list` chamada manual (botão "Sincronizar" na UI)
--   - Quando cliente habilita uma tool MCP no Decision Intelligence,
--     UM agent_tools row é criado com execution_mode='mcp' +
--     mcp_server_id ref. native_handler fica NULL.
--   - Runtime: flow runner detecta execution_mode='mcp' + faz HTTP
--     POST JSON-RPC `tools/call` em vez de chamar nativeHandlers.
--
-- V1 (intencional):
--   - HTTP transport only (sem SSE streaming)
--   - Auth: 'none' ou 'bearer' (sem OAuth — V2 pode adicionar)
--   - Sync manual (botão), sem auto-discovery em background
-- ============================================================

BEGIN;

-- ============================================================
-- Tabela mcp_server_connections
-- ============================================================

CREATE TABLE IF NOT EXISTS public.mcp_server_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  server_url TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer')),
  auth_token TEXT,
  -- Cache de tools discovered. Shape: [{ name, description, inputSchema }]
  cached_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_synced_at TIMESTAMPTZ,
  last_sync_error TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mcp_server_connections_org
  ON public.mcp_server_connections(organization_id, is_active);

COMMENT ON TABLE public.mcp_server_connections IS
  'PR-FLOW-PIVOT PR 15 (mai/2026): conexões MCP por org. cached_tools cacheado via botão Sincronizar.';

-- ============================================================
-- RLS — org-scoped, read=member, write=admin/owner
-- ============================================================
ALTER TABLE public.mcp_server_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_conn_select_own_org ON public.mcp_server_connections;
CREATE POLICY mcp_conn_select_own_org
  ON public.mcp_server_connections
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

DROP POLICY IF EXISTS mcp_conn_write_own_org ON public.mcp_server_connections;
CREATE POLICY mcp_conn_write_own_org
  ON public.mcp_server_connections
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('admin', 'owner')
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('admin', 'owner')
    )
  );

-- ============================================================
-- Trigger updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.mcp_conn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mcp_conn_set_updated_at ON public.mcp_server_connections;
CREATE TRIGGER mcp_conn_set_updated_at
  BEFORE UPDATE ON public.mcp_server_connections
  FOR EACH ROW EXECUTE FUNCTION public.mcp_conn_update_timestamp();

-- ============================================================
-- Estende agent_tools pra suportar execution_mode='mcp'
-- ============================================================

-- 1. Adiciona coluna mcp_server_id
ALTER TABLE public.agent_tools
  ADD COLUMN IF NOT EXISTS mcp_server_id UUID
    REFERENCES public.mcp_server_connections(id) ON DELETE CASCADE;

-- 2. Substitui CHECK de execution_mode pra aceitar 'mcp'
ALTER TABLE public.agent_tools
  DROP CONSTRAINT IF EXISTS agent_tools_execution_mode_check;

ALTER TABLE public.agent_tools
  ADD CONSTRAINT agent_tools_execution_mode_check
  CHECK (execution_mode IN ('native', 'n8n_webhook', 'mcp'));

-- 3. Substitui CHECK combinado de fields (native_handler vs webhook_url
-- vs mcp_server_id, exatamente um deve estar setado conforme mode).
-- Nome do constraint inferido do schema original (anonymous CHECK).
-- Vamos dropar todos os anonymous CHECKs no agent_tools antes de
-- re-criar com nome explícito.
DO $$
DECLARE
  cons_name TEXT;
BEGIN
  FOR cons_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.agent_tools'::regclass
      AND contype = 'c'
      AND conname NOT IN (
        'agent_tools_execution_mode_check',
        'agent_tools_native_handler_check',
        'agent_tools_auth_type_check'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.agent_tools DROP CONSTRAINT %I', cons_name);
  END LOOP;
END
$$;

ALTER TABLE public.agent_tools
  ADD CONSTRAINT agent_tools_mode_fields_check CHECK (
    (execution_mode = 'native'
       AND native_handler IS NOT NULL
       AND webhook_url IS NULL
       AND mcp_server_id IS NULL)
    OR
    (execution_mode = 'n8n_webhook'
       AND native_handler IS NULL
       AND webhook_url IS NOT NULL
       AND mcp_server_id IS NULL)
    OR
    (execution_mode = 'mcp'
       AND native_handler IS NULL
       AND webhook_url IS NULL
       AND mcp_server_id IS NOT NULL)
  );

COMMENT ON COLUMN public.agent_tools.mcp_server_id IS
  'PR-FLOW-PIVOT PR 15 (mai/2026): FK pra mcp_server_connections quando execution_mode=mcp. NULL pra native/webhook.';

COMMIT;
