-- migration: 076_lead_avatars_storage
-- contexto: URLs de avatar retornadas pelo WhatsApp (pps.whatsapp.net)
-- podem expirar ou bloquear hotlink no navegador. O CRM passa a baixar
-- a imagem no servidor e salvar uma copia publica em Supabase Storage.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lead-avatars',
  'lead-avatars',
  true,
  1048576,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS lead_avatars_bucket_select ON storage.objects;
CREATE POLICY lead_avatars_bucket_select ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'lead-avatars'
    AND get_user_org_role(((storage.foldername(name))[1])::uuid) IS NOT NULL
  );

-- Escrita fica restrita ao service_role usado pelas Server Actions e
-- webhooks. Nao criamos INSERT/UPDATE/DELETE para authenticated para
-- evitar upload arbitrario em nome da organizacao.

COMMIT;

-- Reverter:
-- BEGIN;
--   DROP POLICY IF EXISTS lead_avatars_bucket_select ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'lead-avatars';
-- COMMIT;
