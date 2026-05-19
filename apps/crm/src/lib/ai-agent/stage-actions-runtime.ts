import "server-only";

import type OpenAI from "openai";
import type {
  AgentConfig,
  AgentConversation,
  AgentStage,
  AgentStepType,
  NativeHandlerName,
  NativeHandlerResult,
  StageAutoAction,
} from "@persia/shared/ai-agent";
import {
  hasActionsBeenExecuted,
  markActionsExecuted,
  normalizeActionsExecuted,
  normalizeStageActionConfig,
} from "@persia/shared/ai-agent";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";
import { errorMessage, logError } from "@/lib/observability";
import { type AgentDb } from "./db";
import { nativeHandlers } from "./tools/registry";

// PR-AI-AGENT-STAGE-ACTIONS-RUNTIME (mai/2026): PR 4 do plano A+C.
// Wiring do executor pra disparar `agent_stages.action_config.auto_actions`
// AUTOMATICAMENTE quando a conversa entra numa etapa nova.
//
// Pipeline:
//   1. executeAgent comeca a processar mensagem
//   2. ANTES do loop do LLM, chama runStageAutoActionsIfPending(stage)
//   3. Helper checa actions_executed[]:
//      - Se ja contem stage.id → skip (idempotente)
//      - Senao: itera auto_actions, executa cada handler nativo,
//        loga step em agent_steps, marca em actions_executed[]
//   4. LLM loop comeca com side-effects ja aplicados (tag aplicada,
//      midia enviada, etc) — IA NAO duplica chamando as mesmas tools
//
// Idempotencia: agent_conversations.actions_executed JSONB[]. Se a
// conversa volta pra mesma etapa via transfer_to_stage, NAO re-executa.
//
// Falha gracioso: erro numa acao nao quebra o pipeline. Loga + continua
// pra proxima acao. Mesmo com falha parcial, marca stage como
// "executado" (semantica "tentei", evita repeticao infinita por bug).

interface StepInserter {
  (step: {
    orgId: string;
    runId: string;
    orderIndex: number;
    stepType: AgentStepType;
    toolId?: string | null;
    nativeHandler?: string | null;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    durationMs: number;
  }): Promise<void>;
}

export interface RunStageAutoActionsParams {
  db: AgentDb;
  orgId: string;
  agentConversation: AgentConversation;
  stage: AgentStage;
  config: AgentConfig;
  runId: string;
  leadId: string;
  crmConversationId: string;
  /** Provider injetado pra send_media etc. No tester, e o stub. */
  provider?: WhatsAppProvider | null;
  /** Cliente OpenAI ja inicializado pra handlers que precisarem (ex:
   * trigger_notification quando handoff_include_summary=true). */
  openaiClient?: OpenAI | null;
  dryRun: boolean;
  /** orderIndex inicial pra inserts em agent_steps (continua de onde
   * o executor parou — RAG/summarization podem ter inserido steps antes). */
  startingOrderIndex: number;
  insertStep: StepInserter;
}

export interface RunStageAutoActionsResult {
  /** Quantas acoes foram efetivamente disparadas. 0 quando skipped
   * (idempotencia) ou stage sem auto_actions. */
  executed: number;
  /** Quantas falharam. Sucesso parcial e possivel (acao 1 ok, acao 2
   * falhou, acao 3 ok). */
  failed: number;
  /** orderIndex atualizado pra o caller continuar de onde paramos. */
  nextOrderIndex: number;
  /** True quando pulamos por idempotencia. */
  skipped: boolean;
}

/**
 * Mapeia acao tipada do action_config -> input do handler nativo.
 * Retorna tupla [handlerName, input] que o executor passa pro
 * `nativeHandlers[handlerName]`. Reusa exatamente os mesmos schemas
 * dos handlers (PR 1 deixou eles amigaveis com nomes em vez de UUID),
 * entao o mapping aqui e direto.
 */
function actionToHandlerInput(
  action: StageAutoAction,
): { handler: NativeHandlerName; input: Record<string, unknown> } {
  switch (action.type) {
    case "add_tag":
      return {
        handler: "add_tag",
        input: { tag_name: action.tag_name },
      };
    case "move_pipeline_stage":
      return {
        handler: "move_pipeline_stage",
        input: {
          stage_name: action.stage_name,
          ...(action.reason ? { reason: action.reason } : {}),
        },
      };
    case "send_media":
      return {
        handler: "send_media",
        input: {
          slug: action.slug,
          ...(action.caption ? { caption: action.caption } : {}),
        },
      };
    case "trigger_notification":
      return {
        handler: "trigger_notification",
        input: {
          template_name: action.template_name,
          ...(action.custom ? { custom: action.custom } : {}),
        },
      };
    case "transfer_to_user":
      return {
        handler: "transfer_to_user",
        input: {
          user: action.user,
          ...(action.reason ? { reason: action.reason } : {}),
        },
      };
    case "transfer_to_agent":
      return {
        handler: "transfer_to_agent",
        input: {
          target_agent_name: action.target_agent_name,
          ...(action.reason ? { reason: action.reason } : {}),
        },
      };
    case "stop_agent":
      return {
        handler: "stop_agent",
        input: action.reason ? { reason: action.reason } : {},
      };
  }
}

/**
 * Dispara as auto_actions desta etapa SE ainda nao foram disparadas.
 * Idempotente via agent_conversations.actions_executed[].
 *
 * Order semantics: acoes executam em ordem (sequencial, nao paralelo).
 * Isso garante que ex: add_tag(qualificado) acontece ANTES de
 * move_pipeline_stage(Negociacao), caso o cliente queira que o lead
 * tenha a tag quando o trigger de stage_changed disparar.
 */
export async function runStageAutoActionsIfPending(
  params: RunStageAutoActionsParams,
): Promise<RunStageAutoActionsResult> {
  const { stage, agentConversation } = params;

  const executedSoFar = normalizeActionsExecuted(agentConversation.actions_executed);
  if (hasActionsBeenExecuted(executedSoFar, stage.id)) {
    return {
      executed: 0,
      failed: 0,
      nextOrderIndex: params.startingOrderIndex,
      skipped: true,
    };
  }

  const config = normalizeStageActionConfig(
    (stage as AgentStage & { action_config?: unknown }).action_config,
  );
  if (config.auto_actions.length === 0) {
    // Sem acoes — ainda assim marca a etapa como "visitada" pra
    // proximas msgs pularem rapido sem nem ler o JSONB.
    await persistMark(params, executedSoFar, stage.id);
    return {
      executed: 0,
      failed: 0,
      nextOrderIndex: params.startingOrderIndex,
      skipped: false,
    };
  }

  let orderIndex = params.startingOrderIndex;
  let executed = 0;
  let failed = 0;
  // PR1 #6 (mai/2026): se qualquer auto-action falhou por `placeholder_skip`
  // (ex: trigger_notification com target_address='0000000000' do seed),
  // NAO marcamos a stage como visitada — assim, cliente arruma a config,
  // lead volta pra etapa e as acoes re-disparam.
  let placeholderSkipDetected = false;

  // Context enriquecido reusado pra todas as acoes — paridade total
  // com o que executeToolCall passa pros handlers do LLM (apps/crm/src/
  // lib/ai-agent/executor.ts:executeToolCall).
  const baseContext = {
    organization_id: params.orgId,
    lead_id: params.leadId,
    crm_conversation_id: params.crmConversationId,
    agent_conversation_id: agentConversation.id,
    run_id: params.runId,
    dry_run: params.dryRun,
    // HandlerContextWithDb fields (cast permissivo no shared schema)
    db: params.db,
    provider: params.provider ?? null,
    config: params.config,
    agentConversation,
    openaiClient: params.openaiClient ?? null,
  };

  for (const action of config.auto_actions) {
    const startedAt = Date.now();
    const { handler: handlerName, input } = actionToHandlerInput(action);
    const handler = nativeHandlers[handlerName];

    let result: NativeHandlerResult;
    if (!handler) {
      result = {
        success: false,
        output: { error: `handler "${handlerName}" not registered` },
        error: `handler "${handlerName}" nao implementado no runtime`,
      };
    } else {
      try {
        result = await handler(baseContext as never, input);
      } catch (err: unknown) {
        result = {
          success: false,
          output: {},
          error: errorMessage(err),
        };
        logError("stage_auto_action_threw", {
          organization_id: params.orgId,
          agent_conversation_id: agentConversation.id,
          stage_id: stage.id,
          handler: handlerName,
          error: errorMessage(err),
        });
      }
    }

    if (result.success) {
      executed++;
    } else {
      failed++;
      const output = result.output as { placeholder_skip?: unknown } | null;
      if (output?.placeholder_skip === true) {
        placeholderSkipDetected = true;
      }
    }

    await params.insertStep({
      orgId: params.orgId,
      runId: params.runId,
      orderIndex: orderIndex++,
      stepType: "tool",
      toolId: null,
      nativeHandler: handlerName,
      input: { ...input, _trigger: "stage_auto_action" },
      output: result.success
        ? { success: true, ...result.output }
        : { success: false, error: result.error ?? "unknown error", ...result.output },
      durationMs: Date.now() - startedAt,
    });
  }

  // Marca stage como executada — mesmo com falhas parciais. Semantica:
  // "ja tentei aqui, nao tento de novo nesta conversa". Se cliente
  // arrumar a config e quiser re-disparar, opcao seria botao "Resetar
  // acoes da etapa" no LeadDrawer (escopo futuro).
  //
  // EXCECAO (PR1 #6): se houve `placeholder_skip` em alguma acao
  // (target_address ainda no default do seed), NAO marcamos a stage.
  // Cliente arruma a config + lead volta pra etapa = nova chance.
  if (placeholderSkipDetected) {
    logError("stage_auto_actions_placeholder_skip", {
      organization_id: params.orgId,
      agent_conversation_id: params.agentConversation.id,
      stage_id: stage.id,
      executed,
      failed,
    });
  } else {
    await persistMark(params, executedSoFar, stage.id);
  }

  return {
    executed,
    failed,
    nextOrderIndex: orderIndex,
    skipped: false,
  };
}

