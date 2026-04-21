-- Migration: Unique constraint on leads(organization_id, phone)
-- Motivation: prevents duplicate leads when multiple webhooks fire for the
-- same phone within the dedup window, or when agents manually create a lead
-- that already arrived via webhook. Incoming pipeline (incoming-pipeline.ts)
-- already does find-or-create, but admin's createLead + campaigns import
-- lacked the DB-level guarantee.
--
-- Allows NULL phones (inbox-only leads without a number).
--
-- Safety: pre-flight counts duplicates and aborts if any exist (current
-- production audit on 2026-04-20 showed 0 dups across 5 rows, but the
-- guard is kept for re-run safety).

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT organization_id, phone
    FROM leads
    WHERE phone IS NOT NULL
    GROUP BY organization_id, phone
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot add UNIQUE constraint: % (org_id, phone) pairs have duplicates. Merge first.', dup_count;
  END IF;
END $$;

-- Partial unique index: NULL phone allowed multiple times, non-NULL must be unique per org.
CREATE UNIQUE INDEX leads_org_phone_unique ON leads (organization_id, phone)
  WHERE phone IS NOT NULL;

-- Rollback:
-- DROP INDEX leads_org_phone_unique;
