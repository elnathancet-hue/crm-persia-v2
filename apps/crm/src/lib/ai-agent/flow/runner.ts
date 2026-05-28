// AI Agent — flow runner.
//
// PR-FLOW-PIVOT PR 2 (mai/2026): interpreta o grafo (nodes + edges) node-a-node.
// Substitui o executor.ts antigo que era state-machine de stages. Aqui o
// fluxo é o cérebro: IA é apenas um tipo de node entre vários.
//
// V1 cobre:
//   - entry node (point of start, segue edge `default`)
//   - ai_agent node (LLM call + tool dispatch, segue edge `tool_success:<tool>`
//     ou `default` quando não chama tool)
//   - action node (dispara handler nativo, segue edge `default`)
//   - condition node (placeholder — V1 NÃO implementa, registra fatal_error)
//
// Loop principal: começa do entry, executa node atual, escolhe próximo via
// edges nomeadas, repete até hit_max_iterations OR não tem próximo node.

import OpenAI from "openai";
import type {
  FlowAIAgentNode,
  FlowActionNode,
  FlowConditionNode,
  FlowEntryNode,
  FlowNode,
  ToolExecutionMode,
} from "@persia/shared/ai-agent";
import {
  calculateCostUsdCents,
  findEntryNode,
  findOutgoingEdges,
  getNodeById,
} from "@persia/shared/ai-agent";
import { assertWithinCostLimits, type CostLimitCache } from "../cost-limits";
import type { AgentDb } from "../db";
import { GuardrailError } from "../guardrails";
import { buildNativeHandlerContext } from "./handler-context";
import { buildKnowledgeBlock } from "./knowledge-injector";
import { getOpenAiApiMode } from "./openai-api-mode";
import {
  runChatCompletionTurn,
  runResponsesTurn,
  toResponsesFunctionCallOutput,
  type AgentLlmInput,
  type AgentLlmOutput,
  type AgentLlmTool,
} from "./openai-runtime";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import {
  interpolateLeadPlaceholders,
  loadLeadForInterpolation,
} from "./lead-interpolation";
import { nativeHandlers } from "../tools/registry";
import { canAiSendNow } from "../send-guard";
import { buildConversationLlmMessages } from "../summarization";
import { stripToolCallLeaks } from "../tool-call-sanitizer";
import { evaluateCondition } from "./conditions";
import type {
  FlowRunContext,
  FlowRunOptions,
  FlowRunResult,
  TesterRunEvent,
} from "./types";

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_LLM_TOOL_PINGPONG = 5;

/**
 * Entry point do runtime. Carrega o node de partida (current_node_id ou
 * entry node do flow) e executa o grafo até terminar.
 */
export async function runFlow(
  db: AgentDb,
  ctx: FlowRunContext,
  startNodeId: string | null,
  options: FlowRunOptions = {},
): Promise<FlowRunResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  const result: FlowRunResult = {
    ending_node_id: null,
    assistant_reply: "",
    tool_calls_succeeded: 0,
    tool_calls_failed: 0,
    hit_max_iterations: false,
    tokens_input: 0,
    tokens_output: 0,
    events: ctx.provider.getEvents(), // referência live — runner adiciona via ctx.provider.emit
  };

  // Resolve node inicial: parametro explicito > current_node_id do agent_conversation > entry node do flow
  let currentNodeId = startNodeId;
  if (!currentNodeId) {
    const entry = findEntryNode(ctx.flowConfig);
    if (!entry) {
      result.fatal_error = "flow_sem_entry_node";
      return result;
    }
    currentNodeId = entry.id;
  }

  let iterations = 0;
  while (currentNodeId && iterations < maxIterations) {
    if (Date.now() - startedAt > timeoutMs) {
      result.fatal_error = "timeout";
      break;
    }
    iterations++;

    const node = getNodeById(ctx.flowConfig, currentNodeId);
    if (!node) {
      result.fatal_error = `node_not_found:${currentNodeId}`;
      break;
    }

    ctx.provider.emit({
      kind: "node_entered",
      payload: { node_id: node.id, node_type: node.type },
    });

    let nextNodeId: string | null = null;
    try {
      nextNodeId = await executeNode(db, ctx, node, result);
    } catch (err) {
      result.fatal_error = `node_error:${node.id}:${
        err instanceof Error ? err.message : String(err)
      }`;
      break;
    }

    ctx.provider.emit({
      kind: "node_exited",
      payload: { node_id: node.id, next_node_id: nextNodeId },
    });

    if (!nextNodeId) {
      // Flow terminou neste node (sem edge saindo). Salva como ending point.
      result.ending_node_id = node.id;
      break;
    }
    currentNodeId = nextNodeId;
    result.ending_node_id = nextNodeId; // overrided no próximo loop
  }

  if (iterations >= maxIterations && currentNodeId) {
    result.hit_max_iterations = true;
  }

  // Refresh events array snapshot — provider pode ter sido modificado
  result.events = ctx.provider.getEvents();
  return result;
}

// ============================================================================
// Dispatcher por tipo de node
// ============================================================================

async function executeNode(
  db: AgentDb,
  ctx: FlowRunContext,
  node: FlowNode,
  result: FlowRunResult,
): Promise<string | null> {
  switch (node.type) {
    case "entry":
      return executeEntryNode(ctx, node);
    case "ai_agent":
      return executeAIAgentNode(db, ctx, node, result);
    case "action":
      return executeActionNode(db, ctx, node, result);
    case "condition":
      return executeConditionNode(db, ctx, node, result);
  }
}

