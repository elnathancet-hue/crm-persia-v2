-- ============================================================
-- PR 3 BLOCO B: RLS granular por role
-- Tabelas: deals, pipelines, pipeline_stages, flows, flow_executions,
--          campaigns, campaign_sends, email_campaigns, email_sends,
--          email_templates, ai_assistants, ai_knowledge_base,
--          webhooks, integrations
-- Depends on: get_user_org_role(p_org_id) from migration 004
-- ============================================================

-- ============================================================
-- 1. DEALS
-- SELECT: agent+  |  INSERT: agent+  |  UPDATE: agent+  |  DELETE: agent+
-- ============================================================

DROP POLICY IF EXISTS "Org access deals" ON public.deals;
DROP POLICY IF EXISTS "Org members access deals" ON public.deals;

CREATE POLICY "deals_select" ON public.deals
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "deals_insert" ON public.deals
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "deals_update" ON public.deals
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));

CREATE POLICY "deals_delete" ON public.deals
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

-- ============================================================
-- 2. PIPELINES
-- SELECT: agent+  |  INSERT: admin+  |  UPDATE: admin+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org access pipelines" ON public.pipelines;
DROP POLICY IF EXISTS "Org members access pipelines" ON public.pipelines;

CREATE POLICY "pipelines_select" ON public.pipelines
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "pipelines_insert" ON public.pipelines
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "pipelines_update" ON public.pipelines
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "pipelines_delete" ON public.pipelines
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 3. PIPELINE_STAGES
-- SELECT: agent+  |  INSERT: admin+  |  UPDATE: admin+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org members access stages" ON public.pipeline_stages;
DROP POLICY IF EXISTS "Org access stages" ON public.pipeline_stages;

CREATE POLICY "pipeline_stages_select" ON public.pipeline_stages
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY "pipeline_stages_insert" ON public.pipeline_stages
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "pipeline_stages_update" ON public.pipeline_stages
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "pipeline_stages_delete" ON public.pipeline_stages
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 4. FLOWS
-- SELECT: admin+  |  INSERT: admin+  |  UPDATE: admin+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org access flows" ON public.flows;
DROP POLICY IF EXISTS "Org members access flows" ON public.flows;

CREATE POLICY "flows_select" ON public.flows
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "flows_insert" ON public.flows
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "flows_update" ON public.flows
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "flows_delete" ON public.flows
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 5. FLOW_EXECUTIONS
-- SELECT: admin+  |  INSERT: admin+  |  DELETE: admin+  |  UPDATE: none
-- (Execution logs: system inserts via service_role, admin reads/cleans)
-- ============================================================

DROP POLICY IF EXISTS "Org access flow_executions" ON public.flow_executions;
DROP POLICY IF EXISTS "Org members access flow_executions" ON public.flow_executions;

CREATE POLICY "flow_executions_select" ON public.flow_executions
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "flow_executions_insert" ON public.flow_executions
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "flow_executions_delete" ON public.flow_executions
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- No UPDATE policy — executions are immutable log records

-- ============================================================
-- 6. CAMPAIGNS
-- SELECT: admin+  |  INSERT: admin+  |  UPDATE: admin+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org access campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "Org members access campaigns" ON public.campaigns;

CREATE POLICY "campaigns_select" ON public.campaigns
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "campaigns_insert" ON public.campaigns
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "campaigns_update" ON public.campaigns
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "campaigns_delete" ON public.campaigns
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 7. CAMPAIGN_SENDS (no organization_id ��� join-based via campaigns)
-- SELECT: admin+  |  INSERT: admin+ (system inserts via service_role)
-- No UPDATE/DELETE — send logs are immutable
-- ============================================================

DROP POLICY IF EXISTS "Org access campaign_sends" ON public.campaign_sends;

CREATE POLICY "campaign_sends_select" ON public.campaign_sends
  FOR SELECT USING (
    campaign_id IN (
      SELECT id FROM public.campaigns
      WHERE get_user_org_role(organization_id) IN ('owner', 'admin')
    )
  );

CREATE POLICY "campaign_sends_insert" ON public.campaign_sends
  FOR INSERT WITH CHECK (
    campaign_id IN (
      SELECT id FROM public.campaigns
      WHERE get_user_org_role(organization_id) IN ('owner', 'admin')
    )
  );

