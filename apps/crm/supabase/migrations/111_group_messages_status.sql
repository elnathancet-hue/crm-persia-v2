-- Migration 100: add status column to group_messages for delivery tracking
-- Mirrors the `status` column on `messages` (sent/delivered/read/failed)

ALTER TABLE group_messages
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent';

-- Index for webhook lookups by whatsapp_msg_id
CREATE INDEX IF NOT EXISTS idx_group_messages_whatsapp_msg_id
  ON group_messages (organization_id, whatsapp_msg_id)
  WHERE whatsapp_msg_id IS NOT NULL;
