-- ============================================================
-- MIGRATION 022: AI Agent RAG (knowledge base + embeddings)
-- ------------------------------------------------------------
-- Scope:
--   - pgvector extension.
--   - Three new tables: knowledge_sources (FAQ/documents), chunks
--     (embedding rows), indexing_jobs (lease-based fila).
--   - New agent_stages.rag_top_k column (default 3, capped 10).
--   - HNSW index on chunks.embedding (cosine).
--   - RLS by organization_id, runtime writes via service_role.
--
-- Additive only; runtime remains off by default (rag_enabled=false).
-- Voyage key missing => indexer fails the job with a clear error;
-- retrieval returns empty set; executor falls through to LLM only.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- Parent row: one per FAQ item or uploaded document.
CREATE TABLE IF NOT EXISTS public.agent_knowledge_sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('faq', 'document')),
  title TEXT NOT NULL,
  -- For source_type='faq': { question, answer }
  -- For source_type='document': { storage_path, mime_type, size_bytes, original_filename }
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  indexing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (indexing_status IN ('pending', 'processing', 'indexed', 'failed')),
  indexing_error TEXT,
  indexed_at TIMESTAMPTZ,
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Child rows: one per chunk of a source, with its embedding.
-- Dimension 1024 = voyage-3-lite. Changing the model means rebuild.
CREATE TABLE IF NOT EXISTS public.agent_knowledge_chunks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES public.agent_knowledge_sources(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL CHECK (token_count > 0),
  embedding vector(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, chunk_index)
);

-- Fila de indexação com lease (single-flight). Mirror do padrão
-- do debounce flush: claim com UPDATE ... WHERE claimed_at IS NULL
-- OR claimed_at < now() - INTERVAL '5 minutes', TTL pra auto-retry.
CREATE TABLE IF NOT EXISTS public.agent_indexing_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.agent_knowledge_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claimed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-stage retrieval knob. rag_enabled already exists on agent_stages
-- from migration 017. Add top_k (range enforced by runtime + UI clamp).
ALTER TABLE public.agent_stages
  ADD COLUMN IF NOT EXISTS rag_top_k INTEGER NOT NULL DEFAULT 3
    CHECK (rag_top_k BETWEEN 1 AND 10);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_sources_config_type
  ON public.agent_knowledge_sources (config_id, source_type, status);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_sources_org_indexing
  ON public.agent_knowledge_sources (organization_id, indexing_status);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_chunks_config
  ON public.agent_knowledge_chunks (config_id);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_chunks_source
  ON public.agent_knowledge_chunks (source_id);
-- HNSW cosine index for vector similarity search.
-- Filter must be applied alongside (config_id) to keep recall relevant.
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_chunks_embedding
  ON public.agent_knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_agent_indexing_jobs_status_claimed
  ON public.agent_indexing_jobs (status, claimed_at)
  WHERE status IN ('pending', 'processing');

-- RLS
ALTER TABLE public.agent_knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_indexing_jobs ENABLE ROW LEVEL SECURITY;

-- Sources: readable by agents (so the executor can resolve source titles),
-- mutations are admin/owner-only (UI for FAQ + document upload).
CREATE POLICY "agent_knowledge_sources_select" ON public.agent_knowledge_sources
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin', 'agent'));
CREATE POLICY "agent_knowledge_sources_insert" ON public.agent_knowledge_sources
  FOR INSERT WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_knowledge_sources_update" ON public.agent_knowledge_sources
  FOR UPDATE USING (get_user_org_role(organization_id) IN ('owner', 'admin'))
  WITH CHECK (get_user_org_role(organization_id) IN ('owner', 'admin'));
CREATE POLICY "agent_knowledge_sources_delete" ON public.agent_knowledge_sources
  FOR DELETE USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

-- Chunks: SELECT only from UI. Writes happen via service_role during
-- indexing and never from the authenticated UI.
CREATE POLICY "agent_knowledge_chunks_select" ON public.agent_knowledge_chunks
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

-- Jobs: admin-readable for debugging. Writes via service_role.
CREATE POLICY "agent_indexing_jobs_select" ON public.agent_indexing_jobs
  FOR SELECT USING (get_user_org_role(organization_id) IN ('owner', 'admin'));

COMMIT;

-- ============================================================
-- Rollback (manual):
-- ============================================================
-- BEGIN;
--   DROP TABLE IF EXISTS public.agent_indexing_jobs;
--   DROP TABLE IF EXISTS public.agent_knowledge_chunks;
--   DROP TABLE IF EXISTS public.agent_knowledge_sources;
--   ALTER TABLE public.agent_stages DROP COLUMN IF EXISTS rag_top_k;
--   -- pgvector kept (may be used by other features).
-- COMMIT;
