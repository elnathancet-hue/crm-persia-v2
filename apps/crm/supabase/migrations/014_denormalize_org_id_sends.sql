-- ============================================================
-- MIGRATION 014: Denormalize organization_id on *_sends tables
-- ------------------------------------------------------------
-- Motivation: campaign_sends and email_sends enforced multi-tenant
-- isolation via JOIN with parents (campaigns / email_campaigns). That
-- coupling meant any future inconsistency in the parent would cascade
-- into cross-org exposure. Denormalizing organization_id + trigger sync
-- gives us defense in depth and simpler, index-backed policies.
--
-- Safe on live DB: nullable add → backfill → NOT NULL → policies swap.
-- Idempotent: re-runs are no-ops.
-- ============================================================

-- ============================================================
-- 1. ADD NULLABLE COLUMN + FK
-- ============================================================

ALTER TABLE public.campaign_sends
  ADD COLUMN IF NOT EXISTS organization_id UUID
  REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.email_sends
  ADD COLUMN IF NOT EXISTS organization_id UUID
  REFERENCES public.organizations(id) ON DELETE CASCADE;

-- ============================================================
-- 2. BACKFILL FROM PARENT
-- ============================================================

UPDATE public.campaign_sends cs
SET organization_id = c.organization_id
FROM public.campaigns c
WHERE cs.campaign_id = c.id
  AND cs.organization_id IS NULL;

UPDATE public.email_sends es
SET organization_id = ec.organization_id
FROM public.email_campaigns ec
WHERE es.campaign_id = ec.id
  AND es.organization_id IS NULL;

-- ============================================================
-- 3. ENFORCE NOT NULL (only after backfill)
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.campaign_sends WHERE organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'campaign_sends has rows without organization_id — backfill incomplete';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.email_sends WHERE organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'email_sends has rows without organization_id — backfill incomplete';
  END IF;
END $$;

ALTER TABLE public.campaign_sends
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.email_sends
  ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- 4. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_campaign_sends_org ON public.campaign_sends(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_org_campaign
  ON public.campaign_sends(organization_id, campaign_id);

CREATE INDEX IF NOT EXISTS idx_email_sends_org ON public.email_sends(organization_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_org_campaign
  ON public.email_sends(organization_id, campaign_id);

-- ============================================================
-- 5. AUTO-SYNC TRIGGER
-- Guarantees organization_id always matches parent campaign,
-- even if caller forgets or passes a different value.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_campaign_send_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_org UUID;
BEGIN
  SELECT organization_id INTO parent_org
  FROM public.campaigns WHERE id = NEW.campaign_id;

  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'campaign_sends.campaign_id % does not reference a valid campaign', NEW.campaign_id;
  END IF;

  NEW.organization_id := parent_org;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_email_send_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_org UUID;
BEGIN
  SELECT organization_id INTO parent_org
  FROM public.email_campaigns WHERE id = NEW.campaign_id;

  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'email_sends.campaign_id % does not reference a valid email_campaign', NEW.campaign_id;
  END IF;

  NEW.organization_id := parent_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaign_sends_sync_org ON public.campaign_sends;
CREATE TRIGGER campaign_sends_sync_org
  BEFORE INSERT OR UPDATE OF campaign_id ON public.campaign_sends
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_campaign_send_org_id();

DROP TRIGGER IF EXISTS email_sends_sync_org ON public.email_sends;
CREATE TRIGGER email_sends_sync_org
  BEFORE INSERT OR UPDATE OF campaign_id ON public.email_sends
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_email_send_org_id();

-- ============================================================
-- 6. SWAP RLS POLICIES — direct org_id check, no subquery
-- ============================================================

-- campaign_sends
DROP POLICY IF EXISTS "campaign_sends_select" ON public.campaign_sends;
DROP POLICY IF EXISTS "campaign_sends_insert" ON public.campaign_sends;

CREATE POLICY "campaign_sends_select" ON public.campaign_sends
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "campaign_sends_insert" ON public.campaign_sends
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- email_sends
DROP POLICY IF EXISTS "email_sends_select" ON public.email_sends;
DROP POLICY IF EXISTS "email_sends_insert" ON public.email_sends;

CREATE POLICY "email_sends_select" ON public.email_sends
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "email_sends_insert" ON public.email_sends
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- Sends are immutable — keep no UPDATE / DELETE policies

-- ============================================================
-- 7. STORAGE: chat-media bucket policies (defense in depth)
-- ------------------------------------------------------------
-- Bucket is public-read (Supabase default when created via admin
-- action). Path convention: {orgId}/{conversationId}/{file}.
-- We add explicit policies so only service_role (and authenticated
-- members of the owning org) can WRITE into their own org folder,
-- even if someone later accidentally grants broader access.
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'chat-media'
  ) THEN
    -- Drop any legacy permissive policies on storage.objects for this bucket
    DROP POLICY IF EXISTS "chat_media_insert_own_org" ON storage.objects;
    DROP POLICY IF EXISTS "chat_media_update_own_org" ON storage.objects;
    DROP POLICY IF EXISTS "chat_media_delete_own_org" ON storage.objects;

    CREATE POLICY "chat_media_insert_own_org" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'chat-media'
        AND (storage.foldername(name))[1]::uuid IN (SELECT get_user_org_ids())
      );

    CREATE POLICY "chat_media_update_own_org" ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'chat-media'
        AND (storage.foldername(name))[1]::uuid IN (SELECT get_user_org_ids())
      )
      WITH CHECK (
        bucket_id = 'chat-media'
        AND (storage.foldername(name))[1]::uuid IN (SELECT get_user_org_ids())
      );

    CREATE POLICY "chat_media_delete_own_org" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'chat-media'
        AND (storage.foldername(name))[1]::uuid IN (SELECT get_user_org_ids())
      );
  END IF;
END $$;

-- service_role bypasses RLS, so server actions using admin client are unaffected.
-- SELECT remains governed by the bucket's public flag (public URLs).
