-- ============================================================
-- Migration 012: admin_audit_log canonical
--
-- Motivacao:
--   1. Tabela foi criada via apps/admin/supabase/migrations/002 — fora
--      do source-of-truth (CRM). Esta migration consolida no caminho
--      canonico e adiciona colunas que faltavam.
--   2. Adiciona observabilidade: result ('success'|'failure'), error_msg,
--      request_id (correlacao com logs Next.js), ip, user_agent.
--   3. Adiciona policy SELECT pra superadmin (hoje so service_role le —
--      bloqueia Realtime do log de auditoria pra debug).
--
-- Idempotencia: CREATE TABLE IF NOT EXISTS + ALTER ADD COLUMN IF NOT EXISTS.
-- Compatibilidade: 100%. Inserts antigos (sem novas colunas) continuam
-- funcionando porque todas as novas colunas sao nullable.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Garante que a tabela existe (safety net — pode ja ter sido
--    criada via apps/admin/migrations/002)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  target_org_id UUID REFERENCES public.organizations(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. Novas colunas (nullable — compat com inserts existentes)
-- ============================================================

ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS result TEXT,
  ADD COLUMN IF NOT EXISTS error_msg TEXT,
  ADD COLUMN IF NOT EXISTS request_id TEXT,
  ADD COLUMN IF NOT EXISTS ip INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- CHECK em result: somente os valores aceitos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'admin_audit_log_result_check'
  ) THEN
    ALTER TABLE public.admin_audit_log
      ADD CONSTRAINT admin_audit_log_result_check
      CHECK (result IS NULL OR result IN ('success', 'failure', 'partial'));
  END IF;
END $$;

-- ============================================================
-- 3. Indexes para queries comuns
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_admin_audit_org
  ON public.admin_audit_log(target_org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_user
  ON public.admin_audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_action
  ON public.admin_audit_log(action, created_at DESC);

-- GIN em metadata pra busca por chaves arbitrarias (debug)
CREATE INDEX IF NOT EXISTS idx_admin_audit_metadata_gin
  ON public.admin_audit_log USING GIN (metadata jsonb_path_ops);

-- request_id pra correlacao com logs (debug de incidente)
CREATE INDEX IF NOT EXISTS idx_admin_audit_request_id
  ON public.admin_audit_log(request_id) WHERE request_id IS NOT NULL;

-- ============================================================
-- 4. RLS
-- ============================================================

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Superadmin pode ler tudo (necessario pra page /audit-log + realtime debug)
DROP POLICY IF EXISTS "Superadmin reads audit_log" ON public.admin_audit_log;
CREATE POLICY "Superadmin reads audit_log" ON public.admin_audit_log
  FOR SELECT USING (public.is_superadmin());

-- INSERT: somente service_role (sem policy = bloqueado pra anon/authenticated)
-- UPDATE/DELETE: nunca — audit log e immutable

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   DROP POLICY IF EXISTS "Superadmin reads audit_log" ON public.admin_audit_log;
--   DROP INDEX IF EXISTS idx_admin_audit_metadata_gin;
--   DROP INDEX IF EXISTS idx_admin_audit_request_id;
--   ALTER TABLE public.admin_audit_log
--     DROP CONSTRAINT IF EXISTS admin_audit_log_result_check,
--     DROP COLUMN IF EXISTS result,
--     DROP COLUMN IF EXISTS error_msg,
--     DROP COLUMN IF EXISTS request_id,
--     DROP COLUMN IF EXISTS ip,
--     DROP COLUMN IF EXISTS user_agent;
--   -- NAO dropar a tabela (em uso)
-- COMMIT;
