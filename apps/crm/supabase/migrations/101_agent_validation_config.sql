-- Migration 101: validation_config em agent_configs
-- Adiciona coluna JSONB pra configurar validação antes do envio da resposta IA.
-- DEFAULT '{}' → normalizeValidationConfig aplica defaults (enabled=false).
-- Backward compatible: agentes existentes não têm validação ativa.

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS validation_config JSONB NOT NULL DEFAULT '{}'::jsonb;
