-- Migration 098: Performance indexes
-- Identified in performance audit (jun/2026).
--
-- 1. whatsapp_connections(status, provider)
--    Every inbound WhatsApp webhook does:
--      SELECT ... FROM whatsapp_connections WHERE status='connected' AND provider='uazapi'
--    Without a composite index this is a full table scan on the hottest path in the system.
--    Partial index (WHERE status='connected') skips disconnected rows entirely.
--
-- 2. organization_members(user_id, organization_id, is_active)
--    RLS helper get_user_org_role() is called once per row for every SELECT on
--    leads, messages, conversations, etc.  It does:
--      SELECT role FROM organization_members WHERE user_id=? AND organization_id=? AND is_active=true
--    Two separate single-column indexes exist but the query needs the composite.

CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_status_provider
  ON public.whatsapp_connections(status, provider)
  WHERE status = 'connected';

CREATE INDEX IF NOT EXISTS idx_org_members_user_org_active
  ON public.organization_members(user_id, organization_id, is_active);
