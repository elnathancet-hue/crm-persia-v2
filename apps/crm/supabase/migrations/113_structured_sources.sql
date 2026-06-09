-- Migration 113: structured_sources column on agent_configs
-- Allows agents to declare typed data sources (MCP tools or inline JSON)
-- that are injected into the system prompt and exposed as a native tool.

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS structured_sources JSONB NOT NULL DEFAULT '[]'::jsonb;
