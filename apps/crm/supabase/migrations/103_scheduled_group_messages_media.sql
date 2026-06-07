-- Migration 103: suporte a mídia em mensagens agendadas de grupos
ALTER TABLE public.scheduled_group_messages
  ADD COLUMN IF NOT EXISTS media_url       TEXT,
  ADD COLUMN IF NOT EXISTS media_type      TEXT,   -- 'image' | 'video' | 'audio' | 'document'
  ADD COLUMN IF NOT EXISTS media_filename  TEXT,
  ADD COLUMN IF NOT EXISTS media_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS media_size      INTEGER;

-- Reverter:
-- ALTER TABLE public.scheduled_group_messages
--   DROP COLUMN IF EXISTS media_url,
--   DROP COLUMN IF EXISTS media_type,
--   DROP COLUMN IF EXISTS media_filename,
--   DROP COLUMN IF EXISTS media_mime_type,
--   DROP COLUMN IF EXISTS media_size;
