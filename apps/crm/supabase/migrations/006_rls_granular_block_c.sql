-- ============================================================
-- PR 3 BLOCO C: RLS granular por role
-- Tabelas: queues, queue_members, automation_tools, message_templates,
--          segments, landing_pages, whatsapp_connections, invitations,
--          onboarding_progress, whatsapp_groups
-- Depends on: get_user_org_role(p_org_id) from migration 004
-- ============================================================

-- ============================================================
-- 1. QUEUES
-- admin+ for all ops (queue config is organizational)
-- ============================================================

DROP POLICY IF EXISTS "Org access queues" ON public.queues;
DROP POLICY IF EXISTS "Org members access queues" ON public.queues;

CREATE POLICY "queues_select" ON public.queues
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "queues_insert" ON public.queues
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "queues_update" ON public.queues
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "queues_delete" ON public.queues
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 2. QUEUE_MEMBERS
-- admin+ for all ops (queue membership is managed by admin)
-- ============================================================

DROP POLICY IF EXISTS "Org members access queue_members" ON public.queue_members;
DROP POLICY IF EXISTS "Org access queue_members" ON public.queue_members;

CREATE POLICY "queue_members_select" ON public.queue_members
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "queue_members_insert" ON public.queue_members
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "queue_members_delete" ON public.queue_members
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- No UPDATE policy — members are added/removed, not updated

-- ============================================================
-- 3. AUTOMATION_TOOLS
-- admin+ for all ops (contains file_url, used by n8n)
-- ============================================================

DROP POLICY IF EXISTS "Org access tools" ON public.automation_tools;
DROP POLICY IF EXISTS "Org members access automation_tools" ON public.automation_tools;

CREATE POLICY "automation_tools_select" ON public.automation_tools
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "automation_tools_insert" ON public.automation_tools
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "automation_tools_update" ON public.automation_tools
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "automation_tools_delete" ON public.automation_tools
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 4. MESSAGE_TEMPLATES
-- SELECT: agent+ (agents use templates in chat)
-- INSERT/UPDATE/DELETE: admin+ (template management is config)
-- ============================================================

DROP POLICY IF EXISTS "Org access message_templates" ON public.message_templates;
DROP POLICY IF EXISTS "Org members access message_templates" ON public.message_templates;

CREATE POLICY "message_templates_select" ON public.message_templates
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "message_templates_insert" ON public.message_templates
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "message_templates_update" ON public.message_templates
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "message_templates_delete" ON public.message_templates
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 5. SEGMENTS
-- SELECT: agent+ (agents filter leads by segment)
-- INSERT/UPDATE/DELETE: admin+ (segmentation rules are config)
-- ============================================================

DROP POLICY IF EXISTS "Org access segments" ON public.segments;
DROP POLICY IF EXISTS "Org members access segments" ON public.segments;

CREATE POLICY "segments_select" ON public.segments
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "segments_insert" ON public.segments
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "segments_update" ON public.segments
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "segments_delete" ON public.segments
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 6. LANDING_PAGES
-- admin+ for all ops (marketing config)
-- ============================================================

DROP POLICY IF EXISTS "Org access landing_pages" ON public.landing_pages;
DROP POLICY IF EXISTS "Org members access landing_pages" ON public.landing_pages;

CREATE POLICY "landing_pages_select" ON public.landing_pages
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "landing_pages_insert" ON public.landing_pages
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "landing_pages_update" ON public.landing_pages
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "landing_pages_delete" ON public.landing_pages
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 7. WHATSAPP_CONNECTIONS
-- admin+ for all ops
-- SENSITIVE: contains instance_token (UAZAPI credential that grants
-- full access to the WhatsApp instance: send messages, disconnect,
-- configure chatbot, access QR code). See UAZAPI docs:
-- all regular endpoints use Header: token (instance_token).
-- ============================================================

DROP POLICY IF EXISTS "Org access whatsapp_connections" ON public.whatsapp_connections;
DROP POLICY IF EXISTS "Org members access whatsapp" ON public.whatsapp_connections;

CREATE POLICY "whatsapp_connections_select" ON public.whatsapp_connections
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "whatsapp_connections_insert" ON public.whatsapp_connections
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "whatsapp_connections_update" ON public.whatsapp_connections
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "whatsapp_connections_delete" ON public.whatsapp_connections
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 8. INVITATIONS
-- admin+ for SELECT/INSERT/DELETE (contains invite token + email)
-- No UPDATE — invitations are accepted via auth flow (service_role)
-- ============================================================

DROP POLICY IF EXISTS "Org access invitations" ON public.invitations;
DROP POLICY IF EXISTS "Org members access invitations" ON public.invitations;

CREATE POLICY "invitations_select" ON public.invitations
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "invitations_insert" ON public.invitations
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "invitations_delete" ON public.invitations
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- No UPDATE policy — invitations are accepted via service_role, not updated by users

-- ============================================================
-- 9. ONBOARDING_PROGRESS
-- SELECT/UPDATE: admin+ (onboarding status is config)
-- INSERT: keep existing "Authenticated users can create onboarding" policy
--         (needed during signup when user has no role yet)
-- No DELETE — onboarding is not deleted
-- ============================================================

DROP POLICY IF EXISTS "Org access onboarding_progress" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Org members access onboarding" ON public.onboarding_progress;
-- KEEP: "Authenticated users can create onboarding" (INSERT for signup flow)

CREATE POLICY "onboarding_select" ON public.onboarding_progress
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "onboarding_update" ON public.onboarding_progress
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

-- No DELETE policy — onboarding records are permanent

-- ============================================================
-- 10. WHATSAPP_GROUPS
-- admin+ for all ops
-- SENSITIVE: contains group_jid (WhatsApp group identifier) and
-- invite_link (group invite URL). All group operations in the code
-- (groups.ts) use requireRole("admin") and access UAZAPI via
-- instance_token. Exposing group_jid or invite_link to agents
-- could enable unauthorized group operations.
-- UAZAPI endpoints: POST /group/create, /group/info, /group/list,
-- /group/inviteInfo, /group/updateName, /group/updateDescription,
-- /group/updateAnnounce, /group/updateParticipants
-- ============================================================

DROP POLICY IF EXISTS "Org members access whatsapp_groups" ON public.whatsapp_groups;
DROP POLICY IF EXISTS "Users can view own org groups" ON public.whatsapp_groups;
DROP POLICY IF EXISTS "Users can insert own org groups" ON public.whatsapp_groups;
DROP POLICY IF EXISTS "Users can update own org groups" ON public.whatsapp_groups;
DROP POLICY IF EXISTS "Users can delete own org groups" ON public.whatsapp_groups;

CREATE POLICY "whatsapp_groups_select" ON public.whatsapp_groups
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "whatsapp_groups_insert" ON public.whatsapp_groups
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "whatsapp_groups_update" ON public.whatsapp_groups
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "whatsapp_groups_delete" ON public.whatsapp_groups
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );
