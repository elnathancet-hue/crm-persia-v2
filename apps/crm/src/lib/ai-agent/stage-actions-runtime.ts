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
  getStageActionState,
  hasActionsBeenExecuted,
  isOnEnterAction,
  isOnToolSuccessAction,
  isStageFullyCompleted,
  makeOnEnterKey,
  markActionsExecuted,
  normalizeActionsExecuted,
  normalizeActionsExecutedDetail,
  normalizeStageActionConfig,
  recordActionFailure,
  recordActionSuccess,
  shouldSkipActionIndex,
  type ActionsExecutedDetail,
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

  // RETROCOMPAT PR3: rows existentes que ja tinham stage_id no legacy
  // `actions_executed` ANTES da migration 053 continuam pulando. Detail
  // vazio combinado com legacy flag = "rodei tudo antes do tracking
  // detalhado", nao re-executa. Novas execucoes vao popular o detail.
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
  // PR2 (mai/2026): apenas acoes com trigger='on_enter' (ou ausente,
  // retrocompat) entram no disparo de entrada. As demais ficam dormentes
  // ate a tool correspondente rodar — vide runStageActionsOnToolSuccess.
  const onEnterActions = config.auto_actions.filter(isOnEnterAction);
  if (onEnterActions.length === 0) {
    // Sem acoes on_enter — ainda assim marca a etapa como "visitada" pra
    // proximas msgs pularem rapido sem nem ler o JSONB. Acoes
    // on_tool_success da mesma etapa ficam disponiveis pra disparo no
    // proximo tool success (NAO sao bloqueadas por actions_executed).
    await persistMark(params, executedSoFar, stage.id);
    return {
      executed: 0,
      failed: 0,
      nextOrderIndex: params.startingOrderIndex,
      skipped: false,
    };
  }

  // PR3 (mai/2026): per-action retry tracking via actions_executed_detail.
  // Carrega snapshot, filtra indices ja-resolvidos, executa pendentes
  // com persist imediato apos cada tentativa.
  const onEnterKey = makeOnEnterKey(stage.id);
  let workingDetail = normalizeActionsExecutedDetail(
    (agentConversation as AgentConversation & { actions_executed_detail?: unknown })
      .actions_executed_detail,
  );

  // Indexed pendings: preservam o original_index pra que recordSuccess
  // / recordFailure usem a posicao real na lista (ordem importa pra
  // retentativa de "ja rodei addtag mas falhou send_media" — addtag
  // continua em succeeded[0], send_media volta como failed[1]).
  const pending: Array<{ action: StageAutoAction; originalIndex: number }> = [];
  for (let i = 0; i < onEnterActions.length; i++) {
    const state = getStageActionState(workingDetail, onEnterKey);
    if (shouldSkipActionIndex(state, i)) continue;
    pending.push({ action: onEnterActions[i]!, originalIndex: i });
  }

  if (pending.length === 0) {
    // Todas as acoes ja resolvidas (sucesso OU max_retries exceeded).
    // Marca stage no legacy flag pra short-circuit nas proximas msgs.
    if (
      isStageFullyCompleted(
        getStageActionState(workingDetail, onEnterKey),
        onEnterActions.length,
      )
    ) {
      await persistMark(params, executedSoFar, stage.id);
    }
    return {
      executed: 0,
      failed: 0,
      nextOrderIndex: params.startingOrderIndex,
      skipped: true,
    };
  }

  let orderIndex = params.startingOrderIndex;
  let executed = 0;
  let failed = 0;
  let placeholderSkipDetected = false;

  // Context enriquecido reusado pra todas as acoes — paridade total
  // com o que executeToolCall passa pros handlers do LLM.
  const baseContext = {
    organization_id: params.orgId,
    lead_id: params.leadId,
    crm_conversation_id: params.crmConversationId,
    agent_conversation_id: agentConversation.id,
    run_id: params.runId,
    dry_run: params.dryRun,
    db: params.db,
    provider: params.provider ?? null,
    config: params.config,
    agentConversation,
    openaiClient: params.openaiClient ?? null,
  };

  for (const { action, originalIndex } of pending) {
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
          trigger: "stage_auto_action",
          action_index: originalIndex,
          error: errorMessage(err),
        });
      }
    }

    // Atualiza estado in-memory ANTES de logar step + persistir DB.
    // Ordem importante: se persist falhar, ainda temos o agent_step
    // logado pra audit, mesmo que retry seja perdido.
    if (result.success) {
      executed++;
      workingDetail = recordActionSuccess(workingDetail, onEnterKey, originalIndex);
    } else {
      failed++;
      const output = result.output as { placeholder_skip?: unknown } | null;
      if (output?.placeholder_skip === true) {
        // placeholder_skip NAO conta como attempt — config-bound, nao
        // transient. Retentaremos indefinidamente ate o user arrumar
        // o target_address. Mantemos o comportamento da PR1 #6.
        placeholderSkipDetected = true;
      } else {
        workingDetail = recordActionFailure(
          workingDetail,
          onEnterKey,
          originalIndex,
          result.error ?? "unknown error",
        );
      }
    }

    await params.insertStep({
      orgId: params.orgId,
      runId: params.runId,
      orderIndex: orderIndex++,
      stepType: "tool",
      toolId: null,
      nativeHandler: handlerName,
      input: { ...input, _trigger: "stage_auto_action", _action_index: originalIndex },
      output: result.success
        ? { success: true, ...result.output }
        : { success: false, error: result.error ?? "unknown error", ...result.output },
      durationMs: Date.now() - startedAt,
    });

    // PR3: persiste detail IMEDIATAMENTE apos cada tentativa. Se o run
    // crashar entre acoes, sucessos anteriores ficam gravados — re-
    // entrada na stage nao re-roda essas acoes. Custo: 1 UPDATE por
    // acao (~2-5 por stage tipica). Skip em dry-run (Tester) pra nao
    // poluir DB de prod.
    await persistActionsDetail({
      db: params.db,
      orgId: params.orgId,
      agentConversationId: agentConversation.id,
      detail: workingDetail,
      stageId: stage.id,
      actionIndex: originalIndex,
      dryRun: params.dryRun,
    });
    // Sincroniza in-memory pro caller (executor) ler estado atualizado.
    (agentConversation as AgentConversation & {
      actions_executed_detail?: unknown;
    }).actions_executed_detail = workingDetail;
  }

  // Decisao final: marcar stage como completa no array legacy?
  //  - placeholder_skip: nao marca (PR1 #6) — cliente arruma config + lead volta.
  //  - Caso contrario: marca SE todos os indices terminaram (succeeded
  //    OU exceeded retries). Se algum index ainda tem attempts < max,
  //    deixamos sem marcar — proxima entrada re-tenta.
  if (placeholderSkipDetected) {
    logError("stage_auto_actions_placeholder_skip", {
      organization_id: params.orgId,
      agent_conversation_id: params.agentConversation.id,
      stage_id: stage.id,
      executed,
      failed,
    });
  } else if (
    isStageFullyCompleted(
      getStageActionState(workingDetail, onEnterKey),
      onEnterActions.length,
    )
  ) {
    await persistMark(params, executedSoFar, stage.id);
  }

  return {
    executed,
    failed,
    nextOrderIndex: orderIndex,
    skipped: false,
  };
}

