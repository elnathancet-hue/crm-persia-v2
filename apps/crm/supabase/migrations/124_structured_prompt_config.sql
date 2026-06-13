-- Migration 124: structured_prompt_config JSONB em agent_configs.
--
-- Armazena a configuração estruturada do prompt (identidade do agente,
-- tom de comunicação, instrução mestre, regras comerciais, ações proibidas).
--
-- A coluna é nullable: agentes legados continuam funcionando com
-- system_prompt preenchido diretamente. A UI usa structured_prompt_config
-- quando presente; caso contrário, exibe o editor de texto livre.
--
-- O compilador compileStructuredPrompt() (packages/shared/src/ai-agent/
-- structured-prompt.ts) converte o JSONB → system_prompt ao salvar.

ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS structured_prompt_config JSONB DEFAULT NULL;

COMMENT ON COLUMN public.agent_configs.structured_prompt_config IS
  'Editor estruturado de prompt SDR: identidade, tom, regras comerciais, ações proibidas. '
  'Quando presente, substitui a edição direta de system_prompt. '
  'NULL = agente legado (edita system_prompt diretamente).';
