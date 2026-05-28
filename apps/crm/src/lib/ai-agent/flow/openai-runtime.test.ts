import { describe, expect, it, vi } from "vitest";
import {
  runChatCompletionTurn,
  runResponsesTurn,
  toResponsesFunctionCallOutput,
  type AgentLlmInput,
} from "./openai-runtime";

const baseInput: AgentLlmInput = {
  model: "gpt-5-mini",
  system: "Responda em PT-BR.",
  messages: [{ role: "user", content: "oi" }],
  tools: [],
  maxOutputTokens: 4096,
};

describe("openai-runtime adapter", () => {
  it("normaliza uma resposta final via Chat Completions", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: "Olá!" },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    });
    const client = { chat: { completions: { create } } };

    const output = await runChatCompletionTurn(client, baseInput);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5-mini",
        max_completion_tokens: 4096,
        messages: [
          { role: "system", content: "Responda em PT-BR." },
          { role: "user", content: "oi" },
        ],
      }),
    );
    expect(output).toEqual({
      text: "Olá!",
      toolCalls: [],
      responsesInputItems: [],
      usage: { inputTokens: 12, outputTokens: 4 },
      finishKind: "final",
      rawProvider: "chat_completions",
    });
  });

  it("usa max_tokens para modelos não-gpt-5 no caminho Chat Completions", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    await runChatCompletionTurn(
      { chat: { completions: { create } } },
      { ...baseInput, model: "gpt-4o-mini" },
    );

    expect(create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        max_tokens: 4096,
      }),
    );
    expect(create.mock.calls[0]?.[0].max_completion_tokens).toBeUndefined();
  });

  it("normaliza function calls via Chat Completions", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "emit_event",
                  arguments: "{\"event_name\":\"qualified\"}",
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 6 },
    });

    const output = await runChatCompletionTurn(
      { chat: { completions: { create } } },
      {
        ...baseInput,
        tools: [
          {
            name: "emit_event",
            description: "Sinaliza evento",
            parameters: { type: "object" },
          },
        ],
      },
    );

    expect(create.mock.calls[0]?.[0].tools).toEqual([
      {
        type: "function",
        function: {
          name: "emit_event",
          description: "Sinaliza evento",
          parameters: { type: "object" },
        },
      },
    ]);
    expect(output.finishKind).toBe("tool_calls");
    expect(output.toolCalls).toEqual([
      {
        id: "call_1",
        name: "emit_event",
        argumentsJson: "{\"event_name\":\"qualified\"}",
      },
    ]);
  });

  it("normaliza uma resposta final via Responses API", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "resp_1",
      output_text: "Olá pelo Responses",
      output: [],
      status: "completed",
      incomplete_details: null,
      usage: {
        input_tokens: 15,
        output_tokens: 5,
        total_tokens: 20,
      },
    });
    const client = { responses: { create } };

    const output = await runResponsesTurn(client, baseInput);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5-mini",
        instructions: "Responda em PT-BR.",
        input: [{ role: "user", content: "oi", type: "message" }],
        max_output_tokens: 4096,
      }),
    );
    expect(output).toEqual({
      text: "Olá pelo Responses",
      toolCalls: [],
      responsesInputItems: [],
      usage: { inputTokens: 15, outputTokens: 5 },
      finishKind: "final",
      rawProvider: "responses",
    });
  });

  it("normaliza múltiplas function calls via Responses API", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "",
      output: [
        {
          type: "function_call",
          id: "fc_item_1",
          call_id: "call_a",
          name: "emit_event",
          arguments: "{\"event_name\":\"qualified\"}",
          status: "completed",
        },
        {
          type: "function_call",
          id: "fc_item_2",
          call_id: "call_b",
          name: "add_tag",
          arguments: "{\"tag_name\":\"quente\"}",
          status: "completed",
        },
      ],
      status: "completed",
      incomplete_details: null,
      usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 },
    });

    const output = await runResponsesTurn(
      { responses: { create } },
      {
        ...baseInput,
        tools: [
          {
            name: "emit_event",
            parameters: { type: "object" },
            strict: true,
          },
        ],
      },
    );

    expect(create.mock.calls[0]?.[0].tools).toEqual([
      {
        type: "function",
        name: "emit_event",
        description: undefined,
        parameters: { type: "object" },
        strict: true,
      },
    ]);
    expect(output.finishKind).toBe("tool_calls");
    expect(output.toolCalls).toEqual([
      {
        id: "call_a",
        responseItemId: "fc_item_1",
        name: "emit_event",
        argumentsJson: "{\"event_name\":\"qualified\"}",
      },
      {
        id: "call_b",
        responseItemId: "fc_item_2",
        name: "add_tag",
        argumentsJson: "{\"tag_name\":\"quente\"}",
      },
    ]);
    expect(output.responsesInputItems).toEqual([
      {
        type: "function_call",
        id: "fc_item_1",
        call_id: "call_a",
        name: "emit_event",
        arguments: "{\"event_name\":\"qualified\"}",
        status: "completed",
      },
      {
        type: "function_call",
        id: "fc_item_2",
        call_id: "call_b",
        name: "add_tag",
        arguments: "{\"tag_name\":\"quente\"}",
        status: "completed",
      },
    ]);
  });

  it("envia function_call e function_call_output numa rodada Responses seguinte", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "Pronto, marquei como qualificado.",
      output: [],
      status: "completed",
      incomplete_details: null,
      usage: { input_tokens: 40, output_tokens: 8, total_tokens: 48 },
    });

    await runResponsesTurn(
      { responses: { create } },
      {
        ...baseInput,
        responsesInputItems: [
          {
            type: "function_call",
            call_id: "call_a",
            name: "emit_event",
            arguments: "{\"event_name\":\"qualified\"}",
            status: "completed",
          },
          toResponsesFunctionCallOutput("call_a", {
            success: true,
            output: { handle_name: "qualified" },
          }),
        ],
      },
    );

    expect(create.mock.calls[0]?.[0].input).toEqual([
      { role: "user", content: "oi", type: "message" },
      {
        type: "function_call",
        call_id: "call_a",
        name: "emit_event",
        arguments: "{\"event_name\":\"qualified\"}",
        status: "completed",
      },
      {
        type: "function_call_output",
        call_id: "call_a",
        output: "{\"success\":true,\"output\":{\"handle_name\":\"qualified\"}}",
      },
    ]);
  });

  it("tolera usage ausente e marca output incompleto", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "parcial",
      output: [],
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    });

    const output = await runResponsesTurn(
      { responses: { create } },
      baseInput,
    );

    expect(output).toEqual({
      text: "parcial",
      toolCalls: [],
      responsesInputItems: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      finishKind: "incomplete",
      rawProvider: "responses",
    });
  });

  it("cria function_call_output para a próxima chamada Responses", () => {
    expect(toResponsesFunctionCallOutput("call_1", { ok: true })).toEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: "{\"ok\":true}",
    });
    expect(toResponsesFunctionCallOutput("call_2", "plain")).toEqual({
      type: "function_call_output",
      call_id: "call_2",
      output: "plain",
    });
  });

  it("aplica strict=true por default no caminho Responses quando caller nao passa strict", async () => {
    // PR 5 prep do plano docs/ai-agent/11-openai-responses-migration.md
    // (mai/2026): apos PR #381 deixar schemas strict-ready, flipamos
    // default. Caller pode forcar strict=false explicito (1a ocorrencia
    // do flag vence), mas presets nativos passam sem strict e ganham true.
    const create = vi.fn().mockResolvedValue({
      output_text: "ok",
      output: [],
      status: "completed",
      incomplete_details: null,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });

    await runResponsesTurn(
      { responses: { create } },
      {
        ...baseInput,
        tools: [
          {
            name: "add_tag",
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["tag_name"],
              properties: { tag_name: { type: "string" } },
            },
            // sem strict explícito → default true
          },
        ],
      },
    );

    const sentTools = create.mock.calls[0]?.[0].tools as Array<{ strict: boolean }>;
    expect(sentTools[0]!.strict).toBe(true);
  });

  it("caller forcando strict=false sobrepoe o default", async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: "ok",
      output: [],
      status: "completed",
      incomplete_details: null,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });

    await runResponsesTurn(
      { responses: { create } },
      {
        ...baseInput,
        tools: [
          {
            name: "legacy_tool",
            parameters: { type: "object" },
            strict: false,
          },
        ],
      },
    );

    const sentTools = create.mock.calls[0]?.[0].tools as Array<{ strict: boolean }>;
    expect(sentTools[0]!.strict).toBe(false);
  });

  it("converte nullable: true em type tupla ao enviar pra Responses (strict-ready)", async () => {
    // PR pos-#380: presets shared declaram opcionais como { type: "string", nullable: true }.
    // Adapter precisa reescrever pra { type: ["string", "null"] } no caminho
    // Responses (Chat Completions tolera o nullable e fica intacto).
    const create = vi.fn().mockResolvedValue({
      output_text: "ok",
      output: [],
      status: "completed",
      incomplete_details: null,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });

    await runResponsesTurn(
      { responses: { create } },
      {
        ...baseInput,
        tools: [
          {
            name: "stop_agent",
            description: "Pause agent",
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["reason"],
              properties: {
                reason: { type: "string", nullable: true, description: "why" },
              },
            },
            strict: true,
          },
        ],
      },
    );

    const sentTools = create.mock.calls[0]?.[0].tools as Array<{
      parameters: { properties: { reason: { type: unknown; nullable?: unknown } } };
    }>;
    expect(sentTools[0]!.parameters.properties.reason.type).toEqual(["string", "null"]);
    expect(sentTools[0]!.parameters.properties.reason.nullable).toBeUndefined();
  });
});
