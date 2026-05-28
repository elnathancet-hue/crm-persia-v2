// PR 4 do plano docs/ai-agent/11-openai-responses-migration.md (mai/2026):
// feature flag `AI_AGENT_OPENAI_API` controla qual API do OpenAI o flow
// runner usa para chamadas LLM.
//
// Valores aceitos: "chat" (default) | "responses".
// - "chat": runtime usa `client.chat.completions.create()` via adapter
//   `runChatCompletionTurn()`. Comportamento idêntico ao histórico
//   pré-pivot Responses; cobre todos os clientes em prod hoje.
// - "responses": runtime usa `client.responses.create()` via adapter
//   `runResponsesTurn()`. Path opt-in pra staging/QA antes de virar default
//   (PR 5 do plano original).
//
// Qualquer outro valor cai pra "chat" silenciosamente — env var corrompida
// não deve mudar comportamento de prod.

export type OpenAiApiMode = "chat" | "responses";

export const AI_AGENT_OPENAI_API_ENV_VAR = "AI_AGENT_OPENAI_API" as const;

export function getOpenAiApiMode(): OpenAiApiMode {
  const raw = process.env[AI_AGENT_OPENAI_API_ENV_VAR];
  if (raw === "responses") return "responses";
  return "chat";
}
