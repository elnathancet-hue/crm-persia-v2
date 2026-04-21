-- ============================================================
-- ROLLBACK: PR 3 Bloco C — Restore FOR ALL policies
-- ============================================================

-- 1. QUEUES
DROP POLICY IF EXISTS "queues_select" ON public.queues;
DROP POLICY IF EXISTS "queues_insert" ON public.queues;
DROP POLICY IF EXISTS "queues_update" ON public.queues;
DROP POLICY IF EXISTS "queues_delete" ON public.queues;
CREATE POLICY "Org access queues" ON public.queues
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 2. QUEUE_MEMBERS
DROP POLICY IF EXISTS "queue_members_select" ON public.queue_members;
DROP POLICY IF EXISTS "queue_members_insert" ON public.queue_members;
DROP POLICY IF EXISTS "queue_members_delete" ON public.queue_members;
CREATE POLICY "Org members access queue_members" ON public.queue_members
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 3. AUTOMATION_TOOLS
DROP POLICY IF EXISTS "automation_tools_select" ON public.automation_tools;
DROP POLICY IF EXISTS "automation_tools_insert" ON public.automation_tools;
DROP POLICY IF EXISTS "automation_tools_update" ON public.automation_tools;
DROP POLICY IF EXISTS "automation_tools_delete" ON public.automation_tools;
CREATE POLICY "Org access tools" ON public.automation_tools
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 4. MESSAGE_TEMPLATES
DROP POLICY IF EXISTS "message_templates_select" ON public.message_templates;
DROP POLICY IF EXISTS "message_templates_insert" ON public.message_templates;
DROP POLICY IF EXISTS "message_templates_update" ON public.message_templates;
DROP POLICY IF EXISTS "message_templates_delete" ON public.message_templates;
CREATE POLICY "Org access message_templates" ON public.message_templates
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 5. SEGMENTS
DROP POLICY IF EXISTS "segments_select" ON public.segments;
DROP POLICY IF EXISTS "segments_insert" ON public.segments;
DROP POLICY IF EXISTS "segments_update" ON public.segments;
DROP POLICY IF EXISTS "segments_delete" ON public.segments;
CREATE POLICY "Org access segments" ON public.segments
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 6. LANDING_PAGES
DROP POLICY IF EXISTS "landing_pages_select" ON public.landing_pages;
DROP POLICY IF EXISTS "landing_pages_insert" ON public.landing_pages;
DROP POLICY IF EXISTS "landing_pages_update" ON public.landing_pages;
DROP POLICY IF EXISTS "landing_pages_delete" ON public.landing_pages;
CREATE POLICY "Org access landing_pages" ON public.landing_pages
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 7. WHATSAPP_CONNECTIONS
DROP POLICY IF EXISTS "whatsapp_connections_select" ON public.whatsapp_connections;
DROP POLICY IF EXISTS "whatsapp_connections_insert" ON public.whatsapp_connections;
DROP POLICY IF EXISTS "whatsapp_connections_update" ON public.whatsapp_connections;
DROP POLICY IF EXISTS "whatsapp_connections_delete" ON public.whatsapp_connections;
CREATE POLICY "Org access whatsapp_connections" ON public.whatsapp_connections
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 8. INVITATIONS
DROP POLICY IF EXISTS "invitations_select" ON public.invitations;
DROP POLICY IF EXISTS "invitations_insert" ON public.invitations;
DROP POLICY IF EXISTS "invitations_delete" ON public.invitations;
CREATE POLICY "Org access invitations" ON public.invitations
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 9. ONBOARDING_PROGRESS (keep INSERT for authenticated)
DROP POLICY IF EXISTS "onboarding_select" ON public.onboarding_progress;
DROP POLICY IF EXISTS "onboarding_update" ON public.onboarding_progress;
CREATE POLICY "Org access onboarding_progress" ON public.onboarding_progress
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 10. WHATSAPP_GROUPS
DROP POLICY IF EXISTS "whatsapp_groups_select" ON public.whatsapp_groups;
DROP POLICY IF EXISTS "whatsapp_groups_insert" ON public.whatsapp_groups;
DROP POLICY IF EXISTS "whatsapp_groups_update" ON public.whatsapp_groups;
DROP POLICY IF EXISTS "whatsapp_groups_delete" ON public.whatsapp_groups;
CREATE POLICY "Org members access whatsapp_groups" ON public.whatsapp_groups
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));
