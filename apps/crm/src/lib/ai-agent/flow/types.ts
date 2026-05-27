// AI Agent — tipos internos do flow runner.
//
// PR-FLOW-PIVOT PR 2 (mai/2026): contratos consumidos por runner.ts +
// tester actions. Mantém superfície pública estreita — handler internals
// não vazam pra UI.

import type { FlowConfig } from "@persia/shared/ai-agent";
import type { AiOutboundSendGuard } from "../send-guard";
import type { LoadedFlow } from "./loader";

/**
 * Resultado final de uma execução de flow num turno.
 */
export interface FlowRunResult {
  /** Node onde o flow parou. Persistido em
   * agent_conversations.current_node_id pra próximo turno continuar daqui. */
  ending_node_id: string | null;
  /** Texto final do assistente (concatenação de todos os sends do turno). */
  assistant_reply: string;
  /** Total de tool calls bem-sucedidos neste turno (audit). */
  tool_calls_succeeded: number;
  /** Total de tool calls que retornaram erro. */
  tool_calls_failed: number;
  /** Quando true, runner parou porque max_iterations bateu — possível loop. */
  hit_max_iterations: boolean;
  /** Tokens consumidos pelo LLM neste turno (input). Soma de todas as
   * iterações ping-pong do AI node. Usado pra audit em agent_runs. */
  tokens_input: number;
  /** Tokens gerados pelo LLM neste turno (output). */
  tokens_output: number;
  /** Erro fatal que abortou a execução (ex: flow sem entry node). */
  fatal_error?: string;
  /** Eventos capturados pelo provider stub (apenas modo tester). Em modo
   * produção este array fica vazio porque o provider real envia direto
   * pro WhatsApp. */
  events: TesterRunEvent[];
}

/** Evento capturado durante a execução. Compatível com TesterEvent do
 * shared, mas inclui campos de debug que o Tester live exibe. */
export interface TesterRunEvent {
  ts: number;
  kind:
    | "node_entered"
    | "node_exited"
    | "edge_traversed"
    | "send_text"
    | "set_typing_on"
    | "set_typing_off"
    | "send_media"
    | "tool_call"
    | "tool_result"
    | "llm_call"
    | "guardrail"
    | "skipped";
  payload: Record<string, unknown>;
}

/**
 * Provider stub usado pelo Tester. Roda em-memória capturando o que o
 * agente "enviaria" pro WhatsApp. PR 2b vai trocar pelo provider real
 * em modo produção.
 */
export interface FlowProviderStub {
  /** Push de evento na timeline. */
  emit(event: Omit<TesterRunEvent, "ts">): void;
  /** Lê todos os eventos capturados até agora (ordem cronológica). */
  getEvents(): TesterRunEvent[];
}

/**
 * Contexto de execução repassado entre handlers. Mantém referências aos
 * recursos que o runtime precisa (DB, IDs, provider) + estado mutável
 * do turno (eventos, contadores).
 */
export interface FlowRunContext {
  flow: LoadedFlow;
  /** Agent_config_id — usado por handlers que precisam carregar mais
   * config (model, system_prompt do agente). */
  agentConfigId: string;
  /** Org + conversation IDs pra audit/persist. */
  organizationId: string;
  /** ID da conversation real (conversations.id) — null em runs de teste. */
  crmConversationId: string | null;
  /** ID da agent_conversation (agent_conversations.id) — sempre presente,
   * runtime cria se faltar no início do turno. */
  agentConversationId: string;
  /** Lead alvo da conversa (leads.id) — pode ser null em testes iniciais. */
  leadId: string | null;
  /** Mensagem de entrada do lead nesse turno. */
  inboundMessage: {
    text: string;
    received_at: string;
  };
  /** Provider que recebe sends do agente. Tester injeta stub, prod injeta
   * adapter real. */
  provider: FlowProviderStub;
  /** Quando true, side-effects determinísticos (criar appointment,
   * adicionar tag, enviar notificação) NÃO são executados — só
   * simulados. Sempre true em modo Tester. */
  dryRun: boolean;
  /** Snapshot do FlowConfig já normalizado pra rodadas internas (evita
   * passar `flow.config` toda hora). */
  flowConfig: FlowConfig;
  /**
   * PR-3 Auditoria (mai/2026): guard de ownership/handoff pra checar antes
   * de cada AI node e action node. Endereca rodada 7 #alta #3 — tools
   * rodavam mesmo com human_handoff_active. Antes, so o send_text final
   * passava pelo guard (last-mile no realtime-provider). Agora os nodes
   * tambem abortam graciosamente se ownership muda mid-flow.
   *
   * Optional: tester nao injeta este guard (dryRun=true skipa check).
   */
  sendGuard?: AiOutboundSendGuard;
}

/**
 * Opções de execução do runner.
 */
export interface FlowRunOptions {
  /** Limite duro de transições node→node antes de abortar (guardrail
   * anti-loop). Default 20. */
  maxIterations?: number;
  /** Timeout total da execução em ms. Default 30s. */
  timeoutMs?: number;
}
