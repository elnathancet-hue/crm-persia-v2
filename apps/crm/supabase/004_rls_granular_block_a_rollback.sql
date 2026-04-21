-- ============================================================
-- ROLLBACK: PR 3 Bloco A — Restore FOR ALL policies
-- Run manually if Bloco A causes regressions.
-- Restores the state from after PR 2 (organization_id direct, FOR ALL).
-- ============================================================

-- Drop helper (only if no other block depends on it yet)
-- DROP FUNCTION IF EXISTS public.get_user_org_role(UUID);

-- ============================================================
-- 1. LEADS
-- ============================================================
DROP POLICY IF EXISTS "leads_select" ON public.leads;
DROP POLICY IF EXISTS "leads_insert" ON public.leads;
DROP POLICY IF EXISTS "leads_update" ON public.leads;
DROP POLICY IF EXISTS "leads_delete" ON public.leads;
CREATE POLICY "Org access leads" ON public.leads
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- ============================================================
-- 2. LEAD_TAGS
-- ============================================================
DROP POLICY IF EXISTS "lead_tags_select" ON public.lead_tags;
DROP POLICY IF EXISTS "lead_tags_insert" ON public.lead_tags;
DROP POLICY IF EXISTS "lead_tags_delete" ON public.lead_tags;
CREATE POLICY "Org members access lead_tags" ON public.lead_tags
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- ============================================================
-- 3. LEAD_ACTIVITIES
-- ============================================================
DROP POLICY IF EXISTS "lead_activities_select" ON public.lead_activities;
DROP POLICY IF EXISTS "lead_activities_insert" ON public.lead_activities;
CREATE POLICY "Org access lead_activities" ON public.lead_activities
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- ============================================================
-- 4. LEAD_CUSTOM_FIELD_VALUES
-- ============================================================
DROP POLICY IF EXISTS "lcfv_select" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "lcfv_insert" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "lcfv_update" ON public.lead_custom_field_values;
DROP POLICY IF EXISTS "lcfv_delete" ON public.lead_custom_field_values;
CREATE POLICY "Org members access cf values" ON public.lead_custom_field_values
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- ============================================================
-- 5. CONVERSATIONS
-- ============================================================
DROP POLICY IF EXISTS "conversations_select" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update" ON public.conversations;
CREATE POLICY "Org access conversations" ON public.conversations
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- ============================================================
-- 6. MESSAGES
-- ============================================================
DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_update" ON public.messages;
CREATE POLICY "Org access messages" ON public.messages
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- ============================================================
-- 7. SCHEDULED_MESSAGES
-- ============================================================
DROP POLICY IF EXISTS "scheduled_messages_select" ON public.scheduled_messages;
DROP POLICY IF EXISTS "scheduled_messages_insert" ON public.scheduled_messages;
DROP POLICY IF EXISTS "scheduled_messages_update" ON public.scheduled_messages;
DROP POLICY IF EXISTS "scheduled_messages_delete" ON public.scheduled_messages;
CREATE POLICY "Org access scheduled_messages" ON public.scheduled_messages
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- ============================================================
-- 8. TAGS
-- ============================================================
DROP POLICY IF EXISTS "tags_select" ON public.tags;
DROP POLICY IF EXISTS "tags_insert" ON public.tags;
DROP POLICY IF EXISTS "tags_update" ON public.tags;
DROP POLICY IF EXISTS "tags_delete" ON public.tags;
CREATE POLICY "Org access tags" ON public.tags
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- ============================================================
-- 9. CUSTOM_FIELDS
-- ============================================================
DROP POLICY IF EXISTS "custom_fields_select" ON public.custom_fields;
DROP POLICY IF EXISTS "custom_fields_insert" ON public.custom_fields;
DROP POLICY IF EXISTS "custom_fields_update" ON public.custom_fields;
DROP POLICY IF EXISTS "custom_fields_delete" ON public.custom_fields;
CREATE POLICY "Org access custom_fields" ON public.custom_fields
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));
