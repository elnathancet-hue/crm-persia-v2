import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputItem,
} from "openai/resources/responses/responses";

export type AgentLlmProvider = "chat_completions" | "responses";

export interface AgentLlmTool {
  name: string;
  description?: string | null;
  parameters: Record<string, unknown> | null;
  strict?: boolean | null;
}

export interface AgentLlmInput {
  model: string;
  system: string;
  messages: ChatCompletionMessageParam[];
  responsesInputItems?: ResponseInputItem[];
  tools: AgentLlmTool[];
  maxOutputTokens: number;
}

export interface AgentLlmToolCall {
  id: string;
  name: string;
  argumentsJson: string;
  responseItemId?: string;
}

export interface AgentLlmOutput {
  text: string;
  toolCalls: AgentLlmToolCall[];
  responsesInputItems: ResponseInputItem[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  finishKind: "final" | "tool_calls" | "incomplete";
  rawProvider: AgentLlmProvider;
}

interface ChatCompletionClient {
  chat: {
    completions: {
      create(
        params: ChatCompletionCreateParamsNonStreaming,
      ): Promise<ChatCompletion>;
    };
  };
}

interface ResponsesClient {
  responses: {
    create(params: ResponseCreateParamsNonStreaming): Promise<Response>;
  };
}

export async function runChatCompletionTurn(
  client: ChatCompletionClient,
  input: AgentLlmInput,
): Promise<AgentLlmOutput> {
  const maxTokensKey: "max_completion_tokens" | "max_tokens" =
    input.model.startsWith("gpt-5") ? "max_completion_tokens" : "max_tokens";

  const completion = await client.chat.completions.create({
    model: input.model,
    messages: [
      { role: "system", content: input.system },
      ...input.messages,
    ],
    [maxTokensKey]: input.maxOutputTokens,
    ...(input.tools.length > 0
      ? {
          tools: input.tools.map(toChatCompletionTool),
          tool_choice: "auto" as const,
        }
      : {}),
  });

  return normalizeChatCompletion(completion);
}

export async function runResponsesTurn(
  client: ResponsesClient,
  input: AgentLlmInput,
): Promise<AgentLlmOutput> {
  const response = await client.responses.create({
    model: input.model,
    instructions: input.system,
    input: [
      ...toResponsesInput(input.messages),
      ...(input.responsesInputItems ?? []),
    ],
    max_output_tokens: input.maxOutputTokens,
    ...(input.tools.length > 0
      ? {
          tools: input.tools.map(toResponsesFunctionTool),
          tool_choice: "auto" as const,
        }
      : {}),
  });

  return normalizeResponse(response);
}

export function toResponsesFunctionCallOutput(
  callId: string,
  output: unknown,
): ResponseInputItem.FunctionCallOutput {
  return {
    type: "function_call_output",
    call_id: callId,
    output: typeof output === "string" ? output : JSON.stringify(output),
  };
}

function normalizeChatCompletion(completion: ChatCompletion): AgentLlmOutput {
  const choice = completion.choices[0];
  const message = choice?.message;
  const toolCalls =
    message?.tool_calls
      ?.filter((call) => call.type === "function")
      .map((call) => ({
        id: call.id,
        name: call.function.name,
        argumentsJson: call.function.arguments || "{}",
      })) ?? [];

  return {
    text: typeof message?.content === "string" ? message.content : "",
    toolCalls,
    responsesInputItems: [],
    usage: {
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    },
    finishKind:
      toolCalls.length > 0
        ? "tool_calls"
        : choice?.finish_reason === "length" ||
            choice?.finish_reason === "content_filter"
          ? "incomplete"
          : "final",
    rawProvider: "chat_completions",
  };
}

function normalizeResponse(response: Response): AgentLlmOutput {
  const responseFunctionCalls = response.output.filter(isResponseFunctionToolCall);
  const toolCalls = responseFunctionCalls
    .map((call) => ({
      id: call.call_id,
      responseItemId: call.id,
      name: call.name,
      argumentsJson: call.arguments || "{}",
    }));

  return {
    text: response.output_text ?? "",
    toolCalls,
    responsesInputItems: responseFunctionCalls,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
    finishKind:
      toolCalls.length > 0
        ? "tool_calls"
        : response.status === "incomplete" || response.incomplete_details
          ? "incomplete"
          : "final",
    rawProvider: "responses",
  };
}

function toChatCompletionTool(tool: AgentLlmTool): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? undefined,
      parameters: tool.parameters ?? {},
    },
  };
}

function toResponsesFunctionTool(tool: AgentLlmTool): FunctionTool {
  // PR 5 prep do plano docs/ai-agent/11-openai-responses-migration.md
  // (mai/2026): strict=true por default no caminho Responses.
  // Habilitado em mai/2026 após PR #381 deixar todos os 20 presets nativos
  // strict-ready (additionalProperties: false + required completo + nullable
  // explícito). Caller pode ainda forçar `strict: false` setando explicitamente
  // — primeira ocorrência de `false` vence.
  const explicitStrict = typeof tool.strict === "boolean" ? tool.strict : null;
  return {
    type: "function",
    name: tool.name,
    description: tool.description ?? undefined,
    parameters: rewriteNullableForResponses(tool.parameters ?? {}),
    strict: explicitStrict ?? true,
  };
}

/**
 * Strict-ready conversion (mai/2026, pós PR #379-#380):
 *
 * Os presets em `packages/shared/src/ai-agent/tool-presets.ts` declaram
 * campos opcionais via `{ type: "string", nullable: true }` (shape custom
 * desta codebase). A Responses API exige JSON Schema 2020-12 com
 * `type: ["string", "null"]` quando o campo pode ser null em strict mode.
 *
 * Esta função reescreve recursivamente o schema antes do envio:
 *   - { type: "X", nullable: true } -> { type: ["X", "null"] }
 *   - Remove a chave `nullable` (não faz parte do JSON Schema padrão).
 *   - Preserva todos os outros atributos (enum, format, items, etc).
 *
 * Chat Completions tolera o campo `nullable` (ignora), por isso esta
 * conversão NÃO é aplicada em `toChatCompletionTool`. Mantemos o shape
 * original no Chat Completions pra evitar mudança de comportamento.
 */
function rewriteNullableForResponses(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return {};
  }
  return rewriteNode(schema as Record<string, unknown>) as Record<string, unknown>;
}

function rewriteNode(node: Record<string, unknown>): unknown {
  // Recursive walk
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "nullable") {
      // skip — converted into type tuple below
      continue;
    }
    if (key === "properties" && value && typeof value === "object") {
      const props: Record<string, unknown> = {};
      for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
        props[propKey] =
          propValue && typeof propValue === "object"
            ? rewriteNode(propValue as Record<string, unknown>)
            : propValue;
      }
      out[key] = props;
    } else if (key === "items" && value && typeof value === "object") {
      out[key] = rewriteNode(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }

  // Aplica conversão nullable -> tipo tupla
  if (node.nullable === true && typeof node.type === "string") {
    out.type = [node.type, "null"];
  }

  return out;
}

function toResponsesInput(
  messages: ChatCompletionMessageParam[],
): ResponseInput {
  return messages.flatMap((message) => {
    if (
      message.role === "system" ||
      message.role === "developer" ||
      message.role === "user" ||
      message.role === "assistant"
    ) {
      const content =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content ?? "");
      return [{ role: message.role, content, type: "message" as const }];
    }

    return [];
  });
}

function isResponseFunctionToolCall(
  item: Response["output"][number],
): item is ResponseFunctionToolCall {
  return item.type === "function_call";
}
