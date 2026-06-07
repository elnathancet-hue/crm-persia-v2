-- Migration 105: Permissões JSONB por módulo em organization_members
-- DEFAULT = acesso total (admin) → zero regressão para membros existentes.

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{
    "agenda":      {"read": true, "write": true,  "delete": true},
    "crm":         {"read": true, "write": true,  "delete": true},
    "chat":        {"read": true, "write": true,  "own_only": false},
    "leads":       {"read": true, "write": true,  "delete": true, "own_only": false},
    "groups":      {"read": true, "write": true},
    "campaigns":   {"read": true, "write": true},
    "automations": {"read": true, "write": true},
    "reports":     {"read": true, "team": true},
    "settings":    {"read": true, "write": true}
  }'::jsonb;

CREATE INDEX IF NOT EXISTS idx_org_members_permissions
  ON public.organization_members USING gin (permissions);

COMMENT ON COLUMN public.organization_members.permissions IS
  'Permissoes por modulo. DEFAULT = admin (acesso total) para nao regredir membros existentes.';