async function persistMark(
  params: RunStageAutoActionsParams,
  current: ReadonlyArray<string>,
  stageId: string,
): Promise<void> {
  const updated = markActionsExecuted(current, stageId);
  // Em dry-run (Tester) NAO persistimos — Tester reseta state via botao.
  // E o is_test=true ja tirou as falsificacoes da audit. Mas se quiser
  // testar o caminho de "ja executado" no Tester, basta clicar Resetar
  // que recria a conversa e marca volta a zero.
  if (params.dryRun) return;

  const { error } = await params.db
    .from("agent_conversations")
    .update({ actions_executed: updated })
    .eq("id", params.agentConversation.id)
    .eq("organization_id", params.orgId);

  if (error) {
    logError("stage_auto_actions_persist_mark_failed", {
      organization_id: params.orgId,
      agent_conversation_id: params.agentConversation.id,
      stage_id: stageId,
      error: error.message,
    });
  } else {
    // Sincroniza in-memory pra que o resto do executeAgent tenha o
    // valor atualizado caso queira ler.
    (params.agentConversation as AgentConversation & { actions_executed?: string[] })
      .actions_executed = updated;
  }
}

// ============================================================================
// detectStageTransitionAndRunActions — chamado APOS o loop do LLM
// ----------------------------------------------------------------------------
// Detecta se houve transicao de etapa durante este run (via tool call
// transfer_to_stage ou transfer_to_agent) e dispara as auto_actions da
// etapa NOVA. Isso fecha o gap onde o lead "entra" numa etapa via tool
// e teria que esperar a proxima msg pra ver as acoes disparando.
//
// Re-fetch da agent_conversation (com current_stage_id + actions_executed
// atualizados pela tool call). Se mudou pra etapa diferente da inicial,
// carrega a nova stage e roda runStageAutoActionsIfPending nela.
//
// Retorna o stage_id final (mesmo se nao mudou) pra que executeAgent
// devolva o nextStageId real, nao o snapshot inicial.
// ============================================================================

