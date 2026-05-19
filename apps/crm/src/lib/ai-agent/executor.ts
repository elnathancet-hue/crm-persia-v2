import "server-only";

import OpenAI from "openai";
import {
  DEBOUNCE_WINDOW_MS_DEFAULT,
  DEFAULT_MODEL,
  INTERNAL_MODEL,
  RAG_CONTEXT_INSTRUCTIONS,
  RAG_CONTEXT_PREFIX,
  RAG_DISTANCE_CEILING,
  calculateCostUsdCents,
  clampRagTopK,
  isAutoPauseExpired,
  isKnownModel,
  isWithinBusinessHours,
  matchesPauseKeyword,
  matchesResumeKeyword,
  normalizeHumanizationConfig,
  shouldSendAfterHoursMessage,
  shouldTriggerSummarization,
  toOpenAITool,
  type DebounceFlushBatch,
  type AgentConfig,
  type AgentConversation,
  type AgentRunStatus,
  type AgentStage,
  type AgentStepType,
  type AgentTool,
  type NativeHandlerContext,
  type RetrievalHit,
  type RetrievalStepInput,
  type RetrievalStepOutput,
} from "@persia/shared/ai-agent";
import type { IncomingMessage, WhatsAppProvider } from "@/lib/whatsapp/provider";
import { createProvider } from "@/lib/whatsapp/providers";
import { errorMessage, logError, logInfo } from "@/lib/observability";
import { asAgentDb, type AgentDb } from "./db";
import { enqueueDebounced } from "./debounce";
import {
  createSyntheticAgentConversation,
  ensureCrmContext,
  incrementConversationSummaryCounters,
  loadActiveAgentConfig,
  loadAgentConfigById,
  loadAllowedTools,
  loadStage,
  persistConversationSummary,
  pickAgentForConversation,
  resolveAgentContext,
  updateConversationUsage,
} from "./context";
import { assertWithinCostLimits, type CostLimitCache } from "./cost-limits";
import {
  assertWithinDeadline,
  GuardrailError,
  normalizeGuardrails,
} from "./guardrails";
import { isNativeAgentEnabled } from "./feature-flag";
import { assertWithinRateLimits } from "./rate-limits";
import {
  buildConversationLlmMessages,
  buildSummarizationUserPrompt,
  formatMessagesForSummarization,
  getConversationSummaryCounters,
  loadMessagesForSummarization,
  normalizeContextSummarizationConfig,
  SUMMARIZATION_SYSTEM_PROMPT,
} from "./summarization";
import { retrieveWithAttempt } from "./rag/retriever";
import {
  getWebhookAllowlistDomains,
  invokeCustomWebhook,
} from "./webhook-caller";
import { isImplementedNativeHandler, nativeHandlers } from "./tools/registry";
import { sendAssistantReply } from "./send-reply";
import {
  loadAgentCatalog,
  loadAgentStageCatalog,
  loadAppointmentTypeCatalog,
  loadKanbanStageCatalog,
  loadMemberCatalog,
  loadNotificationTemplateCatalog,
  loadTagCatalog,
} from "./tool-catalogs";
import {
  detectStageTransitionAndRunActions,
  runStageActionsOnToolSuccess,
  runStageAutoActionsIfPending,
} from "./stage-actions-runtime";

type OpenAIToolCallWire = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type OpenAIMessage =
  | {
      role: "user";
      content: string;
    }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCallWire[];
    }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
    };

type OpenAIChoiceMessage = {
  content?: unknown;
  tool_calls?: OpenAIToolCallWire[];
} | null | undefined;

type OpenAIResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: OpenAIChoiceMessage;
  }>;
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
  } | null;
};

export type NativeAgentOutcome =
  | { handled: false; reason?: string }
  | { handled: true; response: Record<string, unknown> };

export interface TryNativeAgentParams {
  supabase: unknown;
  orgId: string;
  provider: WhatsAppProvider;
  msg: IncomingMessage;
  requestId?: string;
}

export type TryEnqueueForNativeAgentParams = TryNativeAgentParams;

export interface ExecuteAgentParams {
  db: AgentDb;
  orgId: string;
  provider?: WhatsAppProvider;
  msg: IncomingMessage;
  requestId?: string;
  dryRun: boolean;
  config: AgentConfig;
  stage: AgentStage | null;
  agentConversation: AgentConversation;
  tools: AgentTool[];
  inboundMessageId: string | null;
  leadId: string;
  crmConversationId: string;
  allowSummarization?: boolean;
  /**
   * PR-AI-AGENT-TESTER-FAITHFUL (mai/2026): quando true, marca o run
   * em agent_runs.is_test=true pra dashboards filtrarem. Sempre vem
   * acompanhado de dryRun=true (Tester nunca afeta DB de prod).
   * Migration 047 adiciona a coluna com default false.
   */
  isTest?: boolean;
}

export interface ExecuteAgentResult {
  runId: string;
  status: AgentRunStatus;
  assistantReply: string;
  tokensInput: number;
  tokensOutput: number;
  costUsdCents: number;
  nextStageId: string | null;
  error?: string;
}

const HANDOFF_REPLY =
  "Vou chamar uma pessoa da equipe para continuar esse atendimento por aqui.";

