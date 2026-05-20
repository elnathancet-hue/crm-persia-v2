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
} from "@persia/shared/ai-agent";
import {
  findEntryNode,
  findOutgoingEdges,
  getNodeById,
} from "@persia/shared/ai-agent";
import type { AgentDb } from "../db";
import { nativeHandlers } from "../tools/registry";
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
  execution_mode: "native" | "n8n_webhook";
  native_handler: string | null;
}

async function loadEnabledTools(
  db: AgentDb,
  ctx: FlowRunContext,
): Promise<LoadedToolRow[]> {
  const ids = ctx.flowConfig.enabled_tools;
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("agent_tools")
    .select("id, name, description, input_schema, execution_mode, native_handler, is_enabled")
    .eq("organization_id", ctx.organizationId)
    .in("id", ids);
  if (error) throw new Error(`Falha ao carregar tools: ${error.message}`);
  return ((data ?? []) as Array<LoadedToolRow & { is_enabled: boolean }>)
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

  const [agentConfig, tools] = await Promise.all([
    loadAgentConfig(db, ctx),
    loadEnabledTools(db, ctx),
  ]);
  const client = getOpenAIClient();
  const model = node.data.model ?? agentConfig.model;

  // Montagem do system prompt: agent base + node-specific prompt +
  // instructions textuais com handles nomeados (cliente cadastra no
  // canvas). PR-FLOW-PIVOT PR 7 (mai/2026): listamos eventos como
  // "EVENTS TO EMIT" pra IA saber EXATAMENTE quais handles usar com
  // a tool emit_event(handle_name).
  const systemParts: string[] = [];
  if (agentConfig.system_prompt.trim()) systemParts.push(agentConfig.system_prompt.trim());
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

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemParts.join("\n\n") },
    { role: "user", content: ctx.inboundMessage.text },
  ];

  const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));

  // Mapa de tool name → row pra resolver native_handler depois.
  const toolByName = new Map(tools.map((t) => [t.name, t]));

  let lastSuccessfulToolName: string | null = null;
  // PR-FLOW-PIVOT PR 7 (mai/2026): se a IA chamar emit_event(handle),
  // o runner sobrescreve a edge a seguir pelo `<handle>` (não pelo
  // tool_success:emit_event). Captura aqui pra usar depois do loop.
  let emittedHandleName: string | null = null;

  for (let iter = 0; iter < MAX_LLM_TOOL_PINGPONG; iter++) {
    const llmStart = Date.now();
    ctx.provider.emit({
      kind: "llm_call",
      payload: { iteration: iter, model, message_count: messages.length },
    });

    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await client.chat.completions.create({
        model,
        messages,
        ...(openaiTools.length > 0 ? { tools: openaiTools, tool_choice: "auto" as const } : {}),
      });
    } catch (err) {
      result.fatal_error = `llm_call_failed:${
        err instanceof Error ? err.message : String(err)
      }`;
      ctx.provider.emit({
        kind: "guardrail",
        payload: {
          reason: "llm_call_failed",
          message: err instanceof Error ? err.message : String(err),
        },
      });
      return null;
    }
    const llmDuration = Date.now() - llmStart;
    const tokensIn = completion.usage?.prompt_tokens ?? 0;
    const tokensOut = completion.usage?.completion_tokens ?? 0;
    result.tokens_input += tokensIn;
    result.tokens_output += tokensOut;
    ctx.provider.emit({
      kind: "llm_call",
      payload: {
        iteration: iter,
        finish_reason: completion.choices[0]?.finish_reason ?? "unknown",
        duration_ms: llmDuration,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
      },
    });

    const choice = completion.choices[0];
    if (!choice) {
      result.fatal_error = "llm_returned_no_choices";
      return null;
    }

    // Caso 1: LLM emitiu texto final (sem tool call). Send + segue edge default.
    if (choice.finish_reason !== "tool_calls") {
      const text = (choice.message.content ?? "").trim();
      if (text) {
        result.assistant_reply += result.assistant_reply ? "\n" + text : text;
        ctx.provider.emit({
          kind: "send_text",
          payload: { message: text },
        });
      }
      break;
    }

    // Caso 2: LLM pediu tool calls. Anexa assistant msg + executa cada call.
    messages.push({
      role: "assistant",
      content: choice.message.content ?? null,
      tool_calls: choice.message.tool_calls,
    } as OpenAI.Chat.ChatCompletionMessageParam);

    for (const call of choice.message.tool_calls ?? []) {
      if (call.type !== "function") continue;
      const toolRow = toolByName.get(call.function.name);
      const callId = call.id;
      let toolArgs: Record<string, unknown> = {};
      try {
        toolArgs = call.function.arguments
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : {};
      } catch (parseErr) {
        ctx.provider.emit({
          kind: "tool_result",
          payload: {
            tool_call_id: callId,
            tool_name: call.function.name,
            success: false,
            error: "invalid_json_arguments",
            details: parseErr instanceof Error ? parseErr.message : String(parseErr),
          },
        });
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify({ success: false, error: "invalid_json_arguments" }),
        });
        result.tool_calls_failed++;
        continue;
      }

      ctx.provider.emit({
        kind: "tool_call",
        payload: {
          tool_call_id: callId,
          tool_name: call.function.name,
          input: toolArgs,
        },
      });

      if (!toolRow) {
        ctx.provider.emit({
          kind: "tool_result",
          payload: {
            tool_call_id: callId,
            tool_name: call.function.name,
            success: false,
            error: "tool_not_in_allowlist",
          },
        });
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify({
            success: false,
            error: "tool_not_in_allowlist",
          }),
        });
        result.tool_calls_failed++;
        continue;
      }

      const handlerResult = await dispatchToolCall(db, ctx, toolRow, toolArgs);
      const resultPayload = {
        tool_call_id: callId,
        tool_name: call.function.name,
        success: handlerResult.success,
        output: handlerResult.output,
        error: handlerResult.error,
        side_effects: handlerResult.side_effects,
      };
      ctx.provider.emit({ kind: "tool_result", payload: resultPayload });
      messages.push({
        role: "tool",
        tool_call_id: callId,
        content: JSON.stringify({
          success: handlerResult.success,
          output: handlerResult.output,
          error: handlerResult.error,
        }),
      });

      if (handlerResult.success) {
        result.tool_calls_succeeded++;
        lastSuccessfulToolName = call.function.name;
        // PR-FLOW-PIVOT PR 7 (mai/2026): se foi emit_event, captura o
        // handle_name pra sobrescrever a edge a seguir. Output do handler
        // tem o handle_name normalizado (vide handlers/emit-event.ts).
        if (call.function.name === "emit_event") {
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
      return await handler(
        {
          organization_id: ctx.organizationId,
          lead_id: ctx.leadId ?? "",
          crm_conversation_id: ctx.crmConversationId ?? "",
          agent_conversation_id: ctx.agentConversationId,
          run_id: "", // V1 sem audit em agent_runs
          dry_run: ctx.dryRun,
        },
        input,
      );
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
  // Action nodes "remove_tag" não tem handler nativo ainda (foi declarado
  // no shared/flow.ts como tipo futuro). V1 marca como guardrail.
  const directHandlers: Partial<Record<typeof actionType, keyof typeof nativeHandlers>> = {
    add_tag: "add_tag",
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
    handlerResult = await handler(
      {
        organization_id: ctx.organizationId,
        lead_id: ctx.leadId ?? "",
        crm_conversation_id: ctx.crmConversationId ?? "",
        agent_conversation_id: ctx.agentConversationId,
        run_id: "",
        dry_run: ctx.dryRun,
      },
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

function interpolateLeadPlaceholders(
  template: string,
  lead: { name?: string | null; phone?: string | null; email?: string | null },
): string {
  return template.replace(/\{\{lead\.(\w+)\}\}/g, (_, key) => {
    const value = (lead as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  });
}

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

  // Carrega lead pra resolver placeholders. Se sem lead_id ou lead não
  // encontrado, interpolamos com vazios — mensagem ainda é enviada.
  let lead: { name?: string | null; phone?: string | null; email?: string | null } = {};
  if (ctx.leadId) {
    const { data: leadRow } = await db
      .from("leads")
      .select("name, phone, email")
      .eq("organization_id", ctx.organizationId)
      .eq("id", ctx.leadId)
      .maybeSingle();
    if (leadRow) {
      lead = leadRow as typeof lead;
    }
  }

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
