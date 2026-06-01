-- Migration 082: add missing settings columns to whatsapp_groups
-- Fixes DB drift where is_locked, is_join_approval_required, member_add_mode
-- and ephemeral_duration were applied to UAZAPI but never persisted in the DB.

ALTER TABLE whatsapp_groups
  ADD COLUMN IF NOT EXISTS is_locked              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_join_approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS member_add_mode        TEXT    NOT NULL DEFAULT 'all_member_add',
  ADD COLUMN IF NOT EXISTS ephemeral_duration     TEXT    NOT NULL DEFAULT 'off';