export async function tryEnqueueForNativeAgent(
  params: TryEnqueueForNativeAgentParams,
): Promise<NativeAgentOutcome> {
  const db = asAgentDb(params.supabase as never);
  try {
    const enabled = await isNativeAgentEnabled(params.orgId, db);
    if (!enabled) return { handled: false, reason: "feature_flag_off" };

    const primary = await loadActiveAgentConfig(db, params.orgId);
    if (!primary) return { handled: false, reason: "no_active_config" };

    // PR-AGENT-INTEGRATION-3: cria CRM context primeiro (lead + msg)
    // pra ter leadId/crmConversationId disponiveis pro routing.
    const crm = await ensureCrmContext(db, params.orgId, params.msg);

    // Routing: stickiness se ja existe agent_conversation, senao avalia
    // conditions dos secundarios (OR + priority), fallback pro primary.
    const config = await pickAgentForConversation({
      db,
      orgId: params.orgId,
      crmConversationId: crm.crmConversationId,
      leadId: crm.leadId,
      messageText: params.msg.text ?? "",
      primary,
    });

    const resolved = await resolveAgentContext({
      db,
      orgId: params.orgId,
      msg: params.msg,
      config,
      precrm: crm,
    });

    // PR-AI-AGENT-HUMAN-A: pause/resume keyword + auto-pause expiration.
    // Ordem importa:
    //   1. Se conversa esta pausada, checar resume keyword OU expiracao
    //      antes de qualquer coisa. Se reativa, segue fluxo normal (cai
    //      pra checagem de pause keyword embaixo — improvavel mas defensivo).
    //   2. Senao, checar se essa msg e ela mesma uma pause keyword:
    //      seta human_handoff_at e returna handled (nao enqueue).
    const humanization = normalizeHumanizationConfig(
      (resolved.config as AgentConfig & { humanization_config?: unknown }).humanization_config,
    );
    const handoffAt = (
      resolved.agentConversation as AgentConversation & { human_handoff_at?: string | null }
    ).human_handoff_at ?? null;
    const inboundText = params.msg.text ?? "";

    if (handoffAt) {
      const expired = isAutoPauseExpired(handoffAt, humanization);
      const isResumeWord = matchesResumeKeyword(inboundText, humanization);
      if (expired || isResumeWord) {
        // Limpa pausa e continua processamento normal.
        await db
          .from("agent_conversations")
          .update({ human_handoff_at: null })
          .eq("id", resolved.agentConversation.id);
        (resolved.agentConversation as AgentConversation & { human_handoff_at?: string | null }).human_handoff_at = null;
      } else {
        // Pausa ativa — nao responde. Resposta minimal sem enqueue.
        return {
          handled: true,
          response: {
            ok: true,
            skipped: isResumeWord ? "native_agent_handoff" : "paused_active",
            handledBy: "ai_native",
            leadId: resolved.crm.leadId,
            conversationId: resolved.crm.crmConversationId,
          },
        };
      }
    }

    if (matchesPauseKeyword(inboundText, humanization)) {
      await db
        .from("agent_conversations")
        .update({ human_handoff_at: new Date().toISOString() })
        .eq("id", resolved.agentConversation.id);
      return {
        handled: true,
        response: {
          ok: true,
          skipped: "paused_by_keyword",
          handledBy: "ai_native",
          leadId: resolved.crm.leadId,
          conversationId: resolved.crm.crmConversationId,
        },
      };
    }

    // PR-AI-AGENT-HUMAN-C: horario comercial. Roda DEPOIS de pause/resume
    // (cliente pode pausar mesmo fora do horario) e ANTES de enqueue
    // (debounce nao deve disparar IA fora-do-horario).
    //
    // Se fora-do-horario:
    //   - Envia after_hours_message (1x por cooldown de 6h)
    //   - Atualiza after_hours_notified_at = now()
    //   - Retorna sem enqueue
    // Se dentro-do-horario:
    //   - Limpa after_hours_notified_at se setado (reseta dedup pra
    //     proxima saida do horario gerar nova msg)
    //   - Segue fluxo normal
    if (humanization.business_hours_enabled) {
      const now = new Date();
      const withinHours = isWithinBusinessHours(
        now,
        humanization.business_hours,
        humanization.business_hours_timezone,
      );
      const lastNotifiedAt =
        (resolved.agentConversation as AgentConversation & {
          after_hours_notified_at?: string | null;
        }).after_hours_notified_at ?? null;

      if (!withinHours) {
        if (shouldSendAfterHoursMessage(lastNotifiedAt, now)) {
          if (params.provider) {
            try {
              await sendAssistantReply({
                provider: params.provider,
                phone: params.msg.phone,
                text: humanization.after_hours_message,
                humanization,
                orgId: params.orgId,
                conversationId: resolved.crm.crmConversationId,
                persist: {
                  db,
                  leadId: resolved.crm.leadId,
                },
              });
            } catch (err: unknown) {
              logError("after_hours_message_send_failed", {
                organization_id: params.orgId,
                request_id: params.requestId ?? null,
                conversation_id: resolved.crm.crmConversationId,
                error: errorMessage(err),
              });
            }
          }
          await db
            .from("agent_conversations")
            .update({ after_hours_notified_at: now.toISOString() })
            .eq("id", resolved.agentConversation.id);
        }
        return {
          handled: true,
          response: {
            ok: true,
            skipped: "after_hours",
            handledBy: "ai_native",
            leadId: resolved.crm.leadId,
            conversationId: resolved.crm.crmConversationId,
          },
        };
      }

      // Dentro do horario — reseta o flag de dedup pra que a proxima
      // saida do horario gere nova mensagem (e nao seja absorvida).
      if (lastNotifiedAt) {
        await db
          .from("agent_conversations")
          .update({ after_hours_notified_at: null })
          .eq("id", resolved.agentConversation.id);
      }
    }

    await enqueueDebounced({
      db,
      orgId: params.orgId,
      agentConversationId: resolved.agentConversation.id,
      debounceWindowMs: resolved.config.debounce_window_ms ?? DEBOUNCE_WINDOW_MS_DEFAULT,
      inboundMessageId: resolved.crm.inboundMessageId,
      text: buildPendingText(params.msg),
      messageType: normalizePendingMessageType(params.msg.type),
      mediaRef: params.msg.mediaUrl ?? null,
      receivedAt: new Date(params.msg.timestamp || Date.now()),
    });

    return {
      handled: true,
      response: {
        ok: true,
        skipped: "debounced",
        enqueued: true,
        handledBy: "ai_native",
        leadId: resolved.crm.leadId,
        conversationId: resolved.crm.crmConversationId,
      },
    };
  } catch (error) {
    logError("native_agent_enqueue_failed", {
      organization_id: params.orgId,
      request_id: params.requestId ?? null,
      error: errorMessage(error),
    });
    return { handled: false, reason: "exception" };
  }
}

export async function tryNativeAgent(params: TryNativeAgentParams): Promise<NativeAgentOutcome> {
  const db = asAgentDb(params.supabase as never);
  try {
    const enabled = await isNativeAgentEnabled(params.orgId, db);
    if (!enabled) return { handled: false, reason: "feature_flag_off" };

    const config = await loadActiveAgentConfig(db, params.orgId);
    if (!config) return { handled: false, reason: "no_active_config" };

    const resolved = await resolveAgentContext({
      db,
      orgId: params.orgId,
      msg: params.msg,
      config,
    });

    // PR-AI-AGENT-HUMAN-A: paridade com tryEnqueueForNativeAgent — mesma
    // logica de pause/resume keyword + auto-pause expiration. Pouco usado
    // em prod (so testes), mas mantemos sincronizado pra evitar drift.
    const humanization = normalizeHumanizationConfig(
      (resolved.config as AgentConfig & { humanization_config?: unknown }).humanization_config,
    );
    const handoffAt = (
      resolved.agentConversation as AgentConversation & { human_handoff_at?: string | null }
    ).human_handoff_at ?? null;
    const inboundText = params.msg.text ?? "";

    if (handoffAt) {
      const expired = isAutoPauseExpired(handoffAt, humanization);
      const isResumeWord = matchesResumeKeyword(inboundText, humanization);
      if (expired || isResumeWord) {
        await db
          .from("agent_conversations")
          .update({ human_handoff_at: null })
          .eq("id", resolved.agentConversation.id);
        (resolved.agentConversation as AgentConversation & { human_handoff_at?: string | null }).human_handoff_at = null;
      } else {
        return {
          handled: true,
          response: { ok: true, skipped: "native_agent_handoff" },
        };
      }
    }

    if (matchesPauseKeyword(inboundText, humanization)) {
      await db
        .from("agent_conversations")
        .update({ human_handoff_at: new Date().toISOString() })
        .eq("id", resolved.agentConversation.id);
      return {
        handled: true,
        response: { ok: true, skipped: "paused_by_keyword" },
      };
    }

    try {
      await assertWithinRateLimits({
        db,
        orgId: params.orgId,
        agentConversationId: resolved.agentConversation.id,
      });
    } catch (error) {
      if (error instanceof GuardrailError) {
        return {
          handled: true,
          response: {
            ok: true,
            skipped: "rate_limited",
            handledBy: "ai_native",
            leadId: resolved.crm.leadId,
            conversationId: resolved.crm.crmConversationId,
          },
        };
      }
      throw error;
    }

    const result = await executeAgent({
      db,
      orgId: params.orgId,
      provider: params.provider,
      msg: params.msg,
      requestId: params.requestId,
      dryRun: false,
      config: resolved.config,
      stage: resolved.stage,
      agentConversation: resolved.agentConversation,
      tools: resolved.tools,
      inboundMessageId: resolved.crm.inboundMessageId,
      leadId: resolved.crm.leadId,
      crmConversationId: resolved.crm.crmConversationId,
    });

    if (result.status === "failed") {
      return { handled: false, reason: result.error ?? "native_failed" };
    }

    return {
      handled: true,
      response: {
        ok: result.status === "succeeded" || result.status === "fallback",
        handledBy: "ai_native",
        leadId: resolved.crm.leadId,
        conversationId: resolved.crm.crmConversationId,
        runId: result.runId,
        status: result.status,
      },
    };
  } catch (error) {
    logError("native_agent_try_failed", {
      organization_id: params.orgId,
      request_id: params.requestId ?? null,
      error: errorMessage(error),
    });
    return { handled: false, reason: "exception" };
  }
}

