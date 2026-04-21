-- ============================================================
-- ROLLBACK: PR 3 Bloco B — Restore FOR ALL policies
-- Restores state from after PR 2 (org_id direct, FOR ALL).
-- ============================================================

-- 1. DEALS
DROP POLICY IF EXISTS "deals_select" ON public.deals;
DROP POLICY IF EXISTS "deals_insert" ON public.deals;
DROP POLICY IF EXISTS "deals_update" ON public.deals;
DROP POLICY IF EXISTS "deals_delete" ON public.deals;
CREATE POLICY "Org access deals" ON public.deals
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 2. PIPELINES
DROP POLICY IF EXISTS "pipelines_select" ON public.pipelines;
DROP POLICY IF EXISTS "pipelines_insert" ON public.pipelines;
DROP POLICY IF EXISTS "pipelines_update" ON public.pipelines;
DROP POLICY IF EXISTS "pipelines_delete" ON public.pipelines;
CREATE POLICY "Org access pipelines" ON public.pipelines
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 3. PIPELINE_STAGES
DROP POLICY IF EXISTS "pipeline_stages_select" ON public.pipeline_stages;
DROP POLICY IF EXISTS "pipeline_stages_insert" ON public.pipeline_stages;
DROP POLICY IF EXISTS "pipeline_stages_update" ON public.pipeline_stages;
DROP POLICY IF EXISTS "pipeline_stages_delete" ON public.pipeline_stages;
CREATE POLICY "Org members access stages" ON public.pipeline_stages
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 4. FLOWS
DROP POLICY IF EXISTS "flows_select" ON public.flows;
DROP POLICY IF EXISTS "flows_insert" ON public.flows;
DROP POLICY IF EXISTS "flows_update" ON public.flows;
DROP POLICY IF EXISTS "flows_delete" ON public.flows;
CREATE POLICY "Org access flows" ON public.flows
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 5. FLOW_EXECUTIONS
DROP POLICY IF EXISTS "flow_executions_select" ON public.flow_executions;
DROP POLICY IF EXISTS "flow_executions_insert" ON public.flow_executions;
DROP POLICY IF EXISTS "flow_executions_delete" ON public.flow_executions;
CREATE POLICY "Org access flow_executions" ON public.flow_executions
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 6. CAMPAIGNS
DROP POLICY IF EXISTS "campaigns_select" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_insert" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_update" ON public.campaigns;
DROP POLICY IF EXISTS "campaigns_delete" ON public.campaigns;
CREATE POLICY "Org access campaigns" ON public.campaigns
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 7. CAMPAIGN_SENDS
DROP POLICY IF EXISTS "campaign_sends_select" ON public.campaign_sends;
DROP POLICY IF EXISTS "campaign_sends_insert" ON public.campaign_sends;
CREATE POLICY "Org access campaign_sends" ON public.campaign_sends
  FOR ALL USING (campaign_id IN (SELECT id FROM public.campaigns WHERE organization_id IN (SELECT get_user_org_ids())));

-- 8. EMAIL_CAMPAIGNS
DROP POLICY IF EXISTS "email_campaigns_select" ON public.email_campaigns;
DROP POLICY IF EXISTS "email_campaigns_insert" ON public.email_campaigns;
DROP POLICY IF EXISTS "email_campaigns_update" ON public.email_campaigns;
DROP POLICY IF EXISTS "email_campaigns_delete" ON public.email_campaigns;
CREATE POLICY "Org access email_campaigns" ON public.email_campaigns
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 9. EMAIL_SENDS
DROP POLICY IF EXISTS "email_sends_select" ON public.email_sends;
DROP POLICY IF EXISTS "email_sends_insert" ON public.email_sends;
CREATE POLICY "Org access email_sends" ON public.email_sends
  FOR ALL USING (campaign_id IN (SELECT id FROM public.email_campaigns WHERE organization_id IN (SELECT get_user_org_ids())));

-- 10. EMAIL_TEMPLATES
DROP POLICY IF EXISTS "email_templates_select" ON public.email_templates;
DROP POLICY IF EXISTS "email_templates_insert" ON public.email_templates;
DROP POLICY IF EXISTS "email_templates_update" ON public.email_templates;
DROP POLICY IF EXISTS "email_templates_delete" ON public.email_templates;
CREATE POLICY "Org access email_templates" ON public.email_templates
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 11. AI_ASSISTANTS
DROP POLICY IF EXISTS "ai_assistants_select" ON public.ai_assistants;
DROP POLICY IF EXISTS "ai_assistants_insert" ON public.ai_assistants;
DROP POLICY IF EXISTS "ai_assistants_update" ON public.ai_assistants;
DROP POLICY IF EXISTS "ai_assistants_delete" ON public.ai_assistants;
CREATE POLICY "Org access ai_assistants" ON public.ai_assistants
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 12. AI_KNOWLEDGE_BASE
DROP POLICY IF EXISTS "ai_kb_select" ON public.ai_knowledge_base;
DROP POLICY IF EXISTS "ai_kb_insert" ON public.ai_knowledge_base;
DROP POLICY IF EXISTS "ai_kb_update" ON public.ai_knowledge_base;
DROP POLICY IF EXISTS "ai_kb_delete" ON public.ai_knowledge_base;
CREATE POLICY "Org access ai_knowledge_base" ON public.ai_knowledge_base
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 13. WEBHOOKS
DROP POLICY IF EXISTS "webhooks_select" ON public.webhooks;
DROP POLICY IF EXISTS "webhooks_insert" ON public.webhooks;
DROP POLICY IF EXISTS "webhooks_update" ON public.webhooks;
DROP POLICY IF EXISTS "webhooks_delete" ON public.webhooks;
CREATE POLICY "Org access webhooks" ON public.webhooks
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));

-- 14. INTEGRATIONS
DROP POLICY IF EXISTS "integrations_select" ON public.integrations;
DROP POLICY IF EXISTS "integrations_insert" ON public.integrations;
DROP POLICY IF EXISTS "integrations_update" ON public.integrations;
CREATE POLICY "Org access integrations" ON public.integrations
  FOR ALL USING (organization_id IN (SELECT get_user_org_ids()));