/**
 * PR-3 Auditoria (mai/2026): guard de ownership/handoff antes de cada
 * AI/action node. Endereca rodada 7 #alta #3 — tools rodavam mesmo com
 * human_handoff_active, so o send_text final era bloqueado. Agora os
 * nodes tambem abortam graciosamente.
 *
 * Skipa em dryRun (tester nao tem sendGuard) e quando sendGuard nao foi
 * injetado (caminho de teste antigo). Retorna fatal_error pro runner
 * encerrar o loop e o caller persistir como failed.
 */
async function assertCanAct(
  ctx: FlowRunContext,
  node: FlowNode,
  result: FlowRunResult,
): Promise<boolean> {
  if (ctx.dryRun || !ctx.sendGuard) return true;
  const verdict = await canAiSendNow(ctx.sendGuard);
  if (verdict.ok) return true;
  result.fatal_error = `human_handoff_active:${verdict.reason}`;
  ctx.provider.emit({
    kind: "guardrail",
    payload: {
      reason: "human_handoff_active",
      block_reason: verdict.reason,
      node_id: node.id,
      node_type: node.type,
    },
  });
  return false;
}

// ============================================================================
// Entry node — segue edge "default"
// ============================================================================

function executeEntryNode(ctx: FlowRunContext, node: FlowEntryNode): string | null {
  const edges = findOutgoingEdges(ctx.flowConfig, node.id, "default");
  return edges[0]?.target ?? null;
}

// ============================================================================
// AI Agent node — LLM call + tool dispatch
// ============================================================================

interface LoadedToolRow {
  id: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  // Backlog #7 Auditoria (mai/2026): usa o tipo compartilhado em vez do
  // literal local. Migration 062 ja garante que o DB so aceita esses 3
  // valores via CHECK constraint.
  execution_mode: ToolExecutionMode;
  native_handler: string | null;
  /** PR 15 (mai/2026): set quando execution_mode='mcp'. */
  mcp_server_id?: string | null;
}

async function loadEnabledTools(
  db: AgentDb,
  ctx: FlowRunContext,
): Promise<LoadedToolRow[]> {
  const ids = ctx.flowConfig.enabled_tools;
  const ToolSelect =
    "id, name, description, input_schema, execution_mode, native_handler, mcp_server_id, is_enabled";

  let tools: Array<LoadedToolRow & { is_enabled: boolean }> = [];
  if (ids.length > 0) {
    const { data, error } = await db
      .from("agent_tools")
      .select(ToolSelect)
      .eq("organization_id", ctx.organizationId)
      .in("id", ids);
    if (error) throw new Error(`Falha ao carregar tools: ${error.message}`);
    tools = (data ?? []) as typeof tools;
  }

  // PR-6 Auditoria (mai/2026): defense-in-depth pro emit_event.
  // Endereca rodada 3 #2 + #3 do POST_CODEX_AUDIT — flows com AI node
  // que tem instructions[] (handles nomeados) dependem da tool emit_event
  // estar no modelo. Se o cliente desenhou o canvas mas esqueceu de
  // adicionar a tool a enabled_tools (ou a UI nao expoe esse toggle),
  // o LLM nao recebe a tool e os branches morrem silenciosamente.
  //
  // Auto-incluir aqui (sem mexer no enabled_tools persistido) garante
  // que qualquer AI node com instructions sempre consegue emitir handles.
  // emit_event nao tem side effects — e seguro forcar.
  const needsEmitEvent = ctx.flowConfig.nodes.some((node) => {
    if (node.type !== "ai_agent") return false;
    const data = node.data as { instructions?: Array<unknown> } | undefined;
    return (data?.instructions?.length ?? 0) > 0;
  });
  const hasEmitEvent = tools.some((t) => t.native_handler === "emit_event");
  if (needsEmitEvent && !hasEmitEvent) {
    const { data, error } = await db
      .from("agent_tools")
      .select(ToolSelect)
      .eq("organization_id", ctx.organizationId)
      .eq("config_id", ctx.agentConfigId)
      .eq("native_handler", "emit_event")
      .maybeSingle();
    if (!error && data) {
      tools.push(data as LoadedToolRow & { is_enabled: boolean });
    }
  }

  return tools
    .filter((t) => t.is_enabled !== false)
    .map(({ is_enabled: _ignore, ...rest }) => rest);
}

async function loadAgentConfig(
  db: AgentDb,
  ctx: FlowRunContext,
): Promise<{ model: string; system_prompt: string }> {
  const { data, error } = await db
    .from("agent_configs")
    .select("model, system_prompt")
    .eq("organization_id", ctx.organizationId)
    .eq("id", ctx.agentConfigId)
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message || "agent_config não encontrado");
  }
  const row = data as { model: string; system_prompt: string };
  return {
    model: row.model,
    system_prompt: row.system_prompt ?? "",
  };
}

function getOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não configurada");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function executeAIAgentNode(
  db: AgentDb,
  ctx: FlowRunContext,
  node: FlowAIAgentNode,
  result: FlowRunResult,
): Promise<string | null> {
  // PR-3 Auditoria (mai/2026): bloqueia AI node se ownership mudou.
  // Sem isso, LLM e tool calls rodavam mesmo com human_handoff_active —
  // so o send_text final batia no last-mile guard.
  if (!(await assertCanAct(ctx, node, result))) return null;

  // PR-FLOW-PIVOT PR 11 (mai/2026): se o flow foi disparado por evento
  // CRM (stage transition, segment entry), inboundMessage.text vem
  // vazio — não há msg do lead pra IA reagir. Skip LLM call gracioso +
  // segue edge default. Cliente deve desenhar flows event-driven
  // começando com action node (ex: send_whatsapp_message proativo).
  if (!ctx.inboundMessage.text.trim()) {
    ctx.provider.emit({
      kind: "guardrail",
      payload: {
        reason: "ai_node_skipped_no_inbound",
        node_id: node.id,
        hint: "flow disparado por evento CRM (sem msg inbound) — desenhe começando com action node",
      },
    });
    return followDefaultEdge(ctx, node);
  }

  const [agentConfig, tools, knowledgeBlock] = await Promise.all([
    loadAgentConfig(db, ctx),
    loadEnabledTools(db, ctx),
    // Knowledge inject (mai/2026): consulta a base de conhecimento do
    // agente e devolve um bloco formatado pra incluir no system prompt.
    // Retorna null se: agente sem docs anexados, retrieval falhou
    // (Voyage/network), ou modo 'rag' sem hits acima do threshold.
    // Modo default ('full') concatena todos chunks — funciona pra
    // FAQs e proposta comercial (caso uso típico do cliente).
    // Roda em paralelo com loadAgentConfig/loadEnabledTools pra não
    // somar latência ao caminho crítico do AI node.
    buildKnowledgeBlock(
      db,
      ctx.organizationId,
      ctx.agentConfigId,
      ctx.inboundMessage.text,
    ),
  ]);
  const client = getOpenAIClient();
  const model = node.data.model ?? agentConfig.model;

  // Montagem do system prompt: node-specific prompt + instructions +
  // agent base. O prompt geral do agente vem por ultimo de proposito:
  // ele e a fonte editavel em Configuracoes para persona/regras globais
  // e deve prevalecer sobre prompts locais antigos gravados no Fluxo.
  // PR-FLOW-PIVOT PR 7 (mai/2026): listamos eventos como
  // "EVENTS TO EMIT" pra IA saber EXATAMENTE quais handles usar com
  // a tool emit_event(handle_name).
  const systemParts: string[] = [];
  if (node.data.system_prompt.trim()) systemParts.push(node.data.system_prompt.trim());
  if (node.data.instructions.length > 0) {
    const list = node.data.instructions
      .map((i, idx) =>
        `${idx + 1}. handle "${i.output_handle}" → ${i.description}`,
      )
      .join("\n");
    systemParts.push(
      `EVENTS TO EMIT (call emit_event with the matching handle when the condition is met):\n${list}`,
    );
  }
  if (agentConfig.system_prompt.trim()) systemParts.push(agentConfig.system_prompt.trim());
  // Knowledge inject (mai/2026): bloco "BASE DE CONHECIMENTO" entra
  // logo após o prompt-base do agente — assim a IA já leu persona +
  // regras gerais e agora ganha contexto factual antes de pensar.
  // Buildado em paralelo com agentConfig/tools acima.
  if (knowledgeBlock) systemParts.push(knowledgeBlock);
  // Bug D fix (mai/2026): warning explícito pra evitar vazamento de
  // tool call como texto. Modelos novos (gpt-5*, gpt-4o*) às vezes
  // retornam `tool_calls` E `content` no mesmo turno — o content
  // "pensa em voz alta" e a IA escreve `emit_event("foo")` como
  // texto literal. Visto em prod com gpt-5-mini. Tool-call-sanitizer
  // strippa em camada 3 (defensa em depth), mas reforçar no prompt
  // reduz frequência.
  systemParts.push(
    [
      "IMPORTANT — TOOL USAGE RULES:",
      "- NEVER write tool names (emit_event, add_tag, move_pipeline_stage, etc) as literal text in your reply to the user.",
      "- NEVER write handle names like coletou_idade or dados_completos in plain text.",
      "- Tool calls are SILENT — they use the function_call mechanism, not the message body.",
      "- If you need to call a tool, just call it. The user must NEVER see the tool name in the chat.",
    ].join("\n"),
  );

  // Backlog #1 (mai/2026) — endereca rodada 6 #critica #2 (multi-turn quebrado).
  // Antes, AI node sempre mandava apenas [{system}, {user: inbound atual}] —
  // IA esquecia tudo entre turns. Cliente migrando de behavior_mode=actions
  // (que tinha history) caia do precipicio: lead diz "meu nome e Joao" na
  // msg 1, IA pergunta "qual seu nome?" na msg 2.
  //
  // Agora carrega historico via buildConversationLlmMessages — injeta
  // history_summary (quando presente, como contexto consolidado) +
  // ultimas N mensagens da CRM conversation. N controlado por
  // clampRecentMessagesCount em agent_configs.context_summary_recent_messages
  // (default 20).
  //
  // Defensive: tester (sem agentConfig/agentConversation populados) ou
  // caminho legacy cai pro fallback simples [{user: inbound}].
  let historyMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (ctx.agentConfig && ctx.agentConversation) {
    try {
      historyMessages = (await buildConversationLlmMessages({
        db,
        orgId: ctx.organizationId,
        agentConversation: ctx.agentConversation,
        config: ctx.agentConfig,
      })) as OpenAI.Chat.ChatCompletionMessageParam[];
    } catch (err) {
      // Best-effort: falha em carregar history NAO quebra o turn — IA
      // responde sem contexto. Log estruturado pra observabilidade.
      ctx.provider.emit({
        kind: "guardrail",
        payload: {
          reason: "history_load_failed",
          message: err instanceof Error ? err.message : String(err),
          node_id: node.id,
        },
      });
    }
  }

  // Se o history ja contem a inbound message atual (foi inserida em
  // executor step 8 antes do flush), nao duplica. Caso contrario
  // (tester, edge cases), append manual.
  const lastUserMsg = [...historyMessages].reverse().find((m) => m.role === "user");
  const inboundAlreadyInHistory =
    typeof lastUserMsg?.content === "string" &&
    lastUserMsg.content.includes(ctx.inboundMessage.text);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemParts.join("\n\n") },
    ...historyMessages,
    ...(inboundAlreadyInHistory
      ? []
      : [{ role: "user" as const, content: ctx.inboundMessage.text }]),
  ];

  const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));

  // PR 4 do plano docs/ai-agent/11-openai-responses-migration.md (mai/2026):
  // tools no shape neutro pro adapter — vale pra chat e responses.
  //
  // PR 5 prep (mai/2026): omitimos `strict` pra que o adapter aplique seu
  // default (`true` no caminho Responses, after PR #381 deixar schemas
  // strict-ready). Chat Completions ignora o flag.
  const adapterTools: AgentLlmTool[] = tools.map((t) => ({
    name: t.name,
    description: t.description ?? null,
    parameters: t.input_schema as Record<string, unknown>,
  }));

  // Mapa de tool name → row pra resolver native_handler depois.
  const toolByName = new Map(tools.map((t) => [t.name, t]));

  // PR 4 do plano docs/ai-agent/11-openai-responses-migration.md:
  // modo "chat" (default) vs "responses" (opt-in via env). Decisão antes
  // do loop pra não re-ler env a cada iteração.
  const apiMode = getOpenAiApiMode();
  // Pra Responses ping-pong stateless (PR #380): mantém items separados
  // (`function_call` retornados + `function_call_output` injetados pós-handler)
  // pra próxima iteração receber via `responsesInputItems`.
  const responsesPendingItems: ResponseInputItem[] = [];

  let lastSuccessfulToolName: string | null = null;
  // PR-FLOW-PIVOT PR 7 (mai/2026): se a IA chamar emit_event(handle),
  // o runner sobrescreve a edge a seguir pelo `<handle>` (não pelo
  // tool_success:emit_event). Captura aqui pra usar depois do loop.
  let emittedHandleName: string | null = null;

  // PR-2 Auditoria (mai/2026): cache de limites entre ping-pongs.
  // assertWithinCostLimits re-carregaria agent_cost_limits + agent_usage_daily
  // a cada chamada — cache evita N x SELECT em cada iter do loop.
  const costLimitCache: CostLimitCache = {};

  for (let iter = 0; iter < MAX_LLM_TOOL_PINGPONG; iter++) {
    const llmStart = Date.now();
    ctx.provider.emit({
      kind: "llm_call",
      payload: { iteration: iter, model, message_count: messages.length },
    });

    // PR-2 Auditoria (mai/2026): cap por chamada LLM. Sem cap, modelos
    // de reasoning (gpt-5*) consomem ate a janela inteira por turn
    // (rodada 6 #4). Default 4096 cobre reasoning + output medio sem
    // truncar respostas comuns.
    //
    // PR 4 do plano docs/ai-agent/11-openai-responses-migration.md:
    // delega pra adapter `runChatCompletionTurn` / `runResponsesTurn`
    // baseado em `apiMode`. Adapter já lida com `max_completion_tokens`
    // (gpt-5*) vs `max_tokens` (gpt-4o*) e `max_output_tokens` (responses).
    const adapterInput: AgentLlmInput = {
      model,
      // Extrai system da primeira msg (sempre presente — buildada acima).
      // Adapter re-prepende como mensagem system OU usa como `instructions`
      // (Responses) — caller não precisa duplicar.
      system: extractSystem(messages),
      messages: messages.filter((m) => m.role !== "system"),
      tools: adapterTools,
      maxOutputTokens: 4096,
      // Responses ping-pong: passa items pendentes (function_call retornados +
      // function_call_output gerados nos handlers da iteração anterior).
      ...(apiMode === "responses" && responsesPendingItems.length > 0
        ? { responsesInputItems: [...responsesPendingItems] }
        : {}),
    };
    let llmOutput: AgentLlmOutput;
    try {
      llmOutput =
        apiMode === "responses"
          ? await runResponsesTurn(client, adapterInput)
          : await runChatCompletionTurn(client, adapterInput);
    } catch (err) {
      result.fatal_error = `llm_call_failed:${
        err instanceof Error ? err.message : String(err)
      }`;
      ctx.provider.emit({
        kind: "guardrail",
        payload: {
          reason: "llm_call_failed",
          provider_mode: apiMode,
          message: err instanceof Error ? err.message : String(err),
        },
      });
      return null;
    }
    const llmDuration = Date.now() - llmStart;
    const tokensIn = llmOutput.usage.inputTokens;
    const tokensOut = llmOutput.usage.outputTokens;
    result.tokens_input += tokensIn;
    result.tokens_output += tokensOut;
    ctx.provider.emit({
      kind: "llm_call",
      payload: {
        iteration: iter,
        finish_reason: llmOutput.finishKind,
        provider_mode: apiMode,
        duration_ms: llmDuration,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
      },
    });

    // PR-2 Auditoria (mai/2026): intra-loop cost ceiling check.
    // Endereca rodada 6 #critica #1 — ceiling per-run + agregados precisam
    // ser enforced ANTES da proxima chamada LLM. Sem isso, um ping-pong
    // longo (5 iters x N tokens) pode estourar o ceiling sem nenhum
    // bloqueio. Tester nao roda este check porque dry_run nao deve ser
    // gated por ceiling de producao.
    if (!ctx.dryRun) {
      const costSoFarCents = calculateCostUsdCents(
        model,
        result.tokens_input,
        result.tokens_output,
      );
      try {
        await assertWithinCostLimits({
          db,
          orgId: ctx.organizationId,
          configId: ctx.agentConfigId,
          agentConversationId: ctx.agentConversationId,
          tokensSoFarRun: result.tokens_input + result.tokens_output,
          costSoFarRunUsdCents: costSoFarCents,
          cache: costLimitCache,
        });
      } catch (err) {
        if (err instanceof GuardrailError) {
          result.fatal_error = `cost_ceiling:${err.reason}`;
          ctx.provider.emit({
            kind: "guardrail",
            payload: {
              reason: "cost_ceiling",
              trip_reason: err.reason,
              message: err.message,
              node_id: node.id,
              tokens_so_far: result.tokens_input + result.tokens_output,
              cost_so_far_cents: costSoFarCents,
            },
          });
          return null;
        }
        throw err;
      }
    }

    // PR 4: shape normalizado pelo adapter — `llmOutput.finishKind`
    // ("final"|"tool_calls"|"incomplete"), `llmOutput.text`, `llmOutput.toolCalls`.
    // `responsesInputItems` populated apenas em modo responses (function_call items).

    // Caso 1: LLM emitiu texto final (sem tool call). Send + segue edge default.
    if (llmOutput.finishKind !== "tool_calls") {
      const rawText = (llmOutput.text ?? "").trim();
      // Bug D fix (mai/2026): strippa tool calls escritas como texto
      // (emit_event(...), add_tag(...), etc) antes de enviar pro user.
      // Loga em guardrail event pra medir frequência da alucinação.
      const { cleaned: text, leakedPatterns } = stripToolCallLeaks(rawText);
      if (leakedPatterns.length > 0) {
        ctx.provider.emit({
          kind: "guardrail",
          payload: {
            reason: "tool_call_leak_stripped",
            count: leakedPatterns.length,
            patterns: leakedPatterns,
            node_id: node.id,
          },
        });
      }
      if (text) {
        result.assistant_reply += result.assistant_reply ? "\n" + text : text;
        ctx.provider.emit({
          kind: "send_text",
          payload: { message: text },
        });
      }
      break;
    }

    // Caso 2: LLM pediu tool calls.
    // - Mode "chat": espelha histórico em `messages[]` (role=assistant + role=tool)
    //   pra próxima iter via Chat Completions API.
    // - Mode "responses": acumula `function_call` items retornados (em
    //   `llmOutput.responsesInputItems`) + cria `function_call_output` por
    //   handler em `responsesPendingItems` pra ping-pong stateless (PR #380).
    if (apiMode === "chat") {
      // Reconstrói as tool_calls no formato Chat Completions a partir do output normalizado.
      messages.push({
        role: "assistant",
        content: llmOutput.text || null,
        tool_calls: llmOutput.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.argumentsJson },
        })),
      } as OpenAI.Chat.ChatCompletionMessageParam);
    } else {
      // Mode responses: acumula function_call items (vindos do output).
      responsesPendingItems.push(...llmOutput.responsesInputItems);
    }

    for (const call of llmOutput.toolCalls) {
      const toolRow = toolByName.get(call.name);
      const callId = call.id;
      let toolArgs: Record<string, unknown> = {};
      try {
        toolArgs = call.argumentsJson
          ? (JSON.parse(call.argumentsJson) as Record<string, unknown>)
          : {};
      } catch (parseErr) {
        const errOutput = { success: false, error: "invalid_json_arguments" };
        ctx.provider.emit({
          kind: "tool_result",
          payload: {
            tool_call_id: callId,
            tool_name: call.name,
            success: false,
            error: "invalid_json_arguments",
            details: parseErr instanceof Error ? parseErr.message : String(parseErr),
          },
        });
        if (apiMode === "chat") {
          messages.push({
            role: "tool",
            tool_call_id: callId,
            content: JSON.stringify(errOutput),
          });
        } else {
          responsesPendingItems.push(toResponsesFunctionCallOutput(callId, errOutput));
        }
        result.tool_calls_failed++;
        continue;
      }

      ctx.provider.emit({
        kind: "tool_call",
        payload: {
          tool_call_id: callId,
          tool_name: call.name,
          input: toolArgs,
        },
      });

      if (!toolRow) {
        const errOutput = { success: false, error: "tool_not_in_allowlist" };
        ctx.provider.emit({
          kind: "tool_result",
          payload: {
            tool_call_id: callId,
            tool_name: call.name,
            success: false,
            error: "tool_not_in_allowlist",
          },
        });
        if (apiMode === "chat") {
          messages.push({
            role: "tool",
            tool_call_id: callId,
            content: JSON.stringify(errOutput),
          });
        } else {
          responsesPendingItems.push(toResponsesFunctionCallOutput(callId, errOutput));
        }
        result.tool_calls_failed++;
        continue;
      }

      const handlerResult = await dispatchToolCall(db, ctx, toolRow, toolArgs);
      const resultPayload = {
        tool_call_id: callId,
        tool_name: call.name,
        success: handlerResult.success,
        output: handlerResult.output,
        error: handlerResult.error,
        side_effects: handlerResult.side_effects,
      };
      ctx.provider.emit({ kind: "tool_result", payload: resultPayload });
      const toolReplyContent = {
        success: handlerResult.success,
        output: handlerResult.output,
        error: handlerResult.error,
      };
      if (apiMode === "chat") {
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify(toolReplyContent),
        });
      } else {
        responsesPendingItems.push(toResponsesFunctionCallOutput(callId, toolReplyContent));
      }

      if (handlerResult.success) {
        result.tool_calls_succeeded++;
        lastSuccessfulToolName = call.name;
        // PR-FLOW-PIVOT PR 7 (mai/2026): se foi emit_event, captura o
        // handle_name pra sobrescrever a edge a seguir.
        if (call.name === "emit_event") {
          const emittedHandle = (handlerResult.output as { handle_name?: string })
            ?.handle_name;
          if (typeof emittedHandle === "string" && emittedHandle.length > 0) {
            emittedHandleName = emittedHandle;
          }
        }
      } else {
        result.tool_calls_failed++;
      }
    }
  }

  // Decide próximo node. Ordem de prioridade:
  //   1. PR 7 (mai/2026): emit_event(handle) → segue edge `<handle>` direto
  //      (sem prefixo tool_success:). Permite handles nomeados que o
  //      cliente configurou nas instructions[] do node IA.
  //   2. tool_success:<tool_name> da última tool bem-sucedida (PR 2).
  //   3. edge `default` (fallback quando IA só respondeu texto).
  if (emittedHandleName) {
    const handleEdges = findOutgoingEdges(ctx.flowConfig, node.id, emittedHandleName);
    if (handleEdges[0]) {
      ctx.provider.emit({
        kind: "edge_traversed",
        payload: {
          from: node.id,
          to: handleEdges[0].target,
          handle: emittedHandleName,
          via: "emit_event",
        },
      });
      return handleEdges[0].target;
    }
    // Edge cadastrada não existe — loga warning + cai pro fluxo normal
    // (tool_success → default). LLM pode ter inventado handle.
    ctx.provider.emit({
      kind: "guardrail",
      payload: {
        reason: "emit_event_handle_no_edge",
        handle: emittedHandleName,
      },
    });
  }
  if (lastSuccessfulToolName && lastSuccessfulToolName !== "emit_event") {
    const successHandle = `tool_success:${lastSuccessfulToolName}`;
    const successEdges = findOutgoingEdges(ctx.flowConfig, node.id, successHandle);
    if (successEdges[0]) {
      ctx.provider.emit({
        kind: "edge_traversed",
        payload: {
          from: node.id,
          to: successEdges[0].target,
          handle: successHandle,
        },
      });
      return successEdges[0].target;
    }
  }
  const defaultEdges = findOutgoingEdges(ctx.flowConfig, node.id, "default");
  if (defaultEdges[0]) {
    ctx.provider.emit({
      kind: "edge_traversed",
      payload: { from: node.id, to: defaultEdges[0].target, handle: "default" },
    });
    return defaultEdges[0].target;
  }
  return null;
}

