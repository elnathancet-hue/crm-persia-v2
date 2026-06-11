-- Migration 116: add metadata JSONB to group_messages
-- Used to store location coordinates (latitude, longitude, name, address)
-- and document filenames so the group chat UI can render rich media correctly.
ALTER TABLE public.group_messages ADD COLUMN IF NOT EXISTS metadata JSONB;
