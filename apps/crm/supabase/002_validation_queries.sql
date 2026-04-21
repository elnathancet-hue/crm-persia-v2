-- ============================================================
-- VALIDATION QUERIES — Run AFTER Migration A + code deploy
-- Do NOT run as a migration. Run manually in Supabase SQL Editor.
-- All queries must return 0 rows for Migration B to be safe.
-- ============================================================

-- ============================================================
-- CHECK 1: NULLs remaining (must be 0 for each)
-- ============================================================

SELECT 'pipeline_stages' AS table_name, COUNT(*) AS null_count
FROM public.pipeline_stages WHERE organization_id IS NULL
UNION ALL
SELECT 'lead_tags', COUNT(*)
FROM public.lead_tags WHERE organization_id IS NULL
UNION ALL
SELECT 'lead_custom_field_values', COUNT(*)
FROM public.lead_custom_field_values WHERE organization_id IS NULL
UNION ALL
SELECT 'queue_members', COUNT(*)
FROM public.queue_members WHERE organization_id IS NULL;

-- ============================================================
-- CHECK 2: Inconsistency between child and parent org_id
-- (child.organization_id != parent.organization_id)
-- Must return 0 rows for each.
-- ============================================================

-- pipeline_stages vs pipelines
SELECT 'pipeline_stages ↔ pipelines' AS check_name, ps.id AS child_id, ps.organization_id AS child_org, p.organization_id AS parent_org
FROM public.pipeline_stages ps
JOIN public.pipelines p ON ps.pipeline_id = p.id
WHERE ps.organization_id IS DISTINCT FROM p.organization_id;

-- lead_tags vs leads
SELECT 'lead_tags ↔ leads' AS check_name, lt.lead_id AS child_id, lt.organization_id AS child_org, l.organization_id AS parent_org
FROM public.lead_tags lt
JOIN public.leads l ON lt.lead_id = l.id
WHERE lt.organization_id IS DISTINCT FROM l.organization_id;

-- lead_tags vs tags (cross-check: tag should belong to same org as lead)
SELECT 'lead_tags ↔ tags' AS check_name, lt.lead_id, lt.tag_id, lt.organization_id AS lt_org, t.organization_id AS tag_org
FROM public.lead_tags lt
JOIN public.tags t ON lt.tag_id = t.id
WHERE lt.organization_id IS DISTINCT FROM t.organization_id;

-- lead_custom_field_values vs leads
SELECT 'lcfv ↔ leads' AS check_name, lcfv.id AS child_id, lcfv.organization_id AS child_org, l.organization_id AS parent_org
FROM public.lead_custom_field_values lcfv
JOIN public.leads l ON lcfv.lead_id = l.id
WHERE lcfv.organization_id IS DISTINCT FROM l.organization_id;

-- lead_custom_field_values vs custom_fields
SELECT 'lcfv ↔ custom_fields' AS check_name, lcfv.id AS child_id, lcfv.organization_id AS child_org, cf.organization_id AS parent_org
FROM public.lead_custom_field_values lcfv
JOIN public.custom_fields cf ON lcfv.custom_field_id = cf.id
WHERE lcfv.organization_id IS DISTINCT FROM cf.organization_id;

-- queue_members vs queues
SELECT 'queue_members ↔ queues' AS check_name, qm.queue_id AS child_id, qm.organization_id AS child_org, q.organization_id AS parent_org
FROM public.queue_members qm
JOIN public.queues q ON qm.queue_id = q.id
WHERE qm.organization_id IS DISTINCT FROM q.organization_id;

-- ============================================================
-- CHECK 3: Orphaned rows (child has FK to parent that doesn't exist)
-- Should return 0 — FK constraints should prevent this, but verify.
-- ============================================================

SELECT 'orphan pipeline_stages' AS check_name, COUNT(*)
FROM public.pipeline_stages ps
LEFT JOIN public.pipelines p ON ps.pipeline_id = p.id
WHERE p.id IS NULL;

SELECT 'orphan lead_tags (leads)' AS check_name, COUNT(*)
FROM public.lead_tags lt
LEFT JOIN public.leads l ON lt.lead_id = l.id
WHERE l.id IS NULL;

SELECT 'orphan lead_tags (tags)' AS check_name, COUNT(*)
FROM public.lead_tags lt
LEFT JOIN public.tags t ON lt.tag_id = t.id
WHERE t.id IS NULL;

SELECT 'orphan lcfv (leads)' AS check_name, COUNT(*)
FROM public.lead_custom_field_values lcfv
LEFT JOIN public.leads l ON lcfv.lead_id = l.id
WHERE l.id IS NULL;

SELECT 'orphan queue_members' AS check_name, COUNT(*)
FROM public.queue_members qm
LEFT JOIN public.queues q ON qm.queue_id = q.id
WHERE q.id IS NULL;

-- ============================================================
-- CHECK 4: Row counts (informational — verify numbers make sense)
-- ============================================================

SELECT 'pipeline_stages' AS table_name, COUNT(*) AS total, COUNT(organization_id) AS with_org FROM public.pipeline_stages
UNION ALL
SELECT 'lead_tags', COUNT(*), COUNT(organization_id) FROM public.lead_tags
UNION ALL
SELECT 'lead_custom_field_values', COUNT(*), COUNT(organization_id) FROM public.lead_custom_field_values
UNION ALL
SELECT 'queue_members', COUNT(*), COUNT(organization_id) FROM public.queue_members;
