-- Knowledge inject hybrid (mai/2026): adiciona agent_configs.knowledge_mode
--
-- Contexto: a feature "Documentos da base" indexava docs via Voyage +
-- pgvector desde abr/2026 (PR 6.2 RAG runtime), mas o pivot pro Flow
-- runtime em mai/2026 quebrou o consumer — runner.ts nao injetava mais
-- os chunks no prompt LLM. Cliente via "Indexada (14 chunks)" mas IA
-- ignorava o documento.
--
-- Fix hibrido: o runner agora le `knowledge_mode` e decide como
-- injetar o conhecimento:
--
--   - 'full' (default): concatena TODOS chunks no system prompt.
--     Funciona pra docs pequenos (<30KB total). Mental model "igual
--     ChatGPT" — IA tem visao completa do FAQ/proposta/regras sem
--     custo de retrieval ruim.
--
--   - 'rag': embed query + top-k retrieval via pgvector. Reutiliza
--     `retrieveWithAttempt()` e RPC `match_agent_knowledge_chunks`
--     que ja existem. Pra docs grandes (>30KB).
--
--   - 'auto': sistema decide baseado em bytes totais. <30KB = full,
--     >= 30KB = rag. Default sao opt-in — habilitado por agente.
--
-- Voyage embeddings continuam sendo gerados no upload (modo 'rag' e
-- 'auto' precisam). Custo extra zero pra agente em 'full' — chunks
-- existem pra futuro switch sem reindexar.

BEGIN;

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS knowledge_mode TEXT
    NOT NULL DEFAULT 'full'
    CHECK (knowledge_mode IN ('full', 'rag', 'auto'));

COMMENT ON COLUMN public.agent_configs.knowledge_mode IS
  'Como o conhecimento (docs anexados ao agente) e injetado no prompt LLM. '
  'full: concatena todos chunks (default, ChatGPT-style). '
  'rag: top-k retrieval via similaridade vetorial (escala pra docs grandes). '
  'auto: sistema escolhe baseado em bytes totais.';

COMMIT;

-- ============================================================================
-- Rollback (manual):
--   ALTER TABLE public.agent_configs DROP COLUMN IF EXISTS knowledge_mode;
-- ============================================================================
