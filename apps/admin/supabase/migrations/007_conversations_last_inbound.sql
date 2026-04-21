-- Migration 007: denormaliza last_inbound_at em conversations
--
-- Usado pela janela de 24h do Meta Cloud API: para enviar texto livre a uma
-- conversa, a ultima mensagem do lead deve ter menos de 24h. Em vez de varrer
-- messages a cada envio (N+1 por conversa), mantemos o timestamp na propria
-- conversation via trigger AFTER INSERT.

BEGIN;

-- 1. Nova coluna.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

-- 2. Backfill: preenche o valor atual a partir das mensagens existentes.
UPDATE conversations c
SET last_inbound_at = (
  SELECT MAX(m.created_at)
  FROM messages m
  WHERE m.conversation_id = c.id
    AND m.sender = 'lead'
)
WHERE last_inbound_at IS NULL;

-- 3. Trigger: mantem atualizado em cada insert de mensagem inbound.
CREATE OR REPLACE FUNCTION trg_update_last_inbound() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sender = 'lead' THEN
    UPDATE conversations
    SET last_inbound_at = NEW.created_at
    WHERE id = NEW.conversation_id
      AND (last_inbound_at IS NULL OR last_inbound_at < NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_last_inbound ON messages;
CREATE TRIGGER messages_last_inbound
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION trg_update_last_inbound();

-- 4. Index para queries de janela ("conversas dentro da janela de 24h").
CREATE INDEX IF NOT EXISTS idx_conversations_last_inbound
  ON conversations(organization_id, last_inbound_at DESC)
  WHERE last_inbound_at IS NOT NULL;

COMMIT;
