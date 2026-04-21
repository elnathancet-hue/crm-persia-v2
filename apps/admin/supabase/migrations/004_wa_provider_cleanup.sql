-- Migration 004: Multi-provider WhatsApp (UAZAPI + Meta Cloud API)
--
-- Relaxa credenciais UAZAPI para nullable (conexoes Meta nao usam instance_url/token),
-- relaxa credenciais Meta (conexoes UAZAPI nao usam), adiciona CHECK para garantir
-- que um dos dois conjuntos esta sempre completo, e permite multiplas conexoes por
-- organizacao (UAZAPI + Meta, ou dois numeros).
--
-- Compativel com o schema existente: a coluna `provider` ja existe com default
-- 'uazapi', entao conexoes antigas continuam validas sem alteracao.

BEGIN;

-- 1. Garante default 'uazapi' e backfill de linhas pre-existentes sem provider.
ALTER TABLE whatsapp_connections
  ALTER COLUMN provider SET DEFAULT 'uazapi';
UPDATE whatsapp_connections SET provider = 'uazapi' WHERE provider IS NULL;
ALTER TABLE whatsapp_connections
  ALTER COLUMN provider SET NOT NULL;

-- 2. Relaxa NOT NULL para permitir combinacoes por provider.
ALTER TABLE whatsapp_connections
  ALTER COLUMN instance_url DROP NOT NULL,
  ALTER COLUMN instance_token DROP NOT NULL;

ALTER TABLE whatsapp_connections
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN waba_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL,
  ALTER COLUMN phone_number DROP NOT NULL;

-- 3. CHECK: credenciais minimas exigidas por provider.
ALTER TABLE whatsapp_connections
  DROP CONSTRAINT IF EXISTS wa_conn_credentials_check;
ALTER TABLE whatsapp_connections
  ADD CONSTRAINT wa_conn_credentials_check CHECK (
    (provider = 'uazapi'
      AND instance_url IS NOT NULL
      AND instance_token IS NOT NULL)
    OR
    (provider = 'meta_cloud'
      AND phone_number_id IS NOT NULL
      AND waba_id IS NOT NULL
      AND access_token IS NOT NULL)
  );

-- 4. Permite multiplas conexoes por organizacao (ex: UAZAPI para marketing + Meta
--    oficial para suporte, ou dois numeros oficiais distintos).
--    A UNIQUE passa a ser (organization_id, phone_number) quando phone_number
--    existe — drafts com phone_number NULL podem coexistir.
ALTER TABLE whatsapp_connections
  DROP CONSTRAINT IF EXISTS whatsapp_connections_organization_id_key;
DROP INDEX IF EXISTS whatsapp_connections_organization_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_wa_conn_org_phone
  ON whatsapp_connections (organization_id, phone_number)
  WHERE phone_number IS NOT NULL;

-- 5. Index para resolucao rapida de webhook Meta por phone_number_id.
CREATE INDEX IF NOT EXISTS idx_wa_conn_phone_number_id
  ON whatsapp_connections (phone_number_id)
  WHERE phone_number_id IS NOT NULL;

COMMIT;
