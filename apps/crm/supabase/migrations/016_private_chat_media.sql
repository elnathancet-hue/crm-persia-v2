-- ============================================================
-- MIGRATION 016: make chat-media private-ready
-- ------------------------------------------------------------
-- Motivation:
--   chat-media stores customer conversation attachments. Public bucket URLs
--   are too permissive for multi-tenant isolation: anyone with the URL can
--   read the object. The application now resolves chat-media refs and legacy
--   public URLs through short-lived signed URLs, so the bucket can be private.
--
-- Safe rollout:
--   1. Deploy app code that signs chat-media URLs.
--   2. Apply this migration.
--   3. Existing public URLs stored in messages.media_url keep working because
--      the app extracts the storage path and creates a signed URL.
--
-- This migration does not touch message rows.
-- ============================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', false)
ON CONFLICT (id) DO UPDATE
SET public = false;

-- Replace previous write-only policies from migration 014 with private bucket
-- policies scoped by the first path segment: {organization_id}/{conversation_id}/{file}.
DROP POLICY IF EXISTS "chat_media_select_own_org" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_insert_own_org" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_update_own_org" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_delete_own_org" ON storage.objects;

CREATE POLICY "chat_media_select_own_org" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.is_active = true
        AND om.organization_id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "chat_media_insert_own_org" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.is_active = true
        AND om.organization_id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "chat_media_update_own_org" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.is_active = true
        AND om.organization_id::text = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.is_active = true
        AND om.organization_id::text = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "chat_media_delete_own_org" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.user_id = auth.uid()
        AND om.is_active = true
        AND om.organization_id::text = (storage.foldername(name))[1]
    )
  );

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   UPDATE storage.buckets SET public = true WHERE id = 'chat-media';
--   DROP POLICY IF EXISTS "chat_media_select_own_org" ON storage.objects;
--   DROP POLICY IF EXISTS "chat_media_insert_own_org" ON storage.objects;
--   DROP POLICY IF EXISTS "chat_media_update_own_org" ON storage.objects;
--   DROP POLICY IF EXISTS "chat_media_delete_own_org" ON storage.objects;
-- COMMIT;