export interface DetectStageTransitionParams {
  db: AgentDb;
  orgId: string;
  agentConversation: AgentConversation;
  initialStageId: string;
  config: AgentConfig;
  runId: string;
  leadId: string;
  crmConversationId: string;
  provider: WhatsAppProvider | null;
  openaiClient: OpenAI | null;
  dryRun: boolean;
  startingOrderIndex: number;
  insertStep: StepInserter;
}

export interface DetectStageTransitionResult {
  stageId: string;
  nextOrderIndex: number;
}

export async function detectStageTransitionAndRunActions(
  params: DetectStageTransitionParams,
): Promise<DetectStageTransitionResult> {
  // Re-fetch state atualizado da agent_conversation
  const { data, error } = await params.db
    .from("agent_conversations")
    .select("current_stage_id, actions_executed")
    .eq("id", params.agentConversation.id)
    .eq("organization_id", params.orgId)
    .maybeSingle();

  if (error || !data) {
    return {
      stageId: params.initialStageId,
      nextOrderIndex: params.startingOrderIndex,
    };
  }

  const row = data as {
    current_stage_id?: string | null;
    actions_executed?: unknown;
  };
  const newStageId = row.current_stage_id ?? null;
  if (!newStageId || newStageId === params.initialStageId) {
    // Sem mudanca de etapa — nada a fazer.
    return {
      stageId: params.initialStageId,
      nextOrderIndex: params.startingOrderIndex,
    };
  }

  // Mudou — carrega a stage nova (incluindo action_config) e dispara
  // suas auto_actions. Pode envolver troca de agente (transfer_to_agent
  // troca config_id + current_stage_id), entao buscamos sem filtrar
  // por config_id antigo.
  const { data: stageRow, error: stageError } = await params.db
    .from("agent_stages")
    .select("*")
    .eq("id", newStageId)
    .eq("organization_id", params.orgId)
    .maybeSingle();

  if (stageError || !stageRow) {
    logError("stage_actions_runtime_load_new_stage_failed", {
      organization_id: params.orgId,
      stage_id: newStageId,
      error: stageError?.message ?? "stage not found",
    });
    return {
      stageId: newStageId,
      nextOrderIndex: params.startingOrderIndex,
    };
  }

  const newStage = stageRow as unknown as AgentStage;
  const refreshedConversation: AgentConversation = {
    ...params.agentConversation,
    current_stage_id: newStageId,
    actions_executed: normalizeActionsExecuted(row.actions_executed),
  };

  // Importante: a nova stage pode ser de OUTRO config (transfer_to_agent
  // troca config_id + leva pra primeira stage do novo agente). Usamos
  // o config atual do executor (params.config) pra contexto — handlers
  // que precisem do config certo (ex: trigger_notification que filtra
  // templates por config_id) podem se confundir. Mitigacao: re-fetch
  // do config se ele tiver mudado.
  let effectiveConfig = params.config;
  if (newStage.config_id !== params.config.id) {
    const { data: cfg } = await params.db
      .from("agent_configs")
      .select("*")
      .eq("id", newStage.config_id)
      .eq("organization_id", params.orgId)
      .maybeSingle();
    if (cfg) effectiveConfig = cfg as unknown as AgentConfig;
  }

  const result = await runStageAutoActionsIfPending({
    db: params.db,
    orgId: params.orgId,
    agentConversation: refreshedConversation,
    stage: newStage,
    config: effectiveConfig,
    runId: params.runId,
    leadId: params.leadId,
    crmConversationId: params.crmConversationId,
    provider: params.provider,
    openaiClient: params.openaiClient,
    dryRun: params.dryRun,
    startingOrderIndex: params.startingOrderIndex,
    insertStep: params.insertStep,
  });

  return {
    stageId: newStageId,
    nextOrderIndex: result.nextOrderIndex,
  };
}
