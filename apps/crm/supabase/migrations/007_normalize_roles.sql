-- Migration 007: Normalize legacy roles to canonical set
-- Canonical roles: owner, admin, agent, viewer
-- Mapping: gestor -> agent, usuario -> agent
--
-- This is idempotent — safe to run multiple times.

BEGIN;

-- Convert legacy roles
UPDATE public.organization_members
SET role = 'agent'
WHERE role IN ('gestor', 'usuario');

-- Add a CHECK constraint to prevent future legacy roles
-- (only if constraint doesn't already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organization_members_role_check'
  ) THEN
    ALTER TABLE public.organization_members
    ADD CONSTRAINT organization_members_role_check
    CHECK (role IN ('owner', 'admin', 'agent', 'viewer'));
  END IF;
END $$;

COMMIT;
