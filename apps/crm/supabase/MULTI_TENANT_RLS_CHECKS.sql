-- ============================================================
-- Multi-tenant RLS checks (manual)
-- ------------------------------------------------------------
-- The application-level isolation is validated in
--   apps/crm/src/__tests__/multi-tenant.test.ts
--   apps/crm/src/__tests__/multi-tenant-isolation.test.ts
--
-- Those tests prove that every server action passes the caller's
-- organization_id into every query. They cannot prove that Postgres
-- RLS policies themselves reject cross-org reads, because they run
-- against a chainable mock.
--
-- This file documents SQL checks to run in the Supabase SQL Editor
-- as a periodic smoke test for the DB layer. Run them when:
--   - a new table with organization_id is added
--   - a policy is modified
--   - after upgrading supabase / postgres major
--
-- The checks are read-only and safe to run in production.
-- ============================================================

-- ============================================================
-- 1. RLS is enabled on every tenant-scoped table
-- ============================================================
-- Expected: 0 rows (any table listed here is a gap)

SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'  -- ordinary tables
  AND c.relrowsecurity = false
  AND c.relname IN (
    'leads',
    'conversations',
    'messages',
    'tags',
    'lead_tags',
    'lead_custom_field_values',
    'lead_activities',
    'pipelines',
    'pipeline_stages',
    'deals',
    'organization_members',
    'custom_fields',
    'queues',
    'campaigns',
    'campaign_sends',
    'email_campaigns',
    'email_sends',
    'whatsapp_connections',
    'scheduled_messages',
    'flows',
    'webhooks',
    'tools',
    'integrations'
  );

-- ============================================================
-- 2. Every tenant-scoped table has an organization_id column
-- ============================================================
-- Expected: each table appears once; if a row is missing, that table
-- cannot be enforcing tenant isolation at the schema level.

WITH expected AS (
  SELECT unnest(ARRAY[
    'leads','conversations','messages','tags','lead_tags',
    'lead_custom_field_values','lead_activities','pipelines',
    'pipeline_stages','deals','custom_fields','queues',
    'campaigns','campaign_sends','email_campaigns','email_sends',
    'whatsapp_connections','scheduled_messages','flows','webhooks',
    'tools','integrations'
  ]) AS table_name
)
SELECT e.table_name,
       CASE WHEN c.column_name IS NULL THEN 'MISSING' ELSE c.is_nullable END AS org_id_status
FROM expected e
LEFT JOIN information_schema.columns c
       ON c.table_schema = 'public'
      AND c.table_name = e.table_name
      AND c.column_name = 'organization_id'
ORDER BY e.table_name;

-- ============================================================
-- 3. Canonical helpers exist
-- ============================================================
-- Expected: 3 rows: get_user_org_ids, get_user_org_role, is_superadmin

SELECT p.proname,
       p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_user_org_ids', 'get_user_org_role', 'is_superadmin')
ORDER BY p.proname;

-- ============================================================
-- 4. Policy inventory for core tenant tables
-- ============================================================
-- Skim for suspicious rules. Any policy with `USING (true)` on a
-- tenant-scoped table is an open door.

SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'leads','conversations','messages','tags','lead_tags',
    'deals','pipelines','pipeline_stages','organization_members',
    'campaign_sends','email_sends'
  )
ORDER BY tablename, cmd, policyname;

-- Expected: every `qual` / `with_check` references either
-- get_user_org_role(organization_id), get_user_org_ids(),
-- is_superadmin(auth.uid()) or auth.uid(). Any literal `true` is
-- a regression.

-- ============================================================
-- 5. Cross-org consistency drift
-- ============================================================
-- campaign_sends.organization_id should always equal the parent
-- campaign's organization_id. Non-zero is a data integrity bug —
-- the trigger installed in migration 014 should prevent this.

SELECT COUNT(*) AS drifted_campaign_sends
FROM public.campaign_sends cs
JOIN public.campaigns c ON c.id = cs.campaign_id
WHERE cs.organization_id <> c.organization_id;

SELECT COUNT(*) AS drifted_email_sends
FROM public.email_sends es
JOIN public.email_campaigns ec ON ec.id = es.campaign_id
WHERE es.organization_id <> ec.organization_id;

-- Same check for pipeline_stages vs pipelines — this one can drift
-- today because createStage() does not validate the pipeline owner.
-- Any non-zero row here confirms exploitation of the known bug in
-- apps/crm/src/actions/pipelines.ts:23-32.

SELECT COUNT(*) AS drifted_pipeline_stages
FROM public.pipeline_stages ps
JOIN public.pipelines p ON p.id = ps.pipeline_id
WHERE ps.organization_id <> p.organization_id;

-- ============================================================
-- 6. Live RLS read test (superadmin only, no-op against data)
-- ============================================================
-- Simulates a non-superadmin user belonging only to ORG A trying to
-- read rows from ORG B. Run inside a transaction and roll back.
--
-- Replace <USER_ID_A> with a UUID from organization_members of ORG A.
-- Replace <ORG_B_ID>  with a different organization's id.
--
-- Expected: the SELECT returns 0 rows even though rows exist.

-- BEGIN;
-- SET LOCAL role TO authenticated;
-- SET LOCAL request.jwt.claim.sub TO '<USER_ID_A>';
-- SELECT count(*) FROM public.leads WHERE organization_id = '<ORG_B_ID>';
-- ROLLBACK;

-- If the count is non-zero, RLS is leaking. Treat as P0.
