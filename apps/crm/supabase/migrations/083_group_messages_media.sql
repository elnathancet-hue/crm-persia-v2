-- Migration 083: add media support and soft-delete to group_messages
ALTER TABLE group_messages
  ADD COLUMN IF NOT EXISTS media_url  TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_group_messages_not_deleted
  ON public.group_messages(organization_id, group_id, created_at DESC)
  WHERE is_deleted = FALSE;
