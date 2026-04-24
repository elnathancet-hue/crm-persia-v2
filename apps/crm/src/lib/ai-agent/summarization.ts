import "server-only";

import {
  DEFAULT_CONTEXT_SUMMARIZATION,
  clampRecentMessagesCount,
  clampTokenThreshold,
  clampTurnThreshold,
  shouldTriggerSummarization,
  type AgentConfig,
  type AgentConversation,
  type ContextSummarizationConfig,
  type ConversationSummaryCounters,
} from "@persia/shared/ai-agent";
import type { AgentDb } from "./db";

type LlmHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

interface ConversationMessageRow {
  sender: string | null;
  content: string | null;
  media_url?: string | null;
  created_at: string;
}

export function normalizeContextSummarizationConfig(
  config: Pick<
    AgentConfig,
    | "context_summary_turn_threshold"
    | "context_summary_token_threshold"
    | "context_summary_recent_messages"
  >,
): ContextSummarizationConfig {
  return {
    turn_threshold: clampTurnThreshold(config.context_summary_turn_threshold),
    token_threshold: clampTokenThreshold(config.context_summary_token_threshold),
    recent_messages_count: clampRecentMessagesCount(config.context_summary_recent_messages),
  };
}

export function getConversationSummaryCounters(
  conversation: Pick<
    AgentConversation,
    | "history_summary"
    | "history_summary_updated_at"
    | "history_summary_run_count"
    | "history_summary_token_count"
  >,
): ConversationSummaryCounters {
  return {
    history_summary: conversation.history_summary ?? null,
    history_summary_updated_at: conversation.history_summary_updated_at ?? null,
    history_summary_run_count: Number(conversation.history_summary_run_count ?? 0),
    history_summary_token_count: Number(conversation.history_summary_token_count ?? 0),
  };
}

export function shouldTriggerConversationSummarization(
  conversation: Pick<
    AgentConversation,
    | "history_summary"
    | "history_summary_updated_at"
    | "history_summary_run_count"
    | "history_summary_token_count"
  >,
  config: Pick<
    AgentConfig,
    | "context_summary_turn_threshold"
    | "context_summary_token_threshold"
    | "context_summary_recent_messages"
  >,
): boolean {
  return shouldTriggerSummarization(
    getConversationSummaryCounters(conversation),
    normalizeContextSummarizationConfig(config),
  );
}

export async function buildConversationLlmMessages(params: {
  db: AgentDb;
  orgId: string;
  agentConversation: Pick<AgentConversation, "crm_conversation_id" | "history_summary">;
  config: Pick<
    AgentConfig,
    | "context_summary_turn_threshold"
    | "context_summary_token_threshold"
    | "context_summary_recent_messages"
  >;
}): Promise<LlmHistoryMessage[]> {
  if (!params.agentConversation.crm_conversation_id) return [];

  const config = normalizeContextSummarizationConfig(params.config);
  const recentMessages = await loadRecentConversationMessages({
    db: params.db,
    orgId: params.orgId,
    crmConversationId: params.agentConversation.crm_conversation_id,
    limit: config.recent_messages_count,
  });

  const priorContext = params.agentConversation.history_summary
    ? [
        {
          role: "user" as const,
          content: `Contexto consolidado da conversa ate aqui:\n\n${params.agentConversation.history_summary}`,
        },
        {
          role: "assistant" as const,
          content: "Contexto carregado.",
        },
      ]
    : [];

  return [...priorContext, ...recentMessages];
}

export async function loadMessagesForSummarization(params: {
  db: AgentDb;
  orgId: string;
  conversation: Pick<AgentConversation, "crm_conversation_id" | "created_at" | "history_summary_updated_at">;
}): Promise<ConversationMessageRow[]> {
  if (!params.conversation.crm_conversation_id) return [];

  let query = params.db
    .from("messages")
    .select("sender, content, media_url, created_at")
    .eq("organization_id", params.orgId)
    .eq("conversation_id", params.conversation.crm_conversation_id)
    .order("created_at", { ascending: true });

  if (params.conversation.history_summary_updated_at) {
    query = query.gt("created_at", params.conversation.history_summary_updated_at);
  } else {
    query = query.gte("created_at", params.conversation.created_at);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ConversationMessageRow[];
}

export function formatMessagesForSummarization(messages: ConversationMessageRow[]): string {
  return messages
    .map((message) => `${toSummaryRoleLabel(message.sender)}: ${toMessageText(message)}`)
    .join("\n\n");
}

export function buildSummarizationUserPrompt(params: {
  previousSummary: string | null;
  formattedMessages: string;
}): string {
  if (params.previousSummary) {
    return [
      "Resumo anterior:",
      "",
      params.previousSummary,
      "",
      "Mensagens novas desde o ultimo resumo (em ordem cronologica):",
      "",
      params.formattedMessages,
      "",
      "Gere o novo resumo consolidado.",
    ].join("\n");
  }

  return [
    "Mensagens da conversa (em ordem cronologica):",
    "",
    params.formattedMessages,
    "",
    "Gere o resumo consolidado.",
  ].join("\n");
}

export const SUMMARIZATION_SYSTEM_PROMPT = [
  "Voce e um assistente que consolida o contexto de uma conversa entre um",
  "agente IA e um lead. Produza um resumo estruturado em prosa cobrindo os",
  "topicos abaixo, na mesma ordem, sem listas numeradas:",
  "",
  "- Perfil do lead: nome, telefone, empresa, cargo (se conhecidos). Escreva",
  '  "nao informado" nos campos faltantes.',
  "- Dores e objetivos: principais motivacoes, problemas, metas que apareceram.",
  "- Etapa do funil: onde esta a conversa no processo de vendas/atendimento.",
  "- Estado conversacional: nivel de qualificacao do lead, intencao de",
  "  continuar, tom geral. Use adjetivos concretos.",
  "- Historico narrativo: em ate 3 paragrafos curtos, conte o que aconteceu",
  "  desde o ultimo resumo. Preserve decisoes tomadas, promessas do agente,",
  "  duvidas pendentes. NAO inclua transcricoes literais - isto e um briefing",
  "  pra o proximo turno do agente.",
  "",
  "Responda apenas com o resumo. Sem prefacios, sem JSON, sem markdown.",
  "Portugues brasileiro, 400 a 800 palavras.",
].join("\n");

async function loadRecentConversationMessages(params: {
  db: AgentDb;
  orgId: string;
  crmConversationId: string;
  limit: number;
}): Promise<LlmHistoryMessage[]> {
  const fetchLimit = Math.max(params.limit, DEFAULT_CONTEXT_SUMMARIZATION.recent_messages_count);
  const { data, error } = await params.db
    .from("messages")
    .select("sender, content, media_url, created_at")
    .eq("organization_id", params.orgId)
    .eq("conversation_id", params.crmConversationId)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (error) throw new Error(error.message);

  return ((data ?? []) as ConversationMessageRow[])
    .slice()
    .reverse()
    .slice(-params.limit)
    .map((message) => ({
      role: message.sender === "lead" ? "user" : "assistant",
      content: toMessageText(message),
    }));
}

function toSummaryRoleLabel(sender: string | null): string {
  return sender === "lead" ? "Lead" : "Agente";
}

function toMessageText(message: ConversationMessageRow): string {
  const text = message.content?.trim();
  if (text) return text;
  if (message.media_url) return "[midia enviada]";
  return "[mensagem sem texto]";
}
