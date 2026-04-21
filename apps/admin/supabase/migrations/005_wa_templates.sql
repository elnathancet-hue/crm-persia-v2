-- Migration 005: WhatsApp templates cache
--
-- Espelha os templates aprovados (ou em review) da Meta localmente para:
--   - latencia zero ao abrir o seletor de template na inbox;
--   - disponibilidade mesmo se a Graph API cair;
--   - calcular params_schema uma vez (no sync) em vez de reparsear a cada envio.
--
-- O sync e idempotente por (connection_id, name, language). meta_template_id
-- pode mudar se o template for editado e re-aprovado, entao nao e UNIQUE.

BEGIN;

CREATE TABLE IF NOT EXISTS wa_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES whatsapp_connections(id) ON DELETE CASCADE,

  meta_template_id TEXT NOT NULL,          -- id retornado pelo GET /{waba_id}/message_templates
  name TEXT NOT NULL,                      -- ex: order_confirmation
  language TEXT NOT NULL,                  -- ex: pt_BR
  category TEXT NOT NULL,                  -- MARKETING | UTILITY | AUTHENTICATION
  status TEXT NOT NULL,                    -- APPROVED | PENDING | REJECTED | PAUSED | DISABLED

  components JSONB NOT NULL,               -- estrutura crua Meta: HEADER, BODY, FOOTER, BUTTONS
  params_schema JSONB NOT NULL,            -- derivado: {format, header:[...], body:[...], buttons:[...]}

  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT wa_templates_conn_name_lang UNIQUE (connection_id, name, language)
);

CREATE INDEX IF NOT EXISTS idx_wa_templates_org_status
  ON wa_templates(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_wa_templates_conn
  ON wa_templates(connection_id);

-- RLS: apenas service_role acessa (admin panel). Nenhuma policy = negado para anon/authenticated.
ALTER TABLE wa_templates ENABLE ROW LEVEL SECURITY;

COMMIT;
