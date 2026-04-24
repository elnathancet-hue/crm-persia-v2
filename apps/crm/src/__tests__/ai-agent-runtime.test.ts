import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability", () => ({
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
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
import { isNativeAgentEnabled } from "@/lib/ai-agent/feature-flag";
import { executeAgent } from "@/lib/ai-agent/executor";
import { loadAgentConfigById } from "@/lib/ai-agent/context";
import { asAgentDb } from "@/lib/ai-agent/db";

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
    variables: {},
    tokens_used_total: 0,
    last_interaction_at: null,
    created_at: "2026-04-22T00:00:00.000Z",
    updated_at: "2026-04-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("native AI agent runtime", () => {
  beforeEach(() => {
    openaiMock.chat.completions.create.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("reads the native-agent flag from the current organization only", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { native_agent_enabled: true } } },
      error: null,
    });

    await expect(isNativeAgentEnabled("org-a", asAgentDb(supabase as never))).resolves.toBe(true);
    expect(supabase.filters.organizations.eq).toContainEqual(["id", "org-a"]);
  });

  it("fails closed when the feature flag cannot be read", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: null,
      error: { message: "db unavailable" },
    });

    await expect(isNativeAgentEnabled("org-a", asAgentDb(supabase as never))).resolves.toBe(false);
  });

  it("scopes config lookup by organization_id", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_configs", { data: null, error: null });

    await expect(
      loadAgentConfigById(asAgentDb(supabase as never), "org-a", "config-b"),
    ).resolves.toBeNull();
    expect(supabase.filters.agent_configs.eq).toContainEqual(["organization_id", "org-a"]);
    expect(supabase.filters.agent_configs.eq).toContainEqual(["id", "config-b"]);
  });

  it("records a failed tool step when the LLM asks for a tool outside the stage allowlist", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_runs", { data: { id: "run-a" }, error: null });
    supabase.queue("agent_conversations", {
      data: { tokens_used_total: 0, variables: {} },
      error: null,
    });
    openaiMock.chat.completions.create
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "tool-call-a",
              type: "function",
              function: {
                name: "stop_agent",
                arguments: JSON.stringify({ reason: "cliente pediu humano" }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      })
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "stop",
          message: { content: "Certo, vou continuar por aqui." },
        }],
        usage: { prompt_tokens: 15, completion_tokens: 8 },
      });

    const result = await executeAgent({
      db: asAgentDb(supabase as never),
      orgId: "org-a",
      dryRun: true,
      config: config(),
      stage: stage(),
      agentConversation: conversation(),
      tools: [],
      inboundMessageId: "msg-a",
      leadId: "lead-a",
      crmConversationId: "crm-conv-a",
      msg: {
        messageId: "wamid.a",
        phone: "5511999990000",
        pushName: "Ana",
        text: "quero falar com alguem",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.assistantReply).toBe("Certo, vou continuar por aqui.");
    expect(supabase.inserts.agent_steps).toHaveLength(3);
    expect(supabase.inserts.agent_steps[1]).toMatchObject({
      step_type: "tool",
      tool_id: null,
      native_handler: null,
      output: {
        success: false,
        error: "tool not allowed in current stage",
      },
    });
    expect(supabase.updates.agent_conversations?.[0]).not.toHaveProperty("human_handoff_at");
  });
});