// ============================================================================
// PR3 helper: persiste actions_executed_detail apos cada tentativa
// ----------------------------------------------------------------------------
// Falha de persist NAO interrompe o loop — apenas loga. Custo: a
// proxima tentativa nao saberia que ja rodou, podendo duplicar side
// effects de handlers nao-idempotentes (send_media, trigger_notification).
// Aceitavel porque persist falhar e raro (DB outage); diluido em handler
// idempotente nao tem efeito.
// ============================================================================

interface PersistActionsDetailParams {
  db: AgentDb;
  orgId: string;
  agentConversationId: string;
  detail: ActionsExecutedDetail;
  stageId: string;
  actionIndex: number;
  dryRun: boolean;
}

async function persistActionsDetail(
  params: PersistActionsDetailParams,
): Promise<void> {
  if (params.dryRun) return;
  const { error } = await params.db
    .from("agent_conversations")
    .update({ actions_executed_detail: params.detail })
    .eq("id", params.agentConversationId)
    .eq("organization_id", params.orgId);
  if (error) {
    logError("stage_auto_action_detail_persist_failed", {
      organization_id: params.orgId,
      agent_conversation_id: params.agentConversationId,
      stage_id: params.stageId,
      action_index: params.actionIndex,
      error: error.message,
    });
  }
}

// ============================================================================
// Loop de execucao reusavel — usado tanto por on_enter quanto por
// on_tool_success.
// ----------------------------------------------------------------------------
// Recebe a lista de acoes ja filtradas e o `trigger` (string que vira no
// agent_steps.input._trigger pra audit). NAO toca em actions_executed —
// idempotency e responsabilidade do caller (so on_enter persiste mark).
// ============================================================================

interface RunActionsBatchParams {
  actions: StageAutoAction[];
  params: RunStageAutoActionsParams;
  agentConversation: AgentConversation;
  stage: AgentStage;
  /** Label do disparo logado em agent_steps.input._trigger. */
  trigger: "stage_auto_action" | "tool_success_action";
}

interface RunActionsBatchResult {
  executed: number;
  failed: number;
  nextOrderIndex: number;
  placeholderSkipDetected: boolean;
}

async function runActionsBatch(
  batch: RunActionsBatchParams,
): Promise<RunActionsBatchResult> {
  const { actions, params, agentConversation, stage, trigger } = batch;

  let orderIndex = params.startingOrderIndex;
  let executed = 0;
  let failed = 0;
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

  for (const action of actions) {
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
          trigger,
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
      input: { ...input, _trigger: trigger },
      output: result.success
        ? { success: true, ...result.output }
        : { success: false, error: result.error ?? "unknown error", ...result.output },
      durationMs: Date.now() - startedAt,
    });
  }

  return { executed, failed, nextOrderIndex: orderIndex, placeholderSkipDetected };
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

