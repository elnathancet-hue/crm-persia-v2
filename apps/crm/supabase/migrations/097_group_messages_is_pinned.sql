-- Migration 097: add is_pinned flag to group_messages
-- Allows tracking which message is pinned in a group (displayed in banner UI).
ALTER TABLE public.group_messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;
