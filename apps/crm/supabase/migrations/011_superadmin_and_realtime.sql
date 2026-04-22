-- ============================================================
-- Migration 011: Superadmin canonical + realtime admin policies
--
-- Motivacao:
--   1. profiles.is_superadmin existe em prod mas foi adicionada via
--      Dashboard sem migration oficial. Esta migration e o source-of-truth.
--   2. Admin panel usa anon key + user session pra realtime
--      (apps/admin/src/lib/supabase.ts:22). Sem RLS permissiva pra
--      superadmin, INSERT/UPDATE em messages/conversations/etc nao
--      propagam (silent break).
--   3. Centraliza o helper SQL is_superadmin(uuid) — usado por todas as
--      policies daqui pra frente, evita duplicar predicate.
--
-- IMPORTANTE — overload em vez de substituicao:
--   Pode existir uma is_superadmin() (sem args) historica criada via
--   Dashboard. Esta migration NAO toca nela: cria apenas a sobrecarga
--   is_superadmin(p_user_id uuid). As policies daqui invocam
--   explicitamente is_superadmin(auth.uid()), evitando ambiguidade
--   (ERROR 42725: function is_superadmin() is not unique).
--
-- Idempotencia: todos os blocos sao re-runnable. Se rodar em prod onde
-- a coluna ja existe e as policies ja estao configuradas, nada quebra.
--
-- Rollback: ver bloco no fim do arquivo (comentado).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. profiles.is_superadmin (canonical)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'is_superadmin'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN is_superadmin BOOLEAN NOT NULL DEFAULT false;
  ELSE
    -- Coluna ja existe (Dashboard). Garante NOT NULL + DEFAULT.
    -- NULLs sao tratados como false antes do SET NOT NULL.
    UPDATE public.profiles SET is_superadmin = false WHERE is_superadmin IS NULL;

    BEGIN
      ALTER TABLE public.profiles ALTER COLUMN is_superadmin SET DEFAULT false;
    EXCEPTION WHEN others THEN
      -- ja tem default — segue
      NULL;
    END;

    BEGIN
      ALTER TABLE public.profiles ALTER COLUMN is_superadmin SET NOT NULL;
    EXCEPTION WHEN others THEN
      -- ja e NOT NULL — segue
      NULL;
    END;
  END IF;
END $$;

-- Index parcial: superadmins sao raros, mas getSuperadmins() lista todos
CREATE INDEX IF NOT EXISTS idx_profiles_is_superadmin
  ON public.profiles (id) WHERE is_superadmin = true;

-- ============================================================
-- 2. SQL helper: is_superadmin(uuid)
--
--    SECURITY DEFINER pra ser chamavel em policies sem precisar de
--    SELECT direto em profiles (que tem propria RLS).
--    STABLE pra cache dentro do mesmo statement.
--
--    NAO usa DEFAULT auth.uid() porque uma is_superadmin() sem args
--    pode existir historicamente — DEFAULT criaria ambiguidade
--    (PostgreSQL ERROR 42725). As policies abaixo passam auth.uid()
--    explicitamente.
-- ============================================================

-- Limpeza de tentativa anterior (se houver — transacao falhada deixa
-- estado intermediario quando rodada fora de psql interativo).
DROP FUNCTION IF EXISTS public.is_superadmin(uuid);

CREATE FUNCTION public.is_superadmin(p_user_id uuid)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT is_superadmin FROM public.profiles WHERE id = p_user_id),
    false
  );
$$;

COMMENT ON FUNCTION public.is_superadmin(uuid) IS
  'Returns true if the given user is a superadmin. Pass auth.uid() in RLS policies.';

-- Permissoes: authenticated pode chamar (a funcao em si checa profiles)
GRANT EXECUTE ON FUNCTION public.is_superadmin(uuid) TO authenticated;

