// Backlog #1 Auditoria (mai/2026) — testes de history + summarization.
//
// Endereca rodada 6 #critica #2 + #3 do POST_CODEX_AUDIT_AGENT_FLOW_353.md.
// Antes, summarization.ts era dead code e flow runner mandava apenas
// [{system}, {user: inbound}] — IA esquecia tudo entre turns.
//
// Agora:
//   - runner.ts::executeAIAgentNode carrega history via buildConversationLlmMessages
//   - executor.ts::executeDebouncedBatch dispara runConversationSummarization
//     fire-and-forget quando threshold de turns/tokens estoura.

import { describe, expect, it, vi } from "vitest";
import {
  runConversationSummarization,
  buildConversationLlmMessages,
} from "@/lib/ai-agent/summarization";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/observability", () => ({
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

describe("Backlog #1: buildConversationLlmMessages (history loading)", () => {
  it("retorna [] quando agentConversation nao tem crm_conversation_id", async () => {
    const supabase = createSupabaseMock();
    const result = await buildConversationLlmMessages({
      db: supabase as never,
      orgId: "org-1",
      // crm_conversation_id null em runtime existe (legacy rows / tester edge),
      // mas o tipo declara `string`. Cast pra never pra simular.
      agentConversation: {
        crm_conversation_id: null as never,
        history_summary: null,
      },
      config: {},
    });
    expect(result).toEqual([]);
  });

  it("carrega ultimas N mensagens em ordem cronologica como {role: user|assistant}", async () => {
    const supabase = createSupabaseMock();
    // Mock retorna mensagens em ordem DESC (do mais recente pro mais antigo)
    supabase.queue("messages", {
      data: [
        { sender: "lead", content: "msg 3", created_at: "2026-05-27T10:02:00Z" },
        { sender: "ai", content: "resposta 2", created_at: "2026-05-27T10:01:30Z" },
        { sender: "lead", content: "msg 2", created_at: "2026-05-27T10:01:00Z" },
        { sender: "ai", content: "resposta 1", created_at: "2026-05-27T10:00:30Z" },
        { sender: "lead", content: "msg 1", created_at: "2026-05-27T10:00:00Z" },
      ],
      error: null,
    });

    const result = await buildConversationLlmMessages({
      db: supabase as never,
      orgId: "org-1",
      agentConversation: {
        crm_conversation_id: "conv-1",
        history_summary: null,
      },
      config: {},
    });

    // Ordem invertida pra cronologica ASC; sem history_summary, nao tem priorContext
    expect(result).toEqual([
      { role: "user", content: "msg 1" },
      { role: "assistant", content: "resposta 1" },
      { role: "user", content: "msg 2" },
      { role: "assistant", content: "resposta 2" },
      { role: "user", content: "msg 3" },
    ]);
  });

  it("injeta history_summary como priorContext (user) + ack (assistant) antes das msgs", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("messages", {
      data: [
        { sender: "lead", content: "ola", created_at: "2026-05-27T10:00:00Z" },
      ],
      error: null,
    });

    const result = await buildConversationLlmMessages({
      db: supabase as never,
      orgId: "org-1",
      agentConversation: {
        crm_conversation_id: "conv-1",
        history_summary: "Lead Joao, 30 anos, interessado em plano premium",
      },
      config: {},
    });

    expect(result[0]).toMatchObject({ role: "user" });
    expect((result[0] as { content: string }).content).toContain(
      "Lead Joao, 30 anos",
    );
    expect(result[1]).toEqual({ role: "assistant", content: "Contexto carregado." });
    expect(result[2]).toEqual({ role: "user", content: "ola" });
  });
});

