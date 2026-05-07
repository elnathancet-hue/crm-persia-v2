-- ============================================================
-- MIGRATION 037: lead_comments — comentarios threaded simples (PR-M)
-- ------------------------------------------------------------
-- Atendimento colaborativo entre agentes:
--   - Cada agente pode comentar num lead
--   - Comentarios sao visiveis pra todos da MESMA org
--   - So o autor pode editar/deletar seu proprio comentario
--   - @mencao a outro agente e parsing client-side (texto livre)
--
-- ESCOPO DELIBERADAMENTE PEQUENO (cortes em PR-M):
--   - Flat (sem parent_id / threaded replies — Slack-style)
--   - Sem markdown / anexos (texto plano + emoji nativo)
--   - Sem push notification (vira PR proprio com infra de dispatcher)
--   - Sem autocomplete @ (parser client-side simples)
--
-- IDEMPOTENTE: usa CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

-- 1. Tabela
CREATE TABLE IF NOT EXISTS public.lead_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes — query principal e por lead_id ordenado
CREATE INDEX IF NOT EXISTS idx_lead_comments_lead
  ON public.lead_comments (lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_comments_org
  ON public.lead_comments (organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_comments_author
  ON public.lead_comments (author_id);

-- 3. Trigger updated_at (reusa funcao existente do schema 001)
DROP TRIGGER IF EXISTS set_updated_at ON public.lead_comments;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.lead_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- 4. RLS — multi-tenant em camadas
ALTER TABLE public.lead_comments ENABLE ROW LEVEL SECURITY;

-- Policy SELECT: membros da mesma org leem todos os comentarios
DROP POLICY IF EXISTS "Members read lead_comments same org" ON public.lead_comments;
CREATE POLICY "Members read lead_comments same org" ON public.lead_comments
  FOR SELECT
  USING (organization_id IN (SELECT public.get_user_org_ids()));

-- Policy INSERT: membros da mesma org criam comentarios
-- (author_id deve ser o proprio caller — defesa contra spoofing)
DROP POLICY IF EXISTS "Members insert lead_comments same org" ON public.lead_comments;
CREATE POLICY "Members insert lead_comments same org" ON public.lead_comments
  FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.get_user_org_ids())
    AND author_id = auth.uid()
  );

-- Policy UPDATE: SO o autor pode editar seu proprio comentario
DROP POLICY IF EXISTS "Author updates own lead_comment" ON public.lead_comments;
CREATE POLICY "Author updates own lead_comment" ON public.lead_comments
  FOR UPDATE
  USING (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- Policy DELETE: SO o autor pode deletar seu proprio comentario
DROP POLICY IF EXISTS "Author deletes own lead_comment" ON public.lead_comments;
CREATE POLICY "Author deletes own lead_comment" ON public.lead_comments
  FOR DELETE
  USING (author_id = auth.uid());

-- 5. Superadmin policy (alinhado com pattern do PR-A migration 011)
DROP POLICY IF EXISTS "Superadmin reads all lead_comments" ON public.lead_comments;
CREATE POLICY "Superadmin reads all lead_comments" ON public.lead_comments
  FOR SELECT
  USING (public.is_superadmin(auth.uid()));

-- 6. Verificacao manual pos-aplicacao:
--    SELECT polname FROM pg_policy WHERE polrelid = 'public.lead_comments'::regclass;
--    Esperado: 5 policies (Members read / Members insert / Author update / Author delete / Superadmin read)

COMMENT ON TABLE public.lead_comments IS
  'PR-M: comentarios colaborativos entre agentes num lead. Flat (sem threaded replies). RLS: org members leem/criam, autor edita/deleta.';

-- ============================================================
-- ROLLBACK MANUAL (se precisar reverter):
-- DROP TABLE IF EXISTS public.lead_comments CASCADE;
-- ============================================================