-- ============================================================
-- 8. EMAIL_CAMPAIGNS
-- SELECT: admin+  |  INSERT: admin+  |  UPDATE: admin+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org access email_campaigns" ON public.email_campaigns;
DROP POLICY IF EXISTS "Org members access email_campaigns" ON public.email_campaigns;

CREATE POLICY "email_campaigns_select" ON public.email_campaigns
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "email_campaigns_insert" ON public.email_campaigns
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "email_campaigns_update" ON public.email_campaigns
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "email_campaigns_delete" ON public.email_campaigns
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 9. EMAIL_SENDS (no organization_id — join-based via email_campaigns)
-- SELECT: admin+  |  INSERT: admin+ (system inserts via service_role)
-- No UPDATE/DELETE — send logs are immutable
-- ============================================================

DROP POLICY IF EXISTS "Org access email_sends" ON public.email_sends;

CREATE POLICY "email_sends_select" ON public.email_sends
  FOR SELECT USING (
    campaign_id IN (
      SELECT id FROM public.email_campaigns
      WHERE get_user_org_role(organization_id) IN ('owner', 'admin')
    )
  );

CREATE POLICY "email_sends_insert" ON public.email_sends
  FOR INSERT WITH CHECK (
    campaign_id IN (
      SELECT id FROM public.email_campaigns
      WHERE get_user_org_role(organization_id) IN ('owner', 'admin')
    )
  );

-- ============================================================
-- 10. EMAIL_TEMPLATES
-- SELECT: admin+  |  INSERT: admin+  |  UPDATE: admin+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org access email_templates" ON public.email_templates;
DROP POLICY IF EXISTS "Org members access email_templates" ON public.email_templates;

CREATE POLICY "email_templates_select" ON public.email_templates
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "email_templates_insert" ON public.email_templates
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "email_templates_update" ON public.email_templates
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "email_templates_delete" ON public.email_templates
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 11. AI_ASSISTANTS
-- SELECT: admin+  |  INSERT: admin+  |  UPDATE: admin+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org access ai_assistants" ON public.ai_assistants;
DROP POLICY IF EXISTS "Org members access ai_assistants" ON public.ai_assistants;

CREATE POLICY "ai_assistants_select" ON public.ai_assistants
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "ai_assistants_insert" ON public.ai_assistants
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "ai_assistants_update" ON public.ai_assistants
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "ai_assistants_delete" ON public.ai_assistants
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 12. AI_KNOWLEDGE_BASE
-- SELECT: admin+  |  INSERT: admin+  |  UPDATE: admin+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org access ai_knowledge_base" ON public.ai_knowledge_base;
DROP POLICY IF EXISTS "Org members access ai_kb" ON public.ai_knowledge_base;

CREATE POLICY "ai_kb_select" ON public.ai_knowledge_base
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "ai_kb_insert" ON public.ai_knowledge_base
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "ai_kb_update" ON public.ai_knowledge_base
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "ai_kb_delete" ON public.ai_knowledge_base
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 13. WEBHOOKS
-- SELECT: admin+  |  INSERT: admin+  |  UPDATE: admin+  |  DELETE: admin+
-- ============================================================

DROP POLICY IF EXISTS "Org access webhooks" ON public.webhooks;
DROP POLICY IF EXISTS "Org members access webhooks" ON public.webhooks;

CREATE POLICY "webhooks_select" ON public.webhooks
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "webhooks_insert" ON public.webhooks
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "webhooks_update" ON public.webhooks
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

CREATE POLICY "webhooks_delete" ON public.webhooks
  FOR DELETE USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

-- ============================================================
-- 14. INTEGRATIONS
-- SELECT: admin+  |  INSERT: admin+  |  UPDATE: admin+  |  DELETE: none
-- (Integrations are deactivated, not deleted)
-- ============================================================

DROP POLICY IF EXISTS "Org access integrations" ON public.integrations;
DROP POLICY IF EXISTS "Org members access integrations" ON public.integrations;

CREATE POLICY "integrations_select" ON public.integrations
  FOR SELECT USING (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "integrations_insert" ON public.integrations
  FOR INSERT WITH CHECK (
    get_user_org_role(organization_id) IN ('owner', 'admin')
  );

CREATE POLICY "integrations_update" ON public.integrations
  FOR UPDATE
  USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));

-- No DELETE policy — integrations are deactivated via is_active flag, not deleted
