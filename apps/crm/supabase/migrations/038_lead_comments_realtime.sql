-- ============================================================
-- MIGRATION 038: lead_comments na publication supabase_realtime (PR-O)
-- ------------------------------------------------------------
-- Habilita postgres_changes broadcast pra tabela lead_comments.
-- Sem isso, o canal `.on("postgres_changes", { table: "lead_comments" })`
-- nunca dispara — broadcast e por publication.
--
-- leads e deals ja estavam na publication desde migration 001 (linhas 833-834).
-- Aqui completamos o trio pra PR-O Realtime.
--
-- IDEMPOTENTE: ALTER PUBLICATION ADD TABLE falha se ja existe, entao
-- usamos DO block + check em pg_publication_tables.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'lead_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_comments;
  END IF;
END $$;

-- Verificacao manual:
--   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
--   Esperado conter: lead_comments, leads, deals, conversations, messages