// ============================================================================
// runStageActionsOnToolSuccess — chamado APOS uma tool nativa retornar
// success=true em executeToolCall (apps/crm/src/lib/ai-agent/executor.ts).
// ----------------------------------------------------------------------------
// PR2 (mai/2026): resolve Bug #7. Antes desta PR, as auto_actions da
// etapa "Agendamento" disparavam ON_ENTER — bastava o lead entrar pra
// notificar a equipe que ele "agendou", mesmo que a IA so prometesse
// e nao chamasse create_appointment. Agora a notificacao pode ser
// configurada como trigger='on_tool_success' OF 'create_appointment' —
// so dispara quando o appointment EXISTE de fato no DB.
//
// Sem idempotency: cada sucesso da tool dispara as acoes ligadas. Se um
// lead agenda 2 reunioes na mesma conversa, recebe 2 notificacoes — e
// isso e o comportamento desejado (cada booking real e um evento real).
//
// Stage usado: o `current_stage_id` da conversa AO MOMENTO da chamada.
// Se a tool em si mudou o stage (transfer_to_stage), o caller deve usar
// detectStageTransitionAndRunActions DEPOIS pra rodar as on_enter da
// nova etapa.
// ============================================================================

export interface RunStageActionsOnToolSuccessParams {
  db: AgentDb;
  orgId: string;
  agentConversation: AgentConversation;
  config: AgentConfig;
  runId: string;
  leadId: string;
  crmConversationId: string;
  provider: WhatsAppProvider | null;
  openaiClient: OpenAI | null;
  dryRun: boolean;
  startingOrderIndex: number;
  insertStep: StepInserter;
  /** Nome do handler nativo que acabou de retornar success=true. */
  toolName: string;
}

export interface RunStageActionsOnToolSuccessResult {
  executed: number;
  failed: number;
  nextOrderIndex: number;
  /** True quando nao havia stage atual carregavel ou nenhuma acao
   * configurada — distinto de "rodou e falhou". */
  skipped: boolean;
}

export async function runStageActionsOnToolSuccess(
  params: RunStageActionsOnToolSuccessParams,
): Promise<RunStageActionsOnToolSuccessResult> {
  // Re-fetch do `current_stage_id` direto do DB: a tool que acabou de
  // rodar pode ter alterado a etapa (transfer_to_stage/transfer_to_agent)
  // — o snapshot em params.agentConversation pode estar desatualizado.
  // Defensive fallback: se o re-fetch falhar, usamos o snapshot.
  const { data: convRow } = await params.db
    .from("agent_conversations")
    .select("current_stage_id")
    .eq("id", params.agentConversation.id)
    .eq("organization_id", params.orgId)
    .maybeSingle();
  const stageId =
    (convRow as { current_stage_id?: string | null } | null)?.current_stage_id ??
    (params.agentConversation as AgentConversation & { current_stage_id?: string | null })
      .current_stage_id ??
    null;

  if (!stageId) {
    return {
      executed: 0,
      failed: 0,
      nextOrderIndex: params.startingOrderIndex,
      skipped: true,
    };
  }

  // Re-fetch da stage pra ler `action_config` mais recente.
  const { data: stageRow, error } = await params.db
    .from("agent_stages")
    .select("*")
    .eq("id", stageId)
    .eq("organization_id", params.orgId)
    .maybeSingle();

  if (error || !stageRow) {
    logError("stage_actions_on_tool_success_load_stage_failed", {
      organization_id: params.orgId,
      stage_id: stageId,
      tool: params.toolName,
      error: error?.message ?? "stage not found",
    });
    return {
      executed: 0,
      failed: 0,
      nextOrderIndex: params.startingOrderIndex,
      skipped: true,
    };
  }

  const stage = stageRow as unknown as AgentStage;
  const config = normalizeStageActionConfig(
    (stage as AgentStage & { action_config?: unknown }).action_config,
  );
  const matchingActions = config.auto_actions.filter((action) =>
    isOnToolSuccessAction(action, params.toolName),
  );
  if (matchingActions.length === 0) {
    return {
      executed: 0,
      failed: 0,
      nextOrderIndex: params.startingOrderIndex,
      skipped: true,
    };
  }

  // Reusa runActionsBatch — mesmo loop, mesma forma de logar steps. SEM
  // persistMark: idempotency e por-disparo da tool, nao por-etapa.
  const batchParams: RunStageAutoActionsParams = {
    db: params.db,
    orgId: params.orgId,
    agentConversation: params.agentConversation,
    stage,
    config: params.config,
    runId: params.runId,
    leadId: params.leadId,
    crmConversationId: params.crmConversationId,
    provider: params.provider,
    openaiClient: params.openaiClient,
    dryRun: params.dryRun,
    startingOrderIndex: params.startingOrderIndex,
    insertStep: params.insertStep,
  };

  const batchResult = await runActionsBatch({
    actions: matchingActions,
    params: batchParams,
    agentConversation: params.agentConversation,
    stage,
    trigger: "tool_success_action",
  });

  return {
    executed: batchResult.executed,
    failed: batchResult.failed,
    nextOrderIndex: batchResult.nextOrderIndex,
    skipped: false,
  };
}
