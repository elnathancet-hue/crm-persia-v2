-- ============================================================
-- MIGRATION 036: Profiles visibility entre membros da mesma org
-- (PR-L1 ASSIGNEES-HARDENING)
-- ------------------------------------------------------------
-- BUG CORRIGIDO:
--   A policy original "Users manage own profile" (migration 001:679)
--   so permite que cada user veja/edite SEU PROPRIO profile
--   (id = auth.uid()). Quando a UI tenta carregar profiles de
--   outros membros da mesma org pra renderizar dropdown "Atribuir
--   responsavel" (PR-C card connections + futuras LeadsList
--   colunas — PR-L), RLS bloqueia silenciosamente.
--
--   Resultado em prod: agente ve apenas seu proprio nome no dropdown
--   de assignees. Outros membros da org nao aparecem. O code defensivo
--   em /crm/page.tsx (try/catch + fallback []) escondia o erro.
--
-- SOLUCAO:
--   Adiciona policy "Members read profiles of same org" — permite
--   SELECT em profiles cujo `id` (= auth.users.id) seja user_id de
--   algum organization_members na MESMA org do caller.
--
-- MULTI-TENANT (defesa em camadas):
--   - get_user_org_ids() retorna so as orgs onde o caller e membro
--     ATIVO (is_active=true) — verificado em organization_members
--   - Cross-org NAO vaza: profile de user de outra org permanece
--     bloqueado pra este caller (so superadmin via policy 011 le tudo)
--
-- IDEMPOTENTE: usa DROP POLICY IF EXISTS antes de CREATE
-- (compativel com retry / re-run em prod via SQL Editor)
-- ============================================================

-- 1. Garante que a function helper existe (defesa — ja deve existir
--    desde migration 001). Re-create idempotente.
--    OBS: NAO redefinimos aqui pra nao colidir com versoes futuras.
--    Se nao existir, este migration falha — sinal de problema bigger.

-- 2. Policy nova: membros leem profiles de outros membros da mesma org
DROP POLICY IF EXISTS "Members read profiles of same org" ON public.profiles;

CREATE POLICY "Members read profiles of same org" ON public.profiles
  FOR SELECT
  USING (
    -- profile.id e auth.users.id (FK em profiles.id REFERENCES auth.users)
    -- Permite SELECT se o profile.id pertence a algum membro de uma org
    -- onde o caller (auth.uid()) tambem e membro ativo.
    id IN (
      SELECT user_id
      FROM public.organization_members
      WHERE organization_id IN (SELECT public.get_user_org_ids())
    )
  );

COMMENT ON POLICY "Members read profiles of same org" ON public.profiles IS
  'PR-L1: permite que membros de uma org leiam profiles de outros membros da MESMA org. Necessario pra dropdowns de atribuir responsavel (PR-C + PR-L). Multi-tenant preservado: cross-org nao vaza.';

-- 3. Verificacao (manual) — apos rodar em prod, conferir:
--    SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.profiles'::regclass;
--    Resultado esperado: 3 policies (Users manage own / Superadmin reads all / Members read profiles of same org)

-- ============================================================
-- ROLLBACK MANUAL (se precisar reverter):
-- DROP POLICY IF EXISTS "Members read profiles of same org" ON public.profiles;
-- ============================================================
