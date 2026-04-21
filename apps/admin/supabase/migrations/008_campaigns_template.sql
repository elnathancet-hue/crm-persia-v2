-- Migration 008: Campanhas com template Meta Cloud
--
-- UAZAPI tem fila nativa (/sender/simple) que aceita texto/midia com delay.
-- Meta Cloud NAO tem fila — campanhas template-based precisam de outbox proprio
-- em wa_template_sends (ja existe desde 006). O worker processa fila via cron.
--
-- Esta migration permite que uma campanha referencie um template ao inves de
-- (ou alem de) uma mensagem de texto livre. Quando template_id existir:
--   - conexao esperada: meta_cloud
--   - executeCampaign cria linhas queued em wa_template_sends
--   - cron /api/cron/process-campaign-sends envia respeitando interval

BEGIN;

-- 1. Colunas novas.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES wa_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variables_template JSONB DEFAULT '{}'::jsonb;

-- 2. `message` passa a ser opcional — template-based nao precisa de texto livre.
ALTER TABLE campaigns ALTER COLUMN message DROP NOT NULL;

-- 3. Constraint: campanha precisa ter OU texto OU template.
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_content_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_content_check CHECK (
  message IS NOT NULL OR template_id IS NOT NULL
);

-- 4. Index para o cron — wa_template_sends queued por campanha.
CREATE INDEX IF NOT EXISTS idx_wa_template_sends_queued
  ON wa_template_sends(status, created_at)
  WHERE status = 'queued' AND campaign_id IS NOT NULL;

COMMIT;