export async function executeAgent(params: ExecuteAgentParams): Promise<ExecuteAgentResult> {
  const startedAt = Date.now();
  const guardrails = normalizeGuardrails(params.config.guardrails);
  const executionModel = resolveModel(params.config.model);
  // PR-AI-AGENT-HUMAN-B: humanization config normalizado pra envio
  // (split + delay). Carregado 1x aqui pra reusar nos sites de sendText.
  const humanization = normalizeHumanizationConfig(
    (params.config as typeof params.config & { humanization_config?: unknown })
      .humanization_config,
  );
  const run = await createRun(params, executionModel);
  let tokensInput = 0;
  let tokensOutput = 0;
  let orderIndex = 0;
  let assistantReply = "";
  const costLimitCache: CostLimitCache = {};
  const messages: OpenAIMessage[] = [];

  try {
    if (!params.stage) {
      throw new Error(
        "Agente ainda sem etapas. Crie pelo menos uma etapa na aba Etapas antes de testar.",
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY não está configurado no servidor.");
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const historyMessages = await buildConversationLlmMessages({
      db: params.db,
      orgId: params.orgId,
      agentConversation: params.agentConversation,
      config: params.config,
    });
    messages.push(...historyMessages);
    if (!params.inboundMessageId || !params.agentConversation.crm_conversation_id) {
      messages.push({
        role: "user",
        content: params.msg.text || "[incoming media message]",
      });
    }
    if (messages.length === 0) {
      messages.push({
        role: "user",
        content: params.msg.text || "[incoming media message]",
      });
    }
    const tools = params.tools.map(toOpenAITool);
    const retrieval = params.stage.rag_enabled
      ? await maybeRetrieveKnowledge({
          db: params.db,
          orgId: params.orgId,
          runId: run.id,
          orderIndex: orderIndex,
          config: params.config,
          stage: params.stage,
          historyMessages,
          inboundText: params.msg.text || "[incoming media message]",
          audit: !params.dryRun,
        })
      : null;
    if (retrieval) {
      orderIndex += retrieval.insertedStep ? 1 : 0;
    }
    // PR-AI-AGENT-TOOLS-NAMES (mai/2026): carrega catalogos pra cada
    // tool habilitada que precisa que o LLM saiba as opcoes existentes
    // antes de chamar. Sem isso a IA inventa nomes (add_tag) ou usa UUID
    // (move_pipeline_stage, transfer_*). Cada catalogo so e carregado se
    // a tool esta ativa nesta stage — evita queries desnecessarias.
    // Paralelo via Promise.all — todos os loaders sao independentes.
    const enabledHandlers = new Set(
      params.tools
        .filter((t) => t.is_enabled && t.native_handler !== null)
        .map((t) => t.native_handler!),
    );

    const [
      mediaCatalog,
      tagCatalog,
      memberCatalog,
      agentCatalog,
      kanbanStageCatalog,
      agentStageCatalog,
      notificationTemplateCatalog,
      appointmentTypeCatalog,
    ] = await Promise.all([
      enabledHandlers.has("send_media")
        ? loadMediaCatalog(params.db, params.orgId)
        : Promise.resolve(null),
      enabledHandlers.has("add_tag")
        ? loadTagCatalog(params.db, params.orgId)
        : Promise.resolve(null),
      enabledHandlers.has("transfer_to_user")
        ? loadMemberCatalog(params.db, params.orgId)
        : Promise.resolve(null),
      enabledHandlers.has("transfer_to_agent")
        ? loadAgentCatalog(params.db, params.orgId, params.config.id)
        : Promise.resolve(null),
      enabledHandlers.has("move_pipeline_stage")
        ? loadKanbanStageCatalog(params.db, params.orgId, params.leadId)
        : Promise.resolve(null),
      enabledHandlers.has("transfer_to_stage")
        ? loadAgentStageCatalog(
            params.db,
            params.orgId,
            params.config.id,
            params.stage.id,
          )
        : Promise.resolve(null),
      enabledHandlers.has("trigger_notification")
        ? loadNotificationTemplateCatalog(
            params.db,
            params.orgId,
            params.config.id,
          )
        : Promise.resolve(null),
      enabledHandlers.has("create_appointment")
        ? loadAppointmentTypeCatalog(params.db, params.orgId)
        : Promise.resolve(null),
    ]);

    const system = buildSystemPromptWithRag(
      params.config,
      params.stage,
      retrieval?.hits?.length ? buildRagContextBlock(retrieval.hits) : null,
      mediaCatalog,
      {
        tags: tagCatalog,
        members: memberCatalog,
        agents: agentCatalog,
        kanbanStages: kanbanStageCatalog,
        agentStages: agentStageCatalog,
        notificationTemplates: notificationTemplateCatalog,
        appointmentTypes: appointmentTypeCatalog,
      },
    );

    await updateRunStatus(params.db, run.id, params.orgId, "running");

    // PR-AI-AGENT-STAGE-ACTIONS-RUNTIME (mai/2026): dispara auto_actions
    // configuradas pra esta etapa ANTES do LLM responder. Idempotente:
    // se ja foi disparado pra esta conversa+etapa, e no-op. Sucesso
    // parcial e ok (1 falha nao bloqueia outras). Steps inseridos em
    // agent_steps com native_handler + input { _trigger:
    // 'stage_auto_action' } pra diferenciar de chamadas do LLM.
    const stageActionsResult = await runStageAutoActionsIfPending({
      db: params.db,
      orgId: params.orgId,
      agentConversation: params.agentConversation,
      stage: params.stage,
      config: params.config,
      runId: run.id,
      leadId: params.leadId,
      crmConversationId: params.crmConversationId,
      provider: params.provider ?? null,
      openaiClient: client,
      dryRun: params.dryRun,
      startingOrderIndex: orderIndex,
      insertStep: (step) => insertStep(params.db, step),
    });
    orderIndex = stageActionsResult.nextOrderIndex;

    for (let iteration = 0; iteration < guardrails.max_iterations; iteration++) {
      assertWithinDeadline(startedAt, guardrails);
      await assertWithinCostLimits({
        db: params.db,
        orgId: params.orgId,
        configId: params.config.id,
        agentConversationId: params.agentConversation.id,
        tokensSoFarRun: tokensInput + tokensOutput,
        costSoFarRunUsdCents: calculateCostUsdCents(executionModel, tokensInput, tokensOutput),
        guardrailsTokens: guardrails.cost_ceiling_tokens,
        cache: costLimitCache,
      });

      const response = await withTimeout(
        client.chat.completions.create({
          model: executionModel,
          ...buildMaxTokensParam(executionModel, 1024),
          messages: [
            { role: "system", content: system },
            ...messages,
          ] as never,
          tools: tools as never,
          tool_choice: "auto",
        } as never),
        Math.max(1, guardrails.timeout_seconds) * 1000,
      ) as OpenAIResponse;
      const choice = response.choices?.[0];
      const usage = readUsage(response);
      tokensInput += usage.input;
      tokensOutput += usage.output;
      await insertStep(params.db, {
        orgId: params.orgId,
        runId: run.id,
        orderIndex: orderIndex++,
        stepType: "llm",
        input: { iteration },
        output: {
          finish_reason: choice?.finish_reason ?? null,
          tokens_input: usage.input,
          tokens_output: usage.output,
        },
        durationMs: Date.now() - startedAt,
      });

      await assertWithinCostLimits({
        db: params.db,
        orgId: params.orgId,
        configId: params.config.id,
        agentConversationId: params.agentConversation.id,
        tokensSoFarRun: tokensInput + tokensOutput,
        costSoFarRunUsdCents: calculateCostUsdCents(executionModel, tokensInput, tokensOutput),
        guardrailsTokens: guardrails.cost_ceiling_tokens,
        cache: costLimitCache,
      });

      const toolCalls = extractToolCalls(choice?.message);
      if (choice?.finish_reason !== "tool_calls" || toolCalls.length === 0) {
        assistantReply = extractText(choice?.message) || HANDOFF_REPLY;
        // PR-AI-AGENT-TESTER-RENDER-BUBBLE (mai/2026): chamamos
        // sendAssistantReply sempre que ha provider, INCLUSIVE em
        // dryRun (Tester). O stub do tester e o provider em modo
        // teste — sem essa chamada, o TesterSheet nao recebe os
        // eventos send_text/setTyping e a bolha de resposta nao
        // aparece. dry_run continua valendo pros HANDLERS de tools
        // individuais (cada um respeita context.dry_run interno).
        if (params.provider) {
          await sendAssistantReply({
            provider: params.provider,
            phone: params.msg.phone,
            text: assistantReply,
            humanization,
            orgId: params.orgId,
            conversationId: params.crmConversationId,
            // PR1 #2: persistir so quando NAO eh dryRun (Tester usa ids
            // sinteticos 'tester' que nao casam com FK em messages).
            persist: params.dryRun
              ? undefined
              : { db: params.db, leadId: params.leadId },
          });
        }

        // PR-AI-AGENT-STAGE-ACTIONS-RUNTIME: detecta mudanca de etapa
        // durante este run (tool call transfer_to_stage/transfer_to_agent
        // mexeu em current_stage_id) e dispara as auto_actions da etapa
        // NOVA antes de finalizar. Garantia: lead transferido pra etapa
        // "Ganhou" no fechamento dispara as acoes dela JA (move kanban,
        // notifica equipe), sem esperar proxima mensagem.
        const finalStageId = await detectStageTransitionAndRunActions({
          db: params.db,
          orgId: params.orgId,
          agentConversation: params.agentConversation,
          initialStageId: params.stage.id,
          config: params.config,
          runId: run.id,
          leadId: params.leadId,
          crmConversationId: params.crmConversationId,
          provider: params.provider ?? null,
          openaiClient: client,
          dryRun: params.dryRun,
          startingOrderIndex: orderIndex,
          insertStep: (step) => insertStep(params.db, step),
        });
        if (finalStageId.nextOrderIndex !== orderIndex) {
          orderIndex = finalStageId.nextOrderIndex;
        }

        if (params.allowSummarization !== false && params.agentConversation.crm_conversation_id) {
          const updatedConversation = await incrementConversationSummaryCounters({
            db: params.db,
            orgId: params.orgId,
            conversation: params.agentConversation,
            tokensInput,
            tokensOutput,
          });
          const summaryResult = await maybeRunConversationSummarization({
            client,
            db: params.db,
            orgId: params.orgId,
            runId: run.id,
            orderIndex: orderIndex++,
            config: params.config,
            conversation: updatedConversation,
            requestId: params.requestId,
            timeoutMs: Math.max(1, guardrails.timeout_seconds) * 1000,
          });
          tokensInput += summaryResult.tokensInput;
          tokensOutput += summaryResult.tokensOutput;
        }
        const final = await finishRun(params, {
          runId: run.id,
          status: "succeeded",
          startedAt,
          tokensInput,
          tokensOutput,
          model: executionModel,
        });
        return {
          ...final,
          assistantReply,
          nextStageId: finalStageId.stageId,
        };
      }

      messages.push({
        role: "assistant",
        content: typeof choice?.message?.content === "string" ? choice.message.content : null,
        tool_calls: choice?.message?.tool_calls ?? [],
      });
      for (const call of toolCalls) {
        const tool = params.tools.find((candidate) => candidate.name === call.name) ?? null;
        const toolResult = await executeToolCall(params, {
          runId: run.id,
          orderIndex: orderIndex++,
          tool,
          toolCallId: call.id,
          input: call.input,
          openaiClient: client,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: serializeToolResult(toolResult),
        });

        // PR2 (mai/2026): hook on_tool_success — dispara auto_actions da
        // etapa atual que estavam dormentes esperando esta tool retornar
        // sucesso. Resolve Bug #7 (IA aluciona agendamento): a notif
        // "lead agendou reuniao" so dispara APOS create_appointment ok.
        //
        // Restricoes:
        //   - So pra native_handlers (webhook tools nao tem nome canonico
        //     no schema das auto_actions). tool.native_handler null = skip.
        //   - dryRun: pula no Tester. As acoes ja sao testaveis via
        //     on_enter; on_tool_success exigiria mock de DB write da tool
        //     antes pra ter sentido — escopo futuro.
        if (toolResult.success && tool?.native_handler && !params.dryRun) {
          try {
            const hookResult = await runStageActionsOnToolSuccess({
              db: params.db,
              orgId: params.orgId,
              agentConversation: params.agentConversation,
              config: params.config,
              runId: run.id,
              leadId: params.leadId,
              crmConversationId: params.crmConversationId,
              provider: params.provider ?? null,
              openaiClient: client,
              dryRun: params.dryRun,
              startingOrderIndex: orderIndex,
              insertStep: (step) => insertStep(params.db, step),
              toolName: tool.native_handler,
            });
            if (hookResult.nextOrderIndex !== orderIndex) {
              orderIndex = hookResult.nextOrderIndex;
            }
          } catch (err: unknown) {
            // Falha de hook NAO bloqueia o resto do run — apenas loga.
            // A tool em si ja completou; perder side-effects derivados
            // e menos ruim que abortar a conversa.
            logError("stage_actions_on_tool_success_hook_failed", {
              organization_id: params.orgId,
              run_id: run.id,
              tool: tool.native_handler,
              error: errorMessage(err),
            });
          }
        }
      }
    }

    throw new GuardrailError("run_iterations", "AI agent max iterations reached");
  } catch (error) {
    if (error instanceof GuardrailError) {
      // PR-AI-AGENT-TESTER-RENDER-BUBBLE: provider stub do Tester
      // tambem precisa receber o HANDOFF_REPLY pra renderizar bolha
      // de fallback no caminho de guardrail.
      if (params.provider) {
        // HANDOFF_REPLY e curto (<200 chars); split nao vai ativar de
        // verdade, mas usamos sendAssistantReply pra manter consistencia
        // com setTyping e o caminho default.
        await sendAssistantReply({
          provider: params.provider,
          phone: params.msg.phone,
          text: HANDOFF_REPLY,
          humanization,
          orgId: params.orgId,
          conversationId: params.crmConversationId,
          // PR1 #2: HANDOFF_REPLY tambem entra no historico — guardrail
          // dispara antes de qualquer resposta valida do LLM, mas a IA
          // ja respondeu pro cliente. Mesma logica de dryRun.
          persist: params.dryRun
            ? undefined
            : { db: params.db, leadId: params.leadId },
        });
      }
      await insertStep(params.db, {
        orgId: params.orgId,
        runId: run.id,
        orderIndex: orderIndex++,
        stepType: "guardrail",
        input: { reason: error.reason },
        output: { message: error.message },
        durationMs: Date.now() - startedAt,
      });
      const final = await finishRun(params, {
        runId: run.id,
        status: "fallback",
        startedAt,
        tokensInput,
        tokensOutput,
        model: executionModel,
        errorMsg: error.message,
      });
      return {
        ...final,
        assistantReply: HANDOFF_REPLY,
        nextStageId: params.stage?.id ?? null,
        error: error.message,
      };
    }

    await finishRun(params, {
      runId: run.id,
      status: "failed",
      startedAt,
      tokensInput,
      tokensOutput,
      model: executionModel,
      errorMsg: errorMessage(error),
    });
    logError("native_agent_execute_failed", {
      organization_id: params.orgId,
      request_id: params.requestId ?? null,
      run_id: run.id,
      error: errorMessage(error),
    });
    return {
      runId: run.id,
      status: "failed",
      assistantReply: "",
      tokensInput,
      tokensOutput,
      costUsdCents: calculateCostUsdCents(executionModel, tokensInput, tokensOutput),
      nextStageId: params.stage?.id ?? null,
      error: errorMessage(error),
    };
  }
}

export async function executeTesterAgent(params: {
  db: AgentDb;
  orgId: string;
  configId: string;
  stageId?: string;
  message: string;
  state?: {
    current_stage_id: string | null;
    history_summary: string | null;
    variables: Record<string, unknown>;
  };
}): Promise<ExecuteAgentResult> {
  const config = await loadAgentConfigById(params.db, params.orgId, params.configId);
  if (!config) throw new Error("Agent config not found");
  const stage = params.stageId
    ? await loadStage(params.db, params.orgId, config.id, params.stageId)
    : await loadStage(params.db, params.orgId, config.id, params.state?.current_stage_id ?? null);
  const agentConversation = await createSyntheticAgentConversation({
    db: params.db,
    orgId: params.orgId,
    config,
    stageId: stage?.id ?? null,
    state: params.state,
  });
  const tools = stage ? await loadAllowedTools(params.db, params.orgId, config.id, stage.id) : [];
  return executeAgent({
    db: params.db,
    orgId: params.orgId,
    msg: {
      phone: "tester",
      pushName: "Tester",
      text: params.message,
      type: "text",
      messageId: `tester-${crypto.randomUUID()}`,
    } as IncomingMessage,
    dryRun: true,
    config,
    stage,
    agentConversation,
    tools,
    inboundMessageId: null,
    leadId: "tester",
    crmConversationId: "tester",
    allowSummarization: false,
  });
}

export async function executeDebouncedBatch(params: {
  db: AgentDb;
  orgId: string;
  batch: DebounceFlushBatch;
  requestId?: string;
  /**
   * PR-AI-AGENT-TESTER-FAITHFUL (mai/2026): quando true, tools rodam
   * em modo simulacao (sem efeito real em DB de leads/agendamentos/etc).
   * Default false (prod). Tester sempre passa true.
   */
  dryRun?: boolean;
  /** PR-AI-AGENT-TESTER-FAITHFUL: marca o run com is_test=true. */
  isTest?: boolean;
  /**
   * PR-AI-AGENT-TESTER-FAITHFUL: provider injetado (em prod, vem do
   * loadConnectedProvider via UAZAPI/Meta — no Tester, stub captura
   * eventos em memoria). Default: carrega o provider real da org.
   */
  providerOverride?: WhatsAppProvider;
}): Promise<{ runId: string | null; status: "succeeded" | "failed" | "fallback" | "skipped" }> {
  const conversation = await loadAgentConversation(params.db, params.orgId, params.batch.agent_conversation_id);
  if (!conversation) {
    return { runId: null, status: "skipped" };
  }

  if ((conversation as AgentConversation & { human_handoff_at?: string | null }).human_handoff_at) {
    return { runId: null, status: "skipped" };
  }

  const config = await loadAgentConfigById(params.db, params.orgId, conversation.config_id);
  if (!config || config.status !== "active") {
    return { runId: null, status: "skipped" };
  }

  const lead = await loadLeadForConversation(params.db, params.orgId, conversation.lead_id);
  const provider =
    params.providerOverride ?? (await loadConnectedProvider(params.db, params.orgId));
  const stage = await loadStage(params.db, params.orgId, config.id, conversation.current_stage_id);
  const tools = stage
    ? await loadAllowedTools(params.db, params.orgId, config.id, stage.id)
    : [];

  try {
    await assertWithinRateLimits({
      db: params.db,
      orgId: params.orgId,
      agentConversationId: conversation.id,
    });
  } catch (error) {
    if (error instanceof GuardrailError) {
      return { runId: null, status: "skipped" };
    }
    throw error;
  }

  const result = await executeAgent({
    db: params.db,
    orgId: params.orgId,
    provider,
    msg: {
      messageId: `debounced-${params.batch.latest_inbound_message_id ?? crypto.randomUUID()}`,
      phone: lead.phone,
      pushName: lead.name ?? lead.phone,
      text: params.batch.concatenated_text || "[incoming media message]",
      type: "text",
      isGroup: false,
      isFromMe: false,
      timestamp: Date.now(),
    },
    requestId: params.requestId,
    dryRun: params.dryRun === true,
    isTest: params.isTest === true,
    config,
    stage,
    agentConversation: conversation,
    tools,
    inboundMessageId: params.batch.latest_inbound_message_id,
    leadId: lead.id,
    crmConversationId: conversation.crm_conversation_id,
  });

  return {
    runId: result.runId,
    status: result.status === "failed" ? "failed" : result.status === "fallback" ? "fallback" : "succeeded",
  };
}

async function executeToolCall(
  params: ExecuteAgentParams,
  call: {
    runId: string;
    orderIndex: number;
    tool: AgentTool | null;
    toolCallId: string;
    input: Record<string, unknown>;
    openaiClient: OpenAI;
  },
): Promise<{ success: boolean; output: Record<string, unknown> }> {
  const startedAt = Date.now();
  let success = false;
  let output: Record<string, unknown> = {};
  let stepOutput: Record<string, unknown> | null = null;
  let nativeHandler = call.tool?.native_handler ?? null;

  try {
    if (!call.tool) {
      output = { error: "tool not allowed in current stage" };
      return { success, output };
    }
    if (call.tool.execution_mode === "n8n_webhook") {
      if (!call.tool.webhook_url || !call.tool.webhook_secret) {
        output = { error: "webhook tool is not fully configured" };
        stepOutput = { success, ...output };
        return { success, output };
      }

      const allowlist = await loadWebhookAllowlist(params.db, params.orgId);
      const result = await invokeCustomWebhook({
        tool_id: call.tool.id,
        webhook_url: call.tool.webhook_url,
        webhook_secret: call.tool.webhook_secret,
        payload: call.input,
        context: {
          organization_id: params.orgId,
          lead_id: params.leadId,
          crm_conversation_id: params.crmConversationId,
          agent_conversation_id: params.agentConversation.id,
          run_id: call.runId,
          dry_run: params.dryRun,
        },
        allowlist,
      });

      success = result.success;
      output = result.output;
      stepOutput = { success, ...result.audit_output };
      return { success, output };
    }

    if (!isImplementedNativeHandler(call.tool.native_handler)) {
      output = { error: "handler not implemented in this release" };
      return { success, output };
    }

    nativeHandler = call.tool.native_handler;
    const handler = nativeHandlers[call.tool.native_handler]!;
    const context = {
      db: params.db,
      organization_id: params.orgId,
      lead_id: params.leadId,
      crm_conversation_id: params.crmConversationId,
      agent_conversation_id: params.agentConversation.id,
      run_id: call.runId,
      dry_run: params.dryRun,
      provider: params.provider ?? null,
      config: params.config,
      agentConversation: params.agentConversation,
      openaiClient: call.openaiClient,
      stepOrderIndex: call.orderIndex,
    } as NativeHandlerContext & { db: AgentDb };
    const result = await handler(context, call.input);
    success = result.success;
    output = result.success
      ? { ...result.output, side_effects: result.side_effects ?? [] }
      : { ...result.output, error: result.error ?? "tool failed" };
    stepOutput = { success, ...output };
    return { success, output };
  } finally {
    await insertStep(params.db, {
      orgId: params.orgId,
      runId: call.runId,
      orderIndex: call.orderIndex,
      stepType: "tool",
      toolId: call.tool?.id ?? null,
      nativeHandler,
      input: call.input,
      output: stepOutput ?? { success, ...output },
      durationMs: Date.now() - startedAt,
    });
  }
}

async function createRun(params: ExecuteAgentParams, model: string) {
  const { data, error } = await params.db
    .from("agent_runs")
    .insert({
      organization_id: params.orgId,
      agent_conversation_id: params.agentConversation.id,
      inbound_message_id: params.inboundMessageId,
      status: "pending",
      model,
      // PR-AI-AGENT-TESTER-FAITHFUL: marca run como teste pra
      // dashboards filtrarem. Default false (prod).
      is_test: params.isTest === true,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message || "failed to create agent run");
  return data as { id: string };
}

async function updateRunStatus(
  db: AgentDb,
  runId: string,
  orgId: string,
  status: AgentRunStatus,
): Promise<void> {
  await db
    .from("agent_runs")
    .update({ status })
    .eq("id", runId)
    .eq("organization_id", orgId);
}

async function finishRun(
  params: ExecuteAgentParams,
  result: {
    runId: string;
    status: AgentRunStatus;
    startedAt: number;
    tokensInput: number;
    tokensOutput: number;
    model: string;
    errorMsg?: string;
  },
): Promise<Omit<ExecuteAgentResult, "assistantReply" | "nextStageId">> {
  const durationMs = Date.now() - result.startedAt;
  const costUsdCents = calculateCostUsdCents(
    result.model,
    result.tokensInput,
    result.tokensOutput,
  );
  await params.db
    .from("agent_runs")
    .update({
      status: result.status,
      tokens_input: result.tokensInput,
      tokens_output: result.tokensOutput,
      cost_usd_cents: costUsdCents,
      duration_ms: durationMs,
      error_msg: result.errorMsg ?? null,
    })
    .eq("id", result.runId)
    .eq("organization_id", params.orgId);
  await updateConversationUsage({
    db: params.db,
    orgId: params.orgId,
    agentConversationId: params.agentConversation.id,
    tokensInput: result.tokensInput,
    tokensOutput: result.tokensOutput,
  });
  logInfo("native_agent_run_finished", {
    organization_id: params.orgId,
    request_id: params.requestId ?? null,
    run_id: result.runId,
    status: result.status,
    tokens_input: result.tokensInput,
    tokens_output: result.tokensOutput,
    cost_usd_cents: costUsdCents,
    duration_ms: durationMs,
  });
  return {
    runId: result.runId,
    status: result.status,
    tokensInput: result.tokensInput,
    tokensOutput: result.tokensOutput,
    costUsdCents,
    error: result.errorMsg,
  };
}

async function insertStep(
  db: AgentDb,
  step: {
    orgId: string;
    runId: string;
    orderIndex: number;
    stepType: AgentStepType;
    toolId?: string | null;
    nativeHandler?: string | null;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    durationMs: number;
  },
): Promise<void> {
  await db.from("agent_steps").insert({
    organization_id: step.orgId,
    run_id: step.runId,
    order_index: step.orderIndex,
    step_type: step.stepType,
    tool_id: step.toolId ?? null,
    native_handler: step.nativeHandler ?? null,
    input: step.input,
    output: step.output,
    duration_ms: step.durationMs,
  });
}

async function maybeRunConversationSummarization(params: {
  client: OpenAI;
  db: AgentDb;
  orgId: string;
  runId: string;
  orderIndex: number;
  config: AgentConfig;
  conversation: AgentConversation;
  requestId?: string;
  timeoutMs: number;
}): Promise<{ tokensInput: number; tokensOutput: number }> {
  const counters = getConversationSummaryCounters(params.conversation);
  const summaryConfig = normalizeContextSummarizationConfig(params.config);
  if (!shouldTriggerSummarization(counters, summaryConfig)) {
    return { tokensInput: 0, tokensOutput: 0 };
  }

  const triggerReason =
    counters.history_summary_run_count >= summaryConfig.turn_threshold
      ? "turn_threshold"
      : "token_threshold";
  const summarizationStartedAt = Date.now();
  let messageCountSinceLast = 0;

  try {
    const messages = await loadMessagesForSummarization({
      db: params.db,
      orgId: params.orgId,
      conversation: params.conversation,
    });
    messageCountSinceLast = messages.length;

    const response = await withTimeout(
      params.client.chat.completions.create({
        model: INTERNAL_MODEL,
        ...buildMaxTokensParam(INTERNAL_MODEL, 1200),
        messages: [
          {
            role: "system",
            content: SUMMARIZATION_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: buildSummarizationUserPrompt({
              previousSummary: params.conversation.history_summary ?? null,
              formattedMessages: formatMessagesForSummarization(messages),
            }),
          },
        ] as never,
      } as never),
      params.timeoutMs,
    ) as OpenAIResponse;

    const usage = readUsage(response);
    const newSummary = extractText(response.choices?.[0]?.message).trim();
    if (!newSummary) {
      throw new Error("summarization returned empty text");
    }

    await persistConversationSummary({
      db: params.db,
      orgId: params.orgId,
      conversationId: params.conversation.id,
      historySummary: newSummary,
    });

    await insertStep(params.db, {
      orgId: params.orgId,
      runId: params.runId,
      orderIndex: params.orderIndex,
      stepType: "summarization",
      input: {
        previous_summary_length: params.conversation.history_summary?.length ?? 0,
        message_count_since_last: messageCountSinceLast,
        tokens_since_last: counters.history_summary_token_count,
        trigger_reason: triggerReason,
      },
      output: {
        success: true,
        new_summary_length: newSummary.length,
        tokens_input: usage.input,
        tokens_output: usage.output,
        duration_ms: Date.now() - summarizationStartedAt,
        model: INTERNAL_MODEL,
      },
      durationMs: Date.now() - summarizationStartedAt,
    });

    return {
      tokensInput: usage.input,
      tokensOutput: usage.output,
    };
  } catch (error) {
    await insertStep(params.db, {
      orgId: params.orgId,
      runId: params.runId,
      orderIndex: params.orderIndex,
      stepType: "summarization",
      input: {
        previous_summary_length: params.conversation.history_summary?.length ?? 0,
        message_count_since_last: messageCountSinceLast,
        tokens_since_last: counters.history_summary_token_count,
        trigger_reason: triggerReason,
      },
      output: {
        success: false,
        new_summary_length: 0,
        tokens_input: 0,
        tokens_output: 0,
        duration_ms: Date.now() - summarizationStartedAt,
        model: INTERNAL_MODEL,
        error: errorMessage(error),
      },
      durationMs: Date.now() - summarizationStartedAt,
    });
    logError("native_agent_summarization_failed", {
      organization_id: params.orgId,
      request_id: params.requestId ?? null,
      run_id: params.runId,
      agent_conversation_id: params.conversation.id,
      error: errorMessage(error),
    });
    return { tokensInput: 0, tokensOutput: 0 };
  }
}

async function loadWebhookAllowlist(db: AgentDb, orgId: string): Promise<string[]> {
  const { data, error } = await db
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();

  if (error || !data) return [];
  return getWebhookAllowlistDomains((data as { settings?: unknown }).settings);
}

// PR-AGENT-INTEGRATION-4: descricoes amigaveis pro LLM de cada tipo
// de acao. Quando agent_config.behavior_mode='actions' e a stage tem
// action_type setado, injetamos esse texto no system prompt no lugar
// de tratar stage.instruction como sub-prompt. system_prompt do agente
// e o "manual mestre" — etapas viram orientacoes complementares.
const ACTION_TYPE_INSTRUCTIONS: Record<
  Exclude<NonNullable<AgentStage["action_type"]>, never>,
  string
> = {
  qualify:
    "Esta etapa é de QUALIFICAÇÃO: extraia informações do lead (nome, necessidade, contexto) com no máximo 1 pergunta por turno.",
  send_material:
    "Esta etapa é de ENVIO DE MATERIAL: use a ferramenta send_media para enviar o documento/imagem mais adequado ao que o lead pediu.",
  schedule:
    "Esta etapa é de AGENDAMENTO: use a ferramenta create_appointment para marcar uma reunião com o lead. Confirme dia/horário antes.",
  add_tag:
    "Esta etapa é de ETIQUETAGEM: use a ferramenta add_tag para classificar o lead conforme o contexto da conversa.",
  move_pipeline:
    "Esta etapa é de MOVIMENTAÇÃO NO FUNIL: use a ferramenta move_pipeline_stage para mover o lead pra próxima etapa do Kanban quando fizer sentido.",
  transfer:
    "Esta etapa é de TRANSFERÊNCIA PRA HUMANO: chame stop_agent assim que perceber que precisa de um atendente humano (cobrança, reclamação séria, escopo fora do agente).",
  free_message:
    "Esta etapa é de MENSAGEM LIVRE: siga a instrução abaixo livremente.",
};

interface ToolCatalogs {
  tags: string | null;
  members: string | null;
  agents: string | null;
  kanbanStages: string | null;
  agentStages: string | null;
  notificationTemplates: string | null;
  appointmentTypes: string | null;
}

function buildSystemPromptWithRag(
  config: AgentConfig,
  stage: AgentStage,
  ragContext: string | null,
  mediaCatalog: string | null,
  toolCatalogs?: ToolCatalogs,
): string {
  const isActionsMode = config.behavior_mode === "actions";
  // Em modo actions, NAO usamos stage.instruction como sub-prompt — o
  // system_prompt fixo + ACTION_TYPE_INSTRUCTIONS dao o contexto. Em
  // modo stages (legado), stage.instruction continua sendo o sub-prompt.
  const actionLine =
    isActionsMode && stage.action_type
      ? ACTION_TYPE_INSTRUCTIONS[stage.action_type]
      : null;
  const stageInstruction = isActionsMode ? null : stage.instruction;

  // FIX Bug #8 (mai/2026): nudge explicito de avaliar transicao a cada
  // turno. Antes desta linha, o LLM via transition_hint como "dica" e
  // ficava preso na etapa inicial fazendo o funil inteiro inline.
  // Agora forcamos um check antes do reply: se condicao bate, chama
  // transfer_to_stage ANTES de responder. So injetamos quando ha
  // transition_hint configurado E ha tool transfer_to_stage disponivel
  // (single-stage agent nao precisa).
  const transitionRule = stage.transition_hint
    ? "REGRA DE TRANSICAO (avaliar a CADA turno, ANTES de responder): se a condicao da `Dica de transicao` abaixo foi cumprida nesta conversa, VOCE DEVE chamar transfer_to_stage com o nome da proxima etapa AGORA — nao na proxima mensagem, nao depois de mais uma pergunta. Auto-actions da etapa de destino dependem disso pra rodar."
    : null;

  return [
    ragContext,
    config.system_prompt,
    "",
    `Etapa atual: ${stage.situation}`,
    actionLine,
    stageInstruction,
    transitionRule,
    stage.transition_hint ? `Dica de transicao: ${stage.transition_hint}` : "",
    mediaCatalog,
    // PR-AI-AGENT-TOOLS-NAMES: catalogos das tools nativas (tags,
    // members, etapas Kanban, etapas do agente, agentes, templates,
    // tipos de agendamento). Cada bloco vem como string ja formatada
    // ou null (silencia).
    toolCatalogs?.tags ?? null,
    toolCatalogs?.kanbanStages ?? null,
    toolCatalogs?.agentStages ?? null,
    toolCatalogs?.members ?? null,
    toolCatalogs?.agents ?? null,
    toolCatalogs?.notificationTemplates ?? null,
    toolCatalogs?.appointmentTypes ?? null,
    "Responda ao cliente em portugues brasileiro, de forma objetiva e util.",
    "Use ferramentas apenas quando a acao for necessaria e permitida.",
  ]
    .filter(Boolean)
    .join("\n");
}

// PR-AI-AGENT-HUMAN-D: catalogo de midias da biblioteca pra injetar no
// system prompt. Sem isso, LLM nao sabe os slugs disponiveis e falha
// ao chamar send_media. Retorna null se a org nao tem midia.
const MEDIA_CATALOG_LIMIT = 50;
async function loadMediaCatalog(
  db: AgentDb,
  orgId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("automation_tools")
    .select("slug, name, description, category, file_type")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(MEDIA_CATALOG_LIMIT);
  if (error || !data || data.length === 0) return null;
  const rows = data as ReadonlyArray<{
    slug?: string | null;
    name?: string | null;
    description?: string | null;
    category?: string | null;
  }>;
  const lines: string[] = [];
  for (const r of rows) {
    if (!r.slug || !r.name) continue;
    const desc = r.description?.trim();
    lines.push(
      `- slug: "${r.slug}" — ${r.name}${r.category ? ` (${r.category})` : ""}${
        desc ? ` — ${desc}` : ""
      }`,
    );
  }
  if (lines.length === 0) return null;
  return [
    "Mídias disponíveis na biblioteca (use send_media com o slug exato):",
    ...lines,
  ].join("\n");
}

async function maybeRetrieveKnowledge(params: {
  db: AgentDb;
  orgId: string;
  runId: string;
  orderIndex: number;
  config: AgentConfig;
  stage: AgentStage;
  historyMessages: OpenAIMessage[];
  inboundText: string;
  audit: boolean;
}): Promise<{
  hits: RetrievalHit[];
  insertedStep: boolean;
}> {
  const topK = clampRagTopK(params.stage.rag_top_k);
  const input: RetrievalStepInput = {
    query_text: buildRetrievalQueryText(params.inboundText, params.historyMessages),
    top_k_requested: topK,
    distance_ceiling: RAG_DISTANCE_CEILING,
  };
  const attempt = await retrieveWithAttempt({
    config_id: params.config.id,
    organization_id: params.orgId,
    query_text: input.query_text,
    top_k: topK,
    audit: params.audit,
  }, params.db);

  if (params.audit) {
    const output: RetrievalStepOutput & { phase: "retrieval" } = {
      phase: "retrieval",
      success: attempt.success,
      hits_returned: attempt.hits.length,
      tokens_embedded: attempt.tokensEmbedded,
      duration_ms: attempt.durationMs,
      ...(attempt.error ? { error: attempt.error } : {}),
      ...(attempt.hits.length > 0
        ? {
            hits: attempt.hits.map((hit) => ({
              source_id: hit.source_id,
              source_title: hit.source_title,
              distance: hit.distance,
            })),
          }
        : {}),
    };

    await insertStep(params.db, {
      orgId: params.orgId,
      runId: params.runId,
      orderIndex: params.orderIndex,
      stepType: "llm",
      input: input as unknown as Record<string, unknown>,
      output: output as unknown as Record<string, unknown>,
      durationMs: attempt.durationMs,
    });
  }

  return {
    hits: attempt.hits,
    insertedStep: params.audit,
  };
}

function buildRetrievalQueryText(inboundText: string, historyMessages: OpenAIMessage[]): string {
  const historySummary = historyMessages.find(
    (message) =>
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.startsWith("Contexto consolidado da conversa ate aqui:"),
  )?.content;

  return historySummary
    ? `${historySummary.replace(/^Contexto consolidado da conversa ate aqui:\n\n/, "")}\n\nMensagem atual do cliente:\n${inboundText}`
    : inboundText;
}

function buildRagContextBlock(hits: RetrievalHit[]): string {
  return [
    RAG_CONTEXT_PREFIX,
    RAG_CONTEXT_INSTRUCTIONS,
    "",
    ...hits.map(
      (hit, index) => `[${index + 1}] (from "${hit.source_title}") ${hit.content}`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

function extractToolCalls(message: OpenAIChoiceMessage): Array<{
  id: string;
  name: string;
  input: Record<string, unknown>;
}> {
  return (message?.tool_calls ?? [])
    .filter((call) => call?.type === "function" && typeof call.function?.name === "string")
    .map((call) => ({
      id: String(call.id),
      name: String(call.function.name),
      input: parseToolArguments(call.function.arguments),
    }));
}

function extractText(message: OpenAIChoiceMessage): string {
  if (typeof message?.content === "string") {
    return message.content.trim();
  }

  if (Array.isArray(message?.content)) {
    return message.content
      .map((block: any) => {
        if (typeof block?.text === "string") return block.text;
        if (typeof block?.content === "string") return block.content;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function readUsage(response: OpenAIResponse): { input: number; output: number } {
  return {
    input: Number(response.usage?.prompt_tokens ?? 0),
    output: Number(response.usage?.completion_tokens ?? 0),
  };
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeToolResult(result: {
  success: boolean;
  output: Record<string, unknown>;
}): string {
  return JSON.stringify({
    success: result.success,
    ...result.output,
  });
}

function buildMaxTokensParam(model: string, maxTokens: number): {
  max_completion_tokens?: number;
  max_tokens?: number;
} {
  if (model.startsWith("gpt-5")) {
    // PR1 #5 (mai/2026): gpt-5* gasta `reasoning_tokens` internos DENTRO
    // do budget de `max_completion_tokens` antes de emitir a saida
    // visivel. Em runs reais o reasoning queimava 700-900 tokens, sobrando
    // 100-300 pro texto da resposta — frequentemente truncado e renderizado
    // como HANDOFF_REPLY. Multiplicamos por 4 pra reservar headroom de
    // reasoning + output completo. Acima de gpt-5* o consumo de tokens
    // ainda fica dentro dos limits operacionais; o teto duro continua
    // sendo `guardrails.cost_ceiling_tokens` na enforcment de cost-limits.
    // Detalhes: memory project_gpt5_reasoning_tokens_bug.md.
    return { max_completion_tokens: maxTokens * 4 };
  }
  return { max_tokens: maxTokens };
}

function resolveModel(model: string): string {
  return isKnownModel(model) ? model : DEFAULT_MODEL;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new GuardrailError("run_cost_timeout", "AI agent execution timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadAgentConversation(
  db: AgentDb,
  orgId: string,
  agentConversationId: string,
): Promise<AgentConversation | null> {
  const { data, error } = await db
    .from("agent_conversations")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", agentConversationId)
    .maybeSingle();

  if (error || !data) return null;
  return data as AgentConversation;
}

async function loadLeadForConversation(
  db: AgentDb,
  orgId: string,
  leadId: string,
): Promise<{ id: string; phone: string; name: string | null }> {
  const { data, error } = await db
    .from("leads")
    .select("id, phone, name")
    .eq("organization_id", orgId)
    .eq("id", leadId)
    .maybeSingle();

  if (error || !data) throw new Error("lead not found for agent conversation");
  return data as { id: string; phone: string; name: string | null };
}

async function loadConnectedProvider(db: AgentDb, orgId: string): Promise<WhatsAppProvider> {
  const { data, error } = await db
    .from("whatsapp_connections")
    .select("provider, instance_url, instance_token, phone_number, phone_number_id, waba_id, access_token, webhook_verify_token")
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) throw new Error("connected whatsapp provider not found");
  return createProvider(data as Record<string, unknown>);
}

function buildPendingText(msg: IncomingMessage): string {
  return msg.text?.trim() || defaultPendingTextForType(msg.type);
}

function normalizePendingMessageType(
  type: IncomingMessage["type"],
): "text" | "image" | "audio" | "video" | "document" | "location" | "other" {
  if (
    type === "text" ||
    type === "image" ||
    type === "audio" ||
    type === "video" ||
    type === "document" ||
    type === "location"
  ) {
    return type;
  }
  return "other";
}

function defaultPendingTextForType(type: IncomingMessage["type"]): string {
  switch (type) {
    case "image":
      return "[image received]";
    case "audio":
      return "[audio received]";
    case "video":
      return "[video received]";
    case "document":
      return "[document received]";
    case "location":
      return "[location received]";
    case "contact":
      return "[contact received]";
    case "sticker":
      return "[sticker received]";
    default:
      return "[message received]";
  }
}