describe("Backlog #1: runConversationSummarization", () => {
  function ctxBase() {
    return {
      orgId: "org-1",
      agentConversation: {
        id: "ac-1",
        crm_conversation_id: "conv-1",
        history_summary: null,
        history_summary_updated_at: null,
        history_summary_run_count: 0,
        history_summary_token_count: 0,
        created_at: "2026-05-27T10:00:00Z",
      },
    };
  }

  it("retorna skipped quando agentConversation nao tem crm_conversation_id", async () => {
    const supabase = createSupabaseMock();
    const openaiCreate = vi.fn();
    const openai = { chat: { completions: { create: openaiCreate } } };
    const result = await runConversationSummarization({
      ...ctxBase(),
      db: supabase as never,
      openaiClient: openai as never,
      agentConversation: {
        ...ctxBase().agentConversation,
        crm_conversation_id: null as never,
      },
    });
    expect(result.status).toBe("skipped_no_new_messages");
    expect(result.reason).toBe("no_crm_conversation");
  });

  it("retorna skipped quando nao ha mensagens novas desde ultimo summary", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("messages", { data: [], error: null });
    const openaiCreate = vi.fn();
    const openai = { chat: { completions: { create: openaiCreate } } };
    const result = await runConversationSummarization({
      ...ctxBase(),
      db: supabase as never,
      openaiClient: openai as never,
    });
    expect(result.status).toBe("skipped_no_new_messages");
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("chama OpenAI, salva summary novo, incrementa counters", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("messages", {
      data: [
        { sender: "lead", content: "ola, quero plano", created_at: "2026-05-27T10:00:00Z" },
        { sender: "ai", content: "claro, qual interesse?", created_at: "2026-05-27T10:00:30Z" },
        { sender: "lead", content: "premium", created_at: "2026-05-27T10:01:00Z" },
      ],
      error: null,
    });
    const openaiCreate = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: "Lead Joao demonstrou interesse no plano premium.",
            role: "assistant",
          },
        },
      ],
      usage: { prompt_tokens: 150, completion_tokens: 50 },
    }));
    const openai = { chat: { completions: { create: openaiCreate } } } as never;

    const result = await runConversationSummarization({
      ...ctxBase(),
      db: supabase as never,
      openaiClient: openai,
    });

    expect(result.status).toBe("summarized");
    expect(result.tokens_input).toBe(150);
    expect(result.tokens_output).toBe(50);
    expect(openaiCreate).toHaveBeenCalledTimes(1);

    // UPDATE em agent_conversations com novo summary + counters incrementados.
    const updates = supabase.updates.agent_conversations as Array<Record<string, unknown>>;
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      history_summary: "Lead Joao demonstrou interesse no plano premium.",
      history_summary_run_count: 1, // 0 + 1
      history_summary_token_count: 200, // 0 + 150 + 50
    });
  });

  it("retorna failed quando OpenAI retorna conteudo vazio", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("messages", {
      data: [
        { sender: "lead", content: "oi", created_at: "2026-05-27T10:00:00Z" },
      ],
      error: null,
    });
    const openai = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: "", role: "assistant" } }],
            usage: { prompt_tokens: 100, completion_tokens: 0 },
          })),
        },
      },
    } as never;

    const result = await runConversationSummarization({
      ...ctxBase(),
      db: supabase as never,
      openaiClient: openai,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("empty_summary_from_openai");
    // NAO deve persistir UPDATE
    expect(supabase.updates.agent_conversations).toBeUndefined();
  });

  it("incrementa counters acumulativos quando ja havia summary anterior", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("messages", {
      data: [
        { sender: "lead", content: "novo turn", created_at: "2026-05-27T11:00:00Z" },
      ],
      error: null,
    });
    const openai = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: "Resumo v2", role: "assistant" } }],
            usage: { prompt_tokens: 80, completion_tokens: 40 },
          })),
        },
      },
    } as never;

    await runConversationSummarization({
      orgId: "org-1",
      db: supabase as never,
      openaiClient: openai,
      agentConversation: {
        id: "ac-1",
        crm_conversation_id: "conv-1",
        history_summary: "Resumo v1",
        history_summary_updated_at: "2026-05-27T10:30:00Z",
        history_summary_run_count: 3,
        history_summary_token_count: 500,
        created_at: "2026-05-27T10:00:00Z",
      },
    });

    const updates = supabase.updates.agent_conversations as Array<Record<string, unknown>>;
    expect(updates[0]).toMatchObject({
      history_summary: "Resumo v2",
      history_summary_run_count: 4, // 3 + 1
      history_summary_token_count: 620, // 500 + 80 + 40
    });
  });
});