async function dispatchToolCall(
  db: AgentDb,
  ctx: FlowRunContext,
  toolRow: LoadedToolRow,
  input: Record<string, unknown>,
): Promise<{
  success: boolean;
  output: Record<string, unknown>;
  side_effects?: string[];
  error?: string;
}> {
  if (toolRow.execution_mode === "native") {
    if (!toolRow.native_handler) {
      return {
        success: false,
        output: {},
        error: "native_tool_sem_handler",
      };
    }
    const handler =
      nativeHandlers[toolRow.native_handler as keyof typeof nativeHandlers];
    if (!handler) {
      return {
        success: false,
        output: {},
        error: `handler_não_implementado:${toolRow.native_handler}`,
      };
    }
    try {
      // PR-5 (mai/2026): handler context enriquecido com db + provider +
      // config + agentConversation + openaiClient. Antes, ctx minimo
      // fazia getHandlerDb(context) retornar null → "database context
      // missing" em add_tag, move_pipeline_stage, set_lead_custom_field
      // etc. Agora handlers funcionam de verdade.
      return await handler(buildNativeHandlerContext(db, ctx), input);
    } catch (err) {
      return {
        success: false,
        output: {},
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // PR-FLOW-PIVOT PR 15 (mai/2026): MCP tool — chama servidor externo
  // via JSON-RPC tools/call. Server endpoint + auth carregados da
  // mcp_server_connections row referenciada.
  if (toolRow.execution_mode === "mcp") {
    if (!toolRow.mcp_server_id) {
      return {
        success: false,
        output: {},
        error: "mcp_tool_sem_server_id",
      };
    }
    // Dry-run (Tester) — não chama servidor externo, simula.
    if (ctx.dryRun) {
      return {
        success: true,
        output: { simulated: true, mcp_tool: toolRow.name, input },
        side_effects: [`(dry_run) would call MCP tool "${toolRow.name}" with input`],
      };
    }
    try {
      const { data: connRow, error: connErr } = await db
        .from("mcp_server_connections")
        .select("server_url, auth_type, auth_token, is_active")
        .eq("organization_id", ctx.organizationId)
        .eq("id", toolRow.mcp_server_id)
        .maybeSingle();
      if (connErr || !connRow) {
        return {
          success: false,
          output: {},
          error: `mcp_server_not_found:${toolRow.mcp_server_id}`,
        };
      }
      const conn = connRow as {
        server_url: string;
        auth_type: "none" | "bearer";
        auth_token: string | null;
        is_active: boolean;
      };
      if (!conn.is_active) {
        return {
          success: false,
          output: {},
          error: "mcp_server_inactive",
        };
      }
      // Import dinâmico pra não inflar bundle (MCP só é usado se cliente
      // configurar).
      const { callTool, extractTextFromResult } = await import("@/lib/mcp/client");
      const result = await callTool(
        {
          server_url: conn.server_url,
          auth_type: conn.auth_type,
          auth_token: conn.auth_token,
        },
        toolRow.name,
        input,
      );
      const text = extractTextFromResult(result);
      if (result.isError) {
        return {
          success: false,
          output: { mcp_result: text },
          error: text || "mcp_tool_returned_error",
        };
      }
      return {
        success: true,
        output: { mcp_result: text, raw_content: result.content },
      };
    } catch (err) {
      return {
        success: false,
        output: {},
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Webhook custom — fora do escopo V1, retorna erro amigável.
  return {
    success: false,
    output: {},
    error: "webhook_tools_não_implementadas_no_pivot_v1",
  };
}

// ============================================================================
// Action node — dispara handler determinístico (sem passar pela IA)
// ============================================================================

async function executeActionNode(
  db: AgentDb,
  ctx: FlowRunContext,
  node: FlowActionNode,
  result: FlowRunResult,
): Promise<string | null> {
  // PR-3 Auditoria (mai/2026): bloqueia action node se ownership mudou.
  // Especialmente importante porque actions mutam DB (add_tag,
  // move_pipeline_stage, etc) — operador em controle nao quer ver
  // estado mudando "em nome da IA" depois que assumiu a conversa.
  if (!(await assertCanAct(ctx, node, result))) return null;

  const actionType = node.data.action_type;

  // PR-FLOW-PIVOT PR 9 (mai/2026): action node standalone que envia
  // mensagem WhatsApp literal. NÃO usa native handler — emite `send_text`
  // direto pelo ctx.provider (igual a IA quando responde). Realtime
  // provider já cuida de: split por humanization, sendText via
  // WhatsAppProvider, persistir em messages com sender='ai'.
  //
  // Tratado ANTES do dispatch genérico pra evitar passar pela cadeia de
  // native handlers (que não tem acesso ao WhatsAppProvider no V1).
  if (actionType === "send_whatsapp_message") {
    return executeSendWhatsappMessageAction(db, ctx, node, result);
  }

  // Mapeamento direto FlowActionType → NativeHandlerName quando possível.
  const directHandlers: Partial<Record<typeof actionType, keyof typeof nativeHandlers>> = {
    add_tag: "add_tag",
    // PR-6 Auditoria (mai/2026): remove_tag agora tem handler nativo
    // (rodada 1 #3 + rodada 4 matriz). Antes era guardrail silencioso.
    remove_tag: "remove_tag",
    move_pipeline_stage: "move_pipeline_stage",
    create_appointment: "create_appointment",
    trigger_notification: "trigger_notification",
    send_media: "send_media",
    stop_agent: "stop_agent",
    transfer_to_user: "transfer_to_user",
    transfer_to_agent: "transfer_to_agent",
    // PR-FLOW-PIVOT PR 8 (mai/2026)
    set_lead_custom_field: "set_lead_custom_field",
    // PR-FLOW-PIVOT PR 9 (mai/2026): `send_whatsapp_message` é tratado
    // por special-case acima (executeSendWhatsappMessageAction) — emite
    // send_text via ctx.provider em vez de handler nativo, reusando a
    // plumbing já testada do realtime-provider (split + DB persist).

    // PR-FLOW-PIVOT PR 13 (mai/2026)
    round_robin_user: "round_robin_user",
  };

  const handlerKey = directHandlers[actionType];
  if (!handlerKey) {
    ctx.provider.emit({
      kind: "guardrail",
      payload: {
        reason: "action_type_não_implementado_v1",
        action_type: actionType,
      },
    });
    return followDefaultEdge(ctx, node);
  }

  const handler = nativeHandlers[handlerKey];
  if (!handler) {
    ctx.provider.emit({
      kind: "guardrail",
      payload: {
        reason: "handler_não_registrado",
        handler: handlerKey,
      },
    });
    return followDefaultEdge(ctx, node);
  }

  ctx.provider.emit({
    kind: "tool_call",
    payload: {
      tool_call_id: `action:${node.id}`,
      tool_name: actionType,
      input: node.data.config,
      via: "action_node",
    },
  });

  let handlerResult;
  try {
    // PR-5 (mai/2026): action node tambem usa o contexto enriquecido.
    // Especialmente importante porque action nodes mutam DB diretamente
    // (sem ping-pong de LLM no meio) — sem db, falham silenciosamente
    // com guardrail event que o cliente nao ve.
    handlerResult = await handler(
      buildNativeHandlerContext(db, ctx),
      node.data.config,
    );
  } catch (err) {
    handlerResult = {
      success: false,
      output: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }

  ctx.provider.emit({
    kind: "tool_result",
    payload: {
      tool_call_id: `action:${node.id}`,
      tool_name: actionType,
      success: handlerResult.success,
      output: handlerResult.output,
      error: handlerResult.error,
      via: "action_node",
    },
  });
  if (handlerResult.success) {
    result.tool_calls_succeeded++;
  } else {
    result.tool_calls_failed++;
  }

  return followDefaultEdge(ctx, node);
}

// ============================================================================
// PR-FLOW-PIVOT PR 9 (mai/2026): action node standalone "Enviar mensagem
// WhatsApp" — texto literal com placeholders {{lead.X}}.
// ============================================================================
//
// Por que special-case em vez de native handler: o WhatsAppProvider é
// criado em executor.ts e injetado no realtime-provider — não chega ao
// handler context. Em vez de mudar a assinatura de NativeHandler pra
// passar provider (mudança invasiva em shared types), emitimos
// `send_text` direto no ctx.provider. Realtime provider já trata:
// split, sendText real, persist em messages. Tester provider trata como
// "Bot diria: ..." (preview sem envio).

async function executeSendWhatsappMessageAction(
  db: AgentDb,
  ctx: FlowRunContext,
  node: FlowActionNode,
  result: FlowRunResult,
): Promise<string | null> {
  const config = node.data.config;
  const rawMessage =
    typeof config.message === "string" ? config.message.trim() : "";

  ctx.provider.emit({
    kind: "tool_call",
    payload: {
      tool_call_id: `action:${node.id}`,
      tool_name: "send_whatsapp_message",
      input: { message_length: rawMessage.length },
      via: "action_node",
    },
  });

  if (!rawMessage) {
    ctx.provider.emit({
      kind: "tool_result",
      payload: {
        tool_call_id: `action:${node.id}`,
        tool_name: "send_whatsapp_message",
        success: false,
        error: "empty_message",
        via: "action_node",
      },
    });
    result.tool_calls_failed++;
    return followDefaultEdge(ctx, node);
  }

  // Backlog #12 Auditoria (mai/2026): load + interpolate movidos pra
  // helper compartilhado (flow/lead-interpolation.ts) pra reuso em
  // set_lead_custom_field e outros handlers que precisarem.
  const lead = await loadLeadForInterpolation(
    db,
    ctx.organizationId,
    ctx.leadId,
  );
  const interpolated = interpolateLeadPlaceholders(rawMessage, lead);

  // Emite send_text — realtime-provider envia + persiste, tester-provider
  // só registra evento.
  ctx.provider.emit({
    kind: "send_text",
    payload: { message: interpolated, via: "action_node" },
  });

  result.assistant_reply += result.assistant_reply
    ? "\n" + interpolated
    : interpolated;

  ctx.provider.emit({
    kind: "tool_result",
    payload: {
      tool_call_id: `action:${node.id}`,
      tool_name: "send_whatsapp_message",
      success: true,
      output: { message_length: interpolated.length },
      via: "action_node",
    },
  });
  result.tool_calls_succeeded++;

  return followDefaultEdge(ctx, node);
}

function followDefaultEdge(
  ctx: FlowRunContext,
  node: FlowNode,
): string | null {
  const edges = findOutgoingEdges(ctx.flowConfig, node.id, "default");
  if (edges[0]) {
    ctx.provider.emit({
      kind: "edge_traversed",
      payload: { from: node.id, to: edges[0].target, handle: "default" },
    });
    return edges[0].target;
  }
  return null;
}

// ============================================================================
// Condition node — avalia regra contra o lead e segue edge `yes` ou `no`
// ============================================================================
//
// PR-FLOW-PIVOT PR 5 (mai/2026): runtime das 3 condicionais (has_tag,
// lead_custom_field_equals, in_segment). Avaliação delegada pra
// `flow/conditions.ts` que conhece schema do CRM. Resultado boolean
// escolhe o handle:
//   - `true`  → edge `yes`
//   - `false` → edge `no`
//
// Se a edge alvo não existe (cliente conectou só um lado), flow
// termina nesse node — semântica "ramo morto, encerra".

async function executeConditionNode(
  db: AgentDb,
  ctx: FlowRunContext,
  node: FlowConditionNode,
  _result: FlowRunResult,
): Promise<string | null> {
  const passed = await evaluateCondition(db, ctx.organizationId, ctx.leadId, node);
  const handle = passed ? "yes" : "no";

  ctx.provider.emit({
    kind: "guardrail",
    payload: {
      reason: "condition_evaluated",
      node_id: node.id,
      condition_type: node.data.condition_type,
      result: passed ? "yes" : "no",
    },
  });

  const edges = findOutgoingEdges(ctx.flowConfig, node.id, handle);
  if (edges[0]) {
    ctx.provider.emit({
      kind: "edge_traversed",
      payload: { from: node.id, to: edges[0].target, handle },
    });
    return edges[0].target;
  }
  return null;
}

// PR 4 do plano docs/ai-agent/11-openai-responses-migration.md:
// extrai o conteudo da primeira mensagem role="system" pra passar
// ao adapter como campo proprio (`AgentLlmInput.system`). O adapter
// re-injeta como system msg (Chat) ou `instructions` (Responses).
// Quando não há mensagem system, retorna string vazia — adapter omite.
function extractSystem(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): string {
  const sys = messages.find((m) => m.role === "system");
  if (!sys) return "";
  return typeof sys.content === "string" ? sys.content : "";
}