-- ============================================================
-- 3. profiles RLS: superadmin ve todos os profiles (necessario pra
--    /settings/admin/page e getSuperadmins())
-- ============================================================

DROP POLICY IF EXISTS "Superadmin reads all profiles" ON public.profiles;
CREATE POLICY "Superadmin reads all profiles" ON public.profiles
  FOR SELECT
  USING (public.is_superadmin(auth.uid()));

-- ============================================================
-- 4. RLS: superadmin SELECT permissivo nas tabelas que o admin
--    panel escuta via realtime (anon client + user session)
--
--    Estrategia: ADD policy NOVA sem dropar existentes. PostgreSQL
--    aplica OR entre policies do mesmo comando — entao membros normais
--    continuam vendo via policy de org, e superadmin ve tudo.
-- ============================================================

-- messages
DROP POLICY IF EXISTS "Superadmin reads all messages" ON public.messages;
CREATE POLICY "Superadmin reads all messages" ON public.messages
  FOR SELECT USING (public.is_superadmin(auth.uid()));

-- conversations
DROP POLICY IF EXISTS "Superadmin reads all conversations" ON public.conversations;
CREATE POLICY "Superadmin reads all conversations" ON public.conversations
  FOR SELECT USING (public.is_superadmin(auth.uid()));

-- leads
DROP POLICY IF EXISTS "Superadmin reads all leads" ON public.leads;
CREATE POLICY "Superadmin reads all leads" ON public.leads
  FOR SELECT USING (public.is_superadmin(auth.uid()));

-- deals (escutado pelo Kanban admin)
DROP POLICY IF EXISTS "Superadmin reads all deals" ON public.deals;
CREATE POLICY "Superadmin reads all deals" ON public.deals
  FOR SELECT USING (public.is_superadmin(auth.uid()));

-- organizations (admin lista todas)
DROP POLICY IF EXISTS "Superadmin reads all organizations" ON public.organizations;
CREATE POLICY "Superadmin reads all organizations" ON public.organizations
  FOR SELECT USING (public.is_superadmin(auth.uid()));

-- organization_members (admin Kanban + getTeamMembers cross-org)
DROP POLICY IF EXISTS "Superadmin reads all organization_members" ON public.organization_members;
CREATE POLICY "Superadmin reads all organization_members" ON public.organization_members
  FOR SELECT USING (public.is_superadmin(auth.uid()));

-- whatsapp_connections (admin lista status de todas as instancias)
DROP POLICY IF EXISTS "Superadmin reads all whatsapp_connections" ON public.whatsapp_connections;
CREATE POLICY "Superadmin reads all whatsapp_connections" ON public.whatsapp_connections
  FOR SELECT USING (public.is_superadmin(auth.uid()));

COMMIT;

-- ============================================================
-- Rollback (manual, comentado):
-- ============================================================
-- BEGIN;
--   DROP POLICY IF EXISTS "Superadmin reads all profiles" ON public.profiles;
--   DROP POLICY IF EXISTS "Superadmin reads all messages" ON public.messages;
--   DROP POLICY IF EXISTS "Superadmin reads all conversations" ON public.conversations;
--   DROP POLICY IF EXISTS "Superadmin reads all leads" ON public.leads;
--   DROP POLICY IF EXISTS "Superadmin reads all deals" ON public.deals;
--   DROP POLICY IF EXISTS "Superadmin reads all organizations" ON public.organizations;
--   DROP POLICY IF EXISTS "Superadmin reads all organization_members" ON public.organization_members;
--   DROP POLICY IF EXISTS "Superadmin reads all whatsapp_connections" ON public.whatsapp_connections;
--   DROP FUNCTION IF EXISTS public.is_superadmin(uuid);
--   DROP INDEX IF EXISTS idx_profiles_is_superadmin;
--   -- NAO dropar is_superadmin() sem args (pode ser usada por outras policies)
--   -- NAO dropar profiles.is_superadmin (em uso desde sempre)
-- COMMIT;
