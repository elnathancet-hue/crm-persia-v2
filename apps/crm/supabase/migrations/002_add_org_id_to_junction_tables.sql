-- ============================================================
-- MIGRATION A: Add organization_id to junction tables (NULLABLE)
-- Run BEFORE code deploy. Safe to run on live DB.
-- ============================================================

-- ============================================================
-- 1. ADD NULLABLE COLUMNS
-- ============================================================

-- pipeline_stages: parent = pipelines
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- lead_tags: parent = leads (and tags, both have org_id)
ALTER TABLE public.lead_tags
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- lead_custom_field_values: parent = leads
ALTER TABLE public.lead_custom_field_values
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- queue_members: parent = queues
ALTER TABLE public.queue_members
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- ============================================================
-- 2. BACKFILL FROM PARENT TABLES
-- ============================================================

-- pipeline_stages ← pipelines.organization_id
UPDATE public.pipeline_stages ps
SET organization_id = p.organization_id
FROM public.pipelines p
WHERE ps.pipeline_id = p.id
  AND ps.organization_id IS NULL;

-- lead_tags ← leads.organization_id
UPDATE public.lead_tags lt
SET organization_id = l.organization_id
FROM public.leads l
WHERE lt.lead_id = l.id
  AND lt.organization_id IS NULL;

-- lead_custom_field_values ← leads.organization_id
UPDATE public.lead_custom_field_values lcfv
SET organization_id = l.organization_id
FROM public.leads l
WHERE lcfv.lead_id = l.id
  AND lcfv.organization_id IS NULL;

-- queue_members ← queues.organization_id
UPDATE public.queue_members qm
SET organization_id = q.organization_id
FROM public.queues q
WHERE qm.queue_id = q.id
  AND qm.organization_id IS NULL;

-- ============================================================
-- 3. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_org ON public.pipeline_stages(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_tags_org ON public.lead_tags(organization_id);
CREATE INDEX IF NOT EXISTS idx_lcfv_org ON public.lead_custom_field_values(organization_id);
CREATE INDEX IF NOT EXISTS idx_queue_members_org ON public.queue_members(organization_id);

-- ============================================================
-- 4. ENSURE RLS ON POST-MIGRATION TABLES
-- (these tables may have been created without RLS)
-- ============================================================

-- whatsapp_groups
ALTER TABLE IF EXISTS public.whatsapp_groups ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_groups' AND policyname = 'Org members access whatsapp_groups'
  ) THEN
    CREATE POLICY "Org members access whatsapp_groups" ON public.whatsapp_groups
      FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));
  END IF;
END $$;

-- automation_tools
ALTER TABLE IF EXISTS public.automation_tools ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'automation_tools' AND policyname = 'Org members access automation_tools'
  ) THEN
    CREATE POLICY "Org members access automation_tools" ON public.automation_tools
      FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));
  END IF;
END $$;

-- scheduled_messages
ALTER TABLE IF EXISTS public.scheduled_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scheduled_messages' AND policyname = 'Org members access scheduled_messages'
  ) THEN
    CREATE POLICY "Org members access scheduled_messages" ON public.scheduled_messages
      FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));
  END IF;
END $$;
