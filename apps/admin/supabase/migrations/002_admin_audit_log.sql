-- ============================================================
-- PR 4A: Admin audit log
-- Tracks all superadmin actions with org context
-- Accessed only via service_role (admin panel bypasses RLS)
-- ============================================================

CREATE TABLE public.admin_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  target_org_id UUID REFERENCES public.organizations(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_admin_audit_org ON public.admin_audit_log(target_org_id, created_at DESC);
CREATE INDEX idx_admin_audit_user ON public.admin_audit_log(user_id, created_at DESC);
CREATE INDEX idx_admin_audit_action ON public.admin_audit_log(action, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies: table accessed only via service_role
