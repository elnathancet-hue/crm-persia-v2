-- Migration 100: message_templates em agent_configs
--
-- Adiciona coluna JSONB pra templates de mensagem reutilizáveis por agente.
-- Cada template tem: key (slug único), name, usage?, mode, message.
--
-- mode=ai_suggestion: injetado no system prompt do node IA como referência.
-- mode=fixed_response: enviado como texto exato pelo action node send_template_message.
--
-- DEFAULT '[]' garante compatibilidade total com agentes existentes —
-- runtime verifica message_templates ?? [] em todo ponto de acesso.
-- Sem migration de dados necessária.

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS message_templates JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN agent_configs.message_templates IS
  'Templates de mensagem reutilizáveis. '
  'Schema: [{key, name, usage?, mode: "ai_suggestion"|"fixed_response", message}]. '
  'ai_suggestion: injetado no system prompt do AI node como bloco contextual. '
  'fixed_response: enviado exatamente como está pelo action node send_template_message, sem chamar IA.';
