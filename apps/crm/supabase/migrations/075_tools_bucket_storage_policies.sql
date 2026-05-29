-- migration: 075_tools_bucket_storage_policies
-- contexto: bug "nao consigo cadastrar midia" reportado em prod mai/2026.
--
-- A tabela public.automation_tools tem policies RLS corretas
-- (owner+admin), e o bucket de Storage 'tools' existe e e publico (leitura
-- liberada via getPublicUrl). Mas o bucket nao tinha NENHUMA policy em
-- storage.objects pra INSERT/UPDATE/DELETE — sem isso, mesmo usuarios
-- autenticados eram rejeitados com "new row violates row-level security
-- policy" no upload. A Server Action createTool jogava essa exception
-- e o Next.js mostrava "Server Components render error".
--
-- Policies criadas aqui:
--   - INSERT: owner/admin da org pode fazer upload em path proprio
--   - SELECT: qualquer authenticated pode listar (bucket ja e publico,
--     mas garantimos listagem via Supabase SDK tambem)
--   - UPDATE: owner/admin da org dona do path
--   - DELETE: owner/admin da org dona do path
--
-- Path convention (definida em apps/crm/src/actions/tools.ts:41):
--   `${orgId}/${timestamp}-${slug}.${ext}`
-- Primeiro segmento do path = orgId. Extraimos via
-- storage.foldername(name)[1] e cruzamos com get_user_org_role (uuid).

BEGIN;

-- ============================================================================
-- INSERT (upload)
-- ============================================================================
DROP POLICY IF EXISTS tools_bucket_insert ON storage.objects;
CREATE POLICY tools_bucket_insert ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'tools'
    AND get_user_org_role(((storage.foldername(name))[1])::uuid) IN ('owner', 'admin')
  );

-- ============================================================================
-- SELECT (listar arquivos via SDK; getPublicUrl ja funcionava sem isso
-- porque bucket public=true, mas listing nao funciona sem policy)
-- ============================================================================
DROP POLICY IF EXISTS tools_bucket_select ON storage.objects;
CREATE POLICY tools_bucket_select ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'tools'
    AND get_user_org_role(((storage.foldername(name))[1])::uuid) IS NOT NULL
  );

-- ============================================================================
-- UPDATE (renomear/alterar metadata)
-- ============================================================================
DROP POLICY IF EXISTS tools_bucket_update ON storage.objects;
CREATE POLICY tools_bucket_update ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'tools'
    AND get_user_org_role(((storage.foldername(name))[1])::uuid) IN ('owner', 'admin')
  )
  WITH CHECK (
    bucket_id = 'tools'
    AND get_user_org_role(((storage.foldername(name))[1])::uuid) IN ('owner', 'admin')
  );

-- ============================================================================
-- DELETE (deleteTool action)
-- ============================================================================
DROP POLICY IF EXISTS tools_bucket_delete ON storage.objects;
CREATE POLICY tools_bucket_delete ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'tools'
    AND get_user_org_role(((storage.foldername(name))[1])::uuid) IN ('owner', 'admin')
  );

COMMIT;

-- ============================================================================
-- Como aplicar
-- ============================================================================
-- npx supabase db push
--
-- Como reverter (se precisar):
-- DROP POLICY IF EXISTS tools_bucket_insert  ON storage.objects;
-- DROP POLICY IF EXISTS tools_bucket_select  ON storage.objects;
-- DROP POLICY IF EXISTS tools_bucket_update  ON storage.objects;
-- DROP POLICY IF EXISTS tools_bucket_delete  ON storage.objects;
