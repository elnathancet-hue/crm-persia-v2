-- ============================================================
-- MIGRATION 073: AI Agent — drop agent_conversations.tokens_used_total
-- ------------------------------------------------------------
-- Backlog #13 Auditoria (mai/2026): endereca rodada 6 #6 do
-- POST_CODEX_AUDIT_AGENT_FLOW_353.md. Coluna era incrementada todo
-- flush em executor.ts mas NENHUM produto consumia:
--   - cost-limits.ts usa agent_usage_daily (agregado dia + por
--     config_id) pra enforcement.
--   - UI ActiveLimitsProgress + LimitsUsageTab usam agent_usage_daily
--     tambem.
--   - Nenhuma feature de "consumo por conversa" foi entregue.
--
-- Custo de manter: 1 SELECT + 1 UPDATE em cada flush (~100 conversas
-- por dia em orgs ativas = ~3000 ops/mes pra dado morto).
--
-- Decisao: drop. Per-conversation ceiling pode ser adicionada depois
-- via novo scope `conversation_total` em agent_cost_limits — se virar
-- requisito de produto, recriamos com dados de agent_runs (tem
-- agent_conversation_id, model, tokens_input/output, cost_usd_cents).
--
-- IRREVERSIBILIDADE: ALTER TABLE DROP COLUMN remove a coluna sem
-- preservar historico. Como nada consumia, perda de dado e zero.
-- Rollback abaixo recria a coluna VAZIA (sem backfill possivel).
-- ============================================================

BEGIN;

ALTER TABLE public.agent_conversations
  DROP CONSTRAINT IF EXISTS agent_conversations_tokens_used_total_check;

ALTER TABLE public.agent_conversations
  DROP COLUMN IF EXISTS tokens_used_total;

COMMIT;

-- ============================================================
-- ROLLBACK MANUAL (recria coluna VAZIA — historico perdido):
-- ALTER TABLE public.agent_conversations
--   ADD COLUMN tokens_used_total INTEGER NOT NULL DEFAULT 0
--   CHECK (tokens_used_total >= 0);
-- ============================================================
