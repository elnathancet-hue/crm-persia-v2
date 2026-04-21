-- Migration 006: WhatsApp template sends tracking
--
-- Cada envio de template (1-a-1 na inbox ou via campanha) gera uma linha aqui
-- para rastrear o ciclo de vida: queued → sent → delivered → read → replied.
-- A conexao com messages e opcional (SET NULL) para nao bloquear exclusao de
-- mensagens; a conexao com templates e RESTRICT para evitar perda de historico.

BEGIN;

CREATE TABLE IF NOT EXISTS wa_template_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  template_id UUID NOT NULL REFERENCES wa_templates(id) ON DELETE RESTRICT,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,  -- NULL = envio 1-a-1
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,

  variables JSONB NOT NULL DEFAULT '{}',   -- valores usados nos params do template
  status TEXT NOT NULL DEFAULT 'queued',   -- queued, sent, delivered, read, replied, failed
  wamid TEXT,                              -- ID na Meta, preenchido apos envio
  error_code TEXT,
  error_detail TEXT,

  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_template_sends_campaign
  ON wa_template_sends(campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_template_sends_wamid
  ON wa_template_sends(wamid)
  WHERE wamid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_template_sends_org_status
  ON wa_template_sends(organization_id, status);

-- Opcional: link reverso de messages → template_send
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS template_send_id UUID REFERENCES wa_template_sends(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_template_send
  ON messages(template_send_id)
  WHERE template_send_id IS NOT NULL;

ALTER TABLE wa_template_sends ENABLE ROW LEVEL SECURITY;

COMMIT;
