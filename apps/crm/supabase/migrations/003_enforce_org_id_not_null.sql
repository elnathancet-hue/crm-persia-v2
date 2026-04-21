-- ============================================================
-- MIGRATION B: Enforce NOT NULL + simplify RLS policies
-- Run ONLY AFTER:
--   1. Migration A has been applied
--   2. Code deploy is done (inserts now include organization_id)
--   3. Validation queries return 0 issues
-- ============================================================

-- ============================================================
-- 1. ENFORCE NOT NULL
-- ============================================================

-- Safety: fill any stragglers from rows created between Migration A and code deploy
UPDATE public.pipeline_stages ps
SET organization_id = p.organization_id
FROM public.pipelines p
WHERE ps.pipeline_id = p.id AND ps.organization_id IS NULL;

UPDATE public.lead_tags lt
SET organization_id = l.organization_id
FROM public.leads l
WHERE lt.lead_id = l.id AND lt.organization_id IS NULL;

UPDATE public.lead_custom_field_values lcfv
SET organization_id = l.organization_id
FROM public.leads l
WHERE lcfv.lead_id = l.id AND lcfv.organization_id IS NULL;

UPDATE public.queue_members qm
SET organization_id = q.organization_id
FROM public.queues q
WHERE qm.queue_id = q.id AND qm.organization_id IS NULL;

-- Now enforce NOT NULL
ALTER TABLE public.pipeline_stages ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.lead_tags ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.lead_custom_field_values ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.queue_members ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- 2. SIMPLIFY RLS POLICIES — switch from join-based to direct org_id
-- ============================================================

-- pipeline_stages: was join-based via pipelines
DROP POLICY IF EXISTS "Org members access stages" ON public.pipeline_stages;
CREATE POLICY "Org members access stages" ON public.pipeline_stages
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- lead_tags: was join-based via leads
DROP POLICY IF EXISTS "Org members access lead_tags" ON public.lead_tags;
CREATE POLICY "Org members access lead_tags" ON public.lead_tags
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- lead_custom_field_values: was join-based via leads
DROP POLICY IF EXISTS "Org members access cf values" ON public.lead_custom_field_values;
CREATE POLICY "Org members access cf values" ON public.lead_custom_field_values
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- queue_members: was join-based via queues
DROP POLICY IF EXISTS "Org members access queue_members" ON public.queue_members;
CREATE POLICY "Org members access queue_members" ON public.queue_members
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));
