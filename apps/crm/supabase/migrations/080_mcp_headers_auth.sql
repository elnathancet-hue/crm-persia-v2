-- ============================================================
-- MIGRATION 078: MCP — adiciona 'headers' como auth_type válido
-- ------------------------------------------------------------
-- Permite que mcp_server_connections use auth via headers
-- customizados (ex: X-API-Key, Authorization com schema custom).
-- Quando auth_type='headers', auth_token armazena JSON com os
-- pares chave-valor: '{"X-API-Key": "abc", "X-Org": "xyz"}'.
-- ============================================================

BEGIN;

-- Drop e recria a constraint inline de auth_type pra incluir 'headers'
ALTER TABLE public.mcp_server_connections
  DROP CONSTRAINT IF EXISTS mcp_server_connections_auth_type_check;

ALTER TABLE public.mcp_server_connections
  ADD CONSTRAINT mcp_server_connections_auth_type_check
  CHECK (auth_type IN ('none', 'bearer', 'headers'));

COMMENT ON COLUMN public.mcp_server_connections.auth_type IS
  'Modo de autenticação: none | bearer (Authorization: Bearer <token>) | headers (headers custom em JSON no auth_token).';

COMMIT;
