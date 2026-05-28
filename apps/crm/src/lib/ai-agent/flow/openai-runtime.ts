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
    input: toResponsesInput(input.messages),
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
  const toolCalls = response.output
    .filter(isResponseFunctionToolCall)
    .map((call) => ({
      id: call.call_id,
      responseItemId: call.id,
      name: call.name,
      argumentsJson: call.arguments || "{}",
    }));

  return {
    text: response.output_text ?? "",
    toolCalls,
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
  return {
    type: "function",
    name: tool.name,
    description: tool.description ?? undefined,
    parameters: tool.parameters ?? {},
    strict: tool.strict ?? false,
  };
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
