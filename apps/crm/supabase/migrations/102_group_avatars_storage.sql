-- Migration 102: storage publico para avatares de grupos e membros
-- URLs pps.whatsapp.net bloqueiam hotlink no navegador. O CRM baixa no
-- servidor e salva uma copia publica no Supabase Storage.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'group-avatars',
  'group-avatars',
  true,
  1048576,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS group_avatars_bucket_select ON storage.objects;
CREATE POLICY group_avatars_bucket_select ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'group-avatars'
    AND get_user_org_role(((storage.foldername(name))[1])::uuid) IS NOT NULL
  );

COMMIT;

-- Reverter:
-- BEGIN;
--   DROP POLICY IF EXISTS group_avatars_bucket_select ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'group-avatars';
-- COMMIT;
