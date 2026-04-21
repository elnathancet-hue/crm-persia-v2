-- ============================================================
-- PR 3 BLOCO A: RLS granular por role
-- Tabelas: leads, lead_tags, lead_activities, lead_custom_field_values,
--          conversations, messages, scheduled_messages, tags, custom_fields
-- ============================================================

-- ============================================================
-- 0. HELPER FUNCTION: get_user_org_role(p_org_id)
-- Returns the role of auth.uid() in the given org, or NULL if not a member.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_org_role(p_org_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM public.organization_members
  WHERE user_id = auth.uid()
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;
$$;

-- ============================================================
-- 1. LEADS
-- SELECT: agent+  |  INSERT: agent+  |  UPDATE: agent+  |  DELETE: agent+
-- ============================================================

DROP POLICY IF EXISTS "Org access leads" ON public.leads;
DROP POLICY IF EXISTS "Org members access leads" ON public.leads;

CREATE POLICY "leads_select" ON public.leads
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "leads_insert" ON public.leads
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "leads_update" ON public.leads
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

CREATE POLICY "leads_delete" ON public.leads
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

-- ============================================================
-- 2. LEAD_TAGS
-- SELECT: agent+  |  INSERT: agent+  |  DELETE: agent+  |  UPDATE: none
-- ============================================================

DROP POLICY IF EXISTS "Org members access lead_tags" ON public.lead_tags;
DROP POLICY IF EXISTS "Org access lead_tags" ON public.lead_tags;

CREATE POLICY "lead_tags_select" ON public.lead_tags
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "lead_tags_insert" ON public.lead_tags
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "lead_tags_delete" ON public.lead_tags
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

-- No UPDATE policy — junction table rows are not updated

-- ============================================================
-- 3. LEAD_ACTIVITIES
-- SELECT: agent+  |  INSERT: agent+  |  UPDATE: none  |  DELETE: none
-- ============================================================

DROP POLICY IF EXISTS "Org access lead_activities" ON public.lead_activities;
DROP POLICY IF EXISTS "Org members access lead_activities" ON public.lead_activities;

CREATE POLICY "lead_activities_select" ON public.lead_activities
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "lead_activities_insert" ON public.lead_activities
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

-- No UPDATE/DELETE policies — activities are immutable audit records

-- ============================================================
-- 4. LEAD_CUSTOM_FIELD_VALUES
-- SELECT: agent+  |  INSERT: agent+  |  UPDATE: agent+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org members access cf values" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "Org access cf values" ON public.lead_custom_field_values;

CREATE POLICY "lcfv_select" ON public.lead_custom_field_values
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "lcfv_insert" ON public.lead_custom_field_values
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "lcfv_update" ON public.lead_custom_field_values
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

CREATE POLICY "lcfv_delete" ON public.lead_custom_field_values
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 5. CONVERSATIONS
-- SELECT: agent+  |  INSERT: agent+  |  UPDATE: agent+  |  DELETE: none
-- ============================================================

DROP POLICY IF EXISTS "Org access conversations" ON public.conversations;
DROP POLICY IF EXISTS "Org members access conversations" ON public.conversations;

CREATE POLICY "conversations_select" ON public.conversations
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "conversations_insert" ON public.conversations
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "conversations_update" ON public.conversations
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

-- No DELETE policy — conversations are not deleted

-- ============================================================
-- 6. MESSAGES
-- SELECT: agent+  |  INSERT: agent+  |  UPDATE: agent+  |  DELETE: none
-- ============================================================

DROP POLICY IF EXISTS "Org access messages" ON public.messages;
DROP POLICY IF EXISTS "Org members access messages" ON public.messages;

CREATE POLICY "messages_select" ON public.messages
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "messages_update" ON public.messages
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

-- No DELETE policy — messages are not deleted

-- ============================================================
-- 7. SCHEDULED_MESSAGES
-- SELECT: agent+  |  INSERT: agent+  |  UPDATE: agent+  |  DELETE: agent+
-- ============================================================

DROP POLICY IF EXISTS "Org access scheduled_messages" ON public.scheduled_messages;
DROP POLICY IF EXISTS "Org members access scheduled_messages" ON public.scheduled_messages;

CREATE POLICY "scheduled_messages_select" ON public.scheduled_messages
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "scheduled_messages_insert" ON public.scheduled_messages
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "scheduled_messages_update" ON public.scheduled_messages
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

CREATE POLICY "scheduled_messages_delete" ON public.scheduled_messages
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

-- ============================================================
-- 8. TAGS
-- SELECT: agent+  |  INSERT: agent+  |  UPDATE: agent+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org access tags" ON public.tags;
DROP POLICY IF EXISTS "Org members access tags" ON public.tags;

CREATE POLICY "tags_select" ON public.tags
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "tags_insert" ON public.tags
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "tags_update" ON public.tags
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

CREATE POLICY "tags_delete" ON public.tags
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 9. CUSTOM_FIELDS
-- SELECT: agent+  |  INSERT: admin+  |  UPDATE: admin+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org access custom_fields" ON public.custom_fields;
DROP POLICY IF EXISTS "Org members access custom_fields" ON public.custom_fields;

CREATE POLICY "custom_fields_select" ON public.custom_fields
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "custom_fields_insert" ON public.custom_fields
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "custom_fields_update" ON public.custom_fields
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "custom_fields_delete" ON public.custom_fields
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );
