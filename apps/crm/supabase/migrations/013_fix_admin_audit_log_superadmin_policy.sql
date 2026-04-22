-- ============================================================
-- Migration 013: admin_audit_log policy uses canonical is_superadmin(uuid)
--
-- Motivation:
--   Migration 012 created the audit-log SELECT policy with
--   public.is_superadmin() (no args). That works in production because a
--   historical Dashboard-created helper exists there, but a clean database
--   built only from migrations has the canonical helper introduced in 011:
--   public.is_superadmin(p_user_id uuid).
--
-- This migration makes the schema reproducible by using the canonical
-- overload explicitly, matching the superadmin realtime policies in 011.
--
-- Compatibility:
--   Runtime behavior is unchanged: authenticated superadmins can SELECT
--   audit rows; non-superadmins cannot. INSERT remains service_role-only
--   because no INSERT policy is added.
-- ============================================================

BEGIN;

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmin reads audit_log" ON public.admin_audit_log;
CREATE POLICY "Superadmin reads audit_log" ON public.admin_audit_log
  FOR SELECT USING (public.is_superadmin(auth.uid()));

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   DROP POLICY IF EXISTS "Superadmin reads audit_log" ON public.admin_audit_log;
--   CREATE POLICY "Superadmin reads audit_log" ON public.admin_audit_log
--     FOR SELECT USING (public.is_superadmin());
-- COMMIT;
