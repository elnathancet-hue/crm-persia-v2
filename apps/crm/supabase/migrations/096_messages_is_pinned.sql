-- Migration 096: add is_pinned flag to messages
-- Allows tracking which message is pinned in a conversation (displayed in banner UI).
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;
