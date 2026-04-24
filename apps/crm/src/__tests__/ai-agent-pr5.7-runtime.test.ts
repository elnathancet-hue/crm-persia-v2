import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability", () => ({
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

const openaiMock = vi.hoisted(() => ({
  chat: { completions: { create: vi.fn() } },
}));

vi.mock("openai", () => ({
  default: vi.fn(() => openaiMock),
}));

import type {
  AgentConfig,
  AgentConversation,
  AgentStage,
} from "@persia/shared/ai-agent";
import type { WhatsAppProvider } from "@/lib/whatsapp/provider";
import { executeAgent } from "@/lib/ai-agent/executor";
import { asAgentDb } from "@/lib/ai-agent/db";
import {
  buildConversationLlmMessages,
  shouldTriggerConversationSummarization,
} from "@/lib/ai-agent/summarization";

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "config-a",
    organization_id: "org-a",
    name: "Recepcao",
    description: null,
    scope_type: "global",
    scope_id: null,
    model: "gpt-5-mini",
    system_prompt: "Voce atende clientes.",
    guardrails: {
      max_iterations: 5,
      timeout_seconds: 30,
      cost_ceiling_tokens: 20_000,
      allow_human_handoff: true,
    },
    debounce_window_ms: 10000,
    context_summary_turn_threshold: 10,
    context_summary_token_threshold: 20_000,
    context_summary_recent_messages: 6,
    status: "active",
    created_at: "2026-04-22T00:00:00.000Z",
    updated_at: "2026-04-22T00:00:00.000Z",
    ...overrides,
  };
}

function stage(overrides: Partial<AgentStage> = {}): AgentStage {
  return {
    id: "stage-a",
    config_id: "config-a",
    organization_id: "org-a",
    slug: "inicio",
    order_index: 0,
    situation: "Inicio",
    instruction: "Cumprimente o cliente.",
    transition_hint: null,
    rag_enabled: false,
    created_at: "2026-04-22T00:00:00.000Z",
    updated_at: "2026-04-22T00:00:00.000Z",
    ...overrides,
  };
}

function conversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: "agent-conv-a",
    organization_id: "org-a",
    crm_conversation_id: "crm-conv-a",
    lead_id: "lead-a",
    config_id: "config-a",
    current_stage_id: "stage-a",
    history_summary: null,
    history_summary_updated_at: null,
    history_summary_run_count: 0,
    history_summary_token_count: 0,
    variables: {},
    tokens_used_total: 0,
    last_interaction_at: null,
    created_at: "2026-04-22T00:00:00.000Z",
    updated_at: "2026-04-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("ai-agent PR5.7 runtime", () => {
  beforeEach(() => {
    openaiMock.chat.completions.create.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("shouldTriggerConversationSummarization returns true on turn threshold", () => {
    expect(
      shouldTriggerConversationSummarization(
        conversation({ history_summary_run_count: 10 }),
        config({ context_summary_turn_threshold: 10 }),
      ),
    ).toBe(true);
  });

  it("shouldTriggerConversationSummarization returns true on token threshold", () => {
    expect(
      shouldTriggerConversationSummarization(
        conversation({ history_summary_token_count: 20_000 }),
        config({ context_summary_token_threshold: 20_000 }),
      ),
    ).toBe(true);
  });

  it("shouldTriggerConversationSummarization returns false when neither threshold is met", () => {
    expect(
      shouldTriggerConversationSummarization(
        conversation({ history_summary_run_count: 2, history_summary_token_count: 1000 }),
        config(),
      ),
    ).toBe(false);
  });

  it("shouldTriggerConversationSummarization treats missing counters as zero", () => {
    expect(
      shouldTriggerConversationSummarization(
        {
          ...conversation(),
          history_summary_run_count: undefined,
          history_summary_token_count: undefined,
        },
        config(),
      ),
    ).toBe(false);
  });

  it("buildConversationLlmMessages injects summary pair plus the last K messages", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("messages", {
      data: [
        { sender: "lead", content: "mensagem 4", created_at: "2026-04-22T00:00:04.000Z" },
        { sender: "ai", content: "mensagem 3", created_at: "2026-04-22T00:00:03.000Z" },
        { sender: "lead", content: "mensagem 2", created_at: "2026-04-22T00:00:02.000Z" },
        { sender: "ai", content: "mensagem 1", created_at: "2026-04-22T00:00:01.000Z" },
      ],
      error: null,
    });

    const messages = await buildConversationLlmMessages({
      db: asAgentDb(supabase as never),
      orgId: "org-a",
      agentConversation: conversation({ history_summary: "Resumo anterior." }),
      config: config({ context_summary_recent_messages: 2 }),
    });

    expect(messages).toEqual([
      {
        role: "user",
        content: "Contexto consolidado da conversa ate aqui:\n\nResumo anterior.",
      },
      {
        role: "assistant",
        content: "Contexto carregado.",
      },
      {
        role: "assistant",
        content: "mensagem 3",
      },
      {
        role: "user",
        content: "mensagem 4",
      },
    ]);
  });

  it("buildConversationLlmMessages without summary keeps only the recent K messages", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("messages", {
      data: [
        { sender: "lead", content: "m4", created_at: "2026-04-22T00:00:04.000Z" },
        { sender: "ai", content: "m3", created_at: "2026-04-22T00:00:03.000Z" },
        { sender: "lead", content: "m2", created_at: "2026-04-22T00:00:02.000Z" },
        { sender: "ai", content: "m1", created_at: "2026-04-22T00:00:01.000Z" },
      ],
      error: null,
    });

    const messages = await buildConversationLlmMessages({
      db: asAgentDb(supabase as never),
      orgId: "org-a",
      agentConversation: conversation(),
      config: config({ context_summary_recent_messages: 2 }),
    });

    expect(messages).toEqual([
      { role: "assistant", content: "m3" },
      { role: "user", content: "m4" },
    ]);
  });

  it("executeAgent triggers summarization on the 10th successful run and resets counters", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_runs", { data: { id: "run-a" }, error: null });
    supabase.queue("messages", {
      data: [
        { sender: "lead", content: "oi", created_at: "2026-04-22T00:00:01.000Z" },
      ],
      error: null,
    });
    supabase.queue("messages", {
      data: [
        { sender: "lead", content: "oi", created_at: "2026-04-22T00:00:01.000Z" },
        { sender: "ai", content: "ola", created_at: "2026-04-22T00:00:02.000Z" },
      ],
      error: null,
    });
    supabase.queue("agent_conversations", {
      data: { tokens_used_total: 0, variables: {} },
      error: null,
    });

    openaiMock.chat.completions.create
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "stop",
          message: { content: "Perfeito, vamos continuar." },
        }],
        usage: { prompt_tokens: 40, completion_tokens: 20 },
      })
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "stop",
          message: { content: "Resumo consolidado da conversa." },
        }],
        usage: { prompt_tokens: 15, completion_tokens: 10 },
      });

    const provider = {
      sendText: vi.fn(async () => ({ ok: true })),
    } as unknown as WhatsAppProvider;

    const result = await executeAgent({
      db: asAgentDb(supabase as never),
      orgId: "org-a",
      provider: provider as never,
      dryRun: false,
      config: config(),
      stage: stage(),
      agentConversation: conversation({
        history_summary_run_count: 9,
        history_summary_token_count: 150,
      }),
      tools: [],
      inboundMessageId: "msg-a",
      leadId: "lead-a",
      crmConversationId: "crm-conv-a",
      msg: {
        messageId: "wamid.a",
        phone: "5511999990000",
        pushName: "Ana",
        text: "quero avancar",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.tokensInput).toBe(55);
    expect(result.tokensOutput).toBe(30);
    expect(provider.sendText).toHaveBeenCalledWith({
      phone: "5511999990000",
      message: "Perfeito, vamos continuar.",
    });
    expect(supabase.inserts.agent_steps).toHaveLength(2);
    expect(supabase.inserts.agent_steps[1]).toMatchObject({
      step_type: "summarization",
      output: {
        success: true,
        new_summary_length: "Resumo consolidado da conversa.".length,
        tokens_input: 15,
        tokens_output: 10,
        model: "gpt-4o-mini",
      },
    });
    expect(supabase.updates.agent_conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          history_summary_run_count: 10,
          history_summary_token_count: 210,
        }),
        expect.objectContaining({
          history_summary: "Resumo consolidado da conversa.",
          history_summary_run_count: 0,
          history_summary_token_count: 0,
        }),
      ]),
    );
  });

  it("executeAgent triggers summarization on token threshold", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_runs", { data: { id: "run-a" }, error: null });
    supabase.queue("messages", {
      data: [{ sender: "lead", content: "oi", created_at: "2026-04-22T00:00:01.000Z" }],
      error: null,
    });
    supabase.queue("messages", {
      data: [{ sender: "lead", content: "oi", created_at: "2026-04-22T00:00:01.000Z" }],
      error: null,
    });
    supabase.queue("agent_conversations", {
      data: { tokens_used_total: 0, variables: {} },
      error: null,
    });

    openaiMock.chat.completions.create
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "stop",
          message: { content: "Tudo certo." },
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      })
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "stop",
          message: { content: "Resumo por tokens." },
        }],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      });

    const result = await executeAgent({
      db: asAgentDb(supabase as never),
      orgId: "org-a",
      provider: { sendText: vi.fn(async () => ({ ok: true })) } as never,
      dryRun: false,
      config: config({
        context_summary_turn_threshold: 50,
        context_summary_token_threshold: 5000,
      }),
      stage: stage(),
      agentConversation: conversation({
        history_summary_run_count: 1,
        history_summary_token_count: 4990,
      }),
      tools: [],
      inboundMessageId: "msg-a",
      leadId: "lead-a",
      crmConversationId: "crm-conv-a",
      msg: {
        messageId: "wamid.a",
        phone: "5511999990000",
        pushName: "Ana",
        text: "me atualiza",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.status).toBe("succeeded");
    const summaryStep = (supabase.inserts.agent_steps ?? []).find(
      (step) => (step as { step_type?: string }).step_type === "summarization",
    );
    expect(summaryStep).toMatchObject({
      step_type: "summarization",
      input: expect.objectContaining({
        trigger_reason: "token_threshold",
      }),
    });
  });

  it("executeAgent logs a failed summarization step and keeps counters when summarization fails", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_runs", { data: { id: "run-a" }, error: null });
    supabase.queue("messages", {
      data: [{ sender: "lead", content: "oi", created_at: "2026-04-22T00:00:01.000Z" }],
      error: null,
    });
    supabase.queue("messages", {
      data: [{ sender: "lead", content: "oi", created_at: "2026-04-22T00:00:01.000Z" }],
      error: null,
    });
    supabase.queue("agent_conversations", {
      data: { tokens_used_total: 0, variables: {} },
      error: null,
    });

    openaiMock.chat.completions.create
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "stop",
          message: { content: "Seguimos." },
        }],
        usage: { prompt_tokens: 40, completion_tokens: 20 },
      })
      .mockRejectedValueOnce(new Error("summary down"));

    const result = await executeAgent({
      db: asAgentDb(supabase as never),
      orgId: "org-a",
      provider: { sendText: vi.fn(async () => ({ ok: true })) } as never,
      dryRun: false,
      config: config(),
      stage: stage(),
      agentConversation: conversation({
        history_summary_run_count: 9,
        history_summary_token_count: 150,
      }),
      tools: [],
      inboundMessageId: "msg-a",
      leadId: "lead-a",
      crmConversationId: "crm-conv-a",
      msg: {
        messageId: "wamid.a",
        phone: "5511999990000",
        pushName: "Ana",
        text: "vamos",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.status).toBe("succeeded");
    expect(supabase.inserts.agent_steps[1]).toMatchObject({
      step_type: "summarization",
      output: expect.objectContaining({
        success: false,
        error: "summary down",
      }),
    });
    expect(
      supabase.updates.agent_conversations.some((update) =>
        Object.prototype.hasOwnProperty.call(update as Record<string, unknown>, "history_summary"),
      ),
    ).toBe(false);
    expect(supabase.updates.agent_conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          history_summary_run_count: 10,
          history_summary_token_count: 210,
        }),
      ]),
    );
  });

  it("executeAgent does not increment summarization counters on failed runs", async () => {
    delete process.env.OPENAI_API_KEY;
    const supabase = createSupabaseMock();
    supabase.queue("agent_runs", { data: { id: "run-a" }, error: null });

    const result = await executeAgent({
      db: asAgentDb(supabase as never),
      orgId: "org-a",
      dryRun: true,
      config: config(),
      stage: stage(),
      agentConversation: conversation(),
      tools: [],
      inboundMessageId: null,
      leadId: "lead-a",
      crmConversationId: "crm-conv-a",
      msg: {
        messageId: "wamid.a",
        phone: "5511999990000",
        pushName: "Ana",
        text: "oi",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.status).toBe("failed");
    expect(
      supabase.updates.agent_conversations?.some((update) =>
        Object.prototype.hasOwnProperty.call(update as Record<string, unknown>, "history_summary_run_count"),
      ) ?? false,
    ).toBe(false);
  });

  it("migration 020 stays idempotent and additive", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/020_ai_agent_context_summarization.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toContain("ADD COLUMN IF NOT EXISTS context_summary_turn_threshold");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS history_summary_updated_at");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS agent_steps_step_type_check");
    expect(sql).toContain("CHECK (step_type IN ('llm', 'tool', 'guardrail', 'summarization'))");
  });
});
