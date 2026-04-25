import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentConfig,
  AgentConversation,
  AgentStage,
  AgentTool,
} from "@persia/shared/ai-agent";
import { asAgentDb } from "@/lib/ai-agent/db";
import { executeAgent } from "@/lib/ai-agent/executor";
import { triggerNotificationHandler } from "@/lib/ai-agent/tools/trigger-notification";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability", () => ({
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  getRequestId: vi.fn(() => "req-pr7"),
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
    context_summary_token_threshold: 20000,
    context_summary_recent_messages: 6,
    handoff_notification_enabled: false,
    handoff_notification_target_type: null,
    handoff_notification_target_address: null,
    handoff_notification_template: null,
    status: "active",
    created_at: "2026-04-25T00:00:00.000Z",
    updated_at: "2026-04-25T00:00:00.000Z",
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
    rag_top_k: 3,
    created_at: "2026-04-25T00:00:00.000Z",
    updated_at: "2026-04-25T00:00:00.000Z",
    ...overrides,
  };
}

function conversation(
  overrides: Partial<AgentConversation> = {},
): AgentConversation {
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
    created_at: "2026-04-25T00:00:00.000Z",
    updated_at: "2026-04-25T00:00:00.000Z",
    ...overrides,
  };
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: "template-a",
    organization_id: "org-a",
    config_id: "config-a",
    name: "Lead Qualificado",
    description: "Use when the lead is qualified.",
    target_type: "phone",
    target_address: "5511999991111",
    body_template:
      "Lead {{lead_name}} pediu {{custom.produto}}. Abrir {{wa_link}}",
    status: "active",
    created_at: "2026-04-25T00:00:00.000Z",
    updated_at: "2026-04-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("ai-agent PR7.1 trigger_notification runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PERSIA_APP_URL;
    process.env.OPENAI_API_KEY = "openai-test-key";
  });

  it("resolves template names case-insensitively", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_notification_templates", {
      data: [template({ name: "  LeAd QuAlIfIcAdO  " })],
      error: null,
    });
    supabase.queue("leads", {
      data: { id: "lead-a", name: "Maria", phone: "5511999990000" },
      error: null,
    });

    const result = await triggerNotificationHandler(
      {
        organization_id: "org-a",
        lead_id: "lead-a",
        crm_conversation_id: "crm-conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase,
        config: config(),
      } as never,
      {
        template_name: "lead qualificado",
        custom: { produto: "Plano Anual" },
      },
    );

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      template_id: "template-a",
      template_name: "  LeAd QuAlIfIcAdO  ",
      target_type: "phone",
      target_address_masked: "***1111",
      dry_run: true,
    });
    expect(result.output.rendered_body).toContain("Plano Anual");
    expect(supabase.filters.agent_notification_templates.eq).toContainEqual([
      "organization_id",
      "org-a",
    ]);
    expect(supabase.filters.agent_notification_templates.eq).toContainEqual([
      "config_id",
      "config-a",
    ]);
  });

  it("returns success false when the template is archived", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_notification_templates", {
      data: [template({ status: "archived" })],
      error: null,
    });

    const result = await triggerNotificationHandler(
      {
        organization_id: "org-a",
        lead_id: "lead-a",
        crm_conversation_id: "crm-conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase,
        config: config(),
      } as never,
      { template_name: "Lead Qualificado" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/archived/i);
  });

  it("rejects custom payloads with more than 20 keys", async () => {
    const custom = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`k${index}`, "x"]),
    );

    const result = await triggerNotificationHandler(
      {
        organization_id: "org-a",
        lead_id: "lead-a",
        crm_conversation_id: "crm-conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
      } as never,
      { template_name: "Lead Qualificado", custom },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/at most 20 keys/i);
  });

  it("rejects oversized custom values", async () => {
    const result = await triggerNotificationHandler(
      {
        organization_id: "org-a",
        lead_id: "lead-a",
        crm_conversation_id: "crm-conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
      } as never,
      {
        template_name: "Lead Qualificado",
        custom: { produto: "x".repeat(201) },
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exceeds 200 chars/i);
  });

  it("dry-run renders the body without calling the provider", async () => {
    const supabase = createSupabaseMock();
    const provider = {
      name: "uazapi",
      sendText: vi.fn(async () => ({ success: true, messageId: "msg-a" })),
    };
    supabase.queue("agent_notification_templates", {
      data: [template()],
      error: null,
    });
    supabase.queue("leads", {
      data: { id: "lead-a", name: "Maria", phone: "5511999990000" },
      error: null,
    });

    const result = await triggerNotificationHandler(
      {
        organization_id: "org-a",
        lead_id: "lead-a",
        crm_conversation_id: "crm-conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase,
        provider,
        config: config(),
      } as never,
      {
        template_name: "Lead Qualificado",
        custom: { produto: "Plano Premium" },
      },
    );

    expect(result.success).toBe(true);
    expect(result.output.rendered_body).toContain("Plano Premium");
    expect(result.output.message_id).toBeNull();
    expect(provider.sendText).not.toHaveBeenCalled();
  });

  it("returns success false when the provider throws", async () => {
    const supabase = createSupabaseMock();
    const provider = {
      name: "uazapi",
      sendText: vi.fn(async () => {
        throw new Error("provider down");
      }),
    };
    supabase.queue("agent_notification_templates", {
      data: [template({ target_type: "group", target_address: "1203@g.us" })],
      error: null,
    });
    supabase.queue("leads", {
      data: { id: "lead-a", name: "Maria", phone: "5511999990000" },
      error: null,
    });

    const result = await triggerNotificationHandler(
      {
        organization_id: "org-a",
        lead_id: "lead-a",
        crm_conversation_id: "crm-conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: false,
        db: supabase,
        provider,
        config: config(),
      } as never,
      { template_name: "Lead Qualificado" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("provider down");
    expect(result.output).toMatchObject({
      template_id: "template-a",
      target_type: "group",
      target_address_masked: "***g.us@g.us",
    });
  });

  it("executor audit stores masked target address in the tool step", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_runs", { data: { id: "run-a" }, error: null });
    supabase.queue("messages", { data: [], error: null });
    supabase.queue("agent_notification_templates", {
      data: [template()],
      error: null,
    });
    supabase.queue("leads", {
      data: { id: "lead-a", name: "Maria", phone: "5511999990000" },
      error: null,
    });
    supabase.queue("agent_conversations", {
      data: { tokens_used_total: 0, variables: {} },
      error: null,
    });

    openaiMock.chat.completions.create
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "tool-call-a",
                  type: "function",
                  function: {
                    name: "notify_lead_qualificado",
                    arguments: JSON.stringify({
                      template_name: "Lead Qualificado",
                      custom: { produto: "Plano Gold" },
                    }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      })
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "Notificacao preparada." },
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 3 },
      });

    const result = await executeAgent({
      db: asAgentDb(supabase as never),
      orgId: "org-a",
      dryRun: true,
      config: config(),
      stage: stage(),
      agentConversation: conversation(),
      tools: [
        {
          id: "tool-a",
          organization_id: "org-a",
          config_id: "config-a",
          name: "notify_lead_qualificado",
          description: "Send qualified lead notification",
          input_schema: {
            type: "object",
            properties: {
              template_name: { type: "string" },
              custom: { type: "object" },
            },
            required: ["template_name"],
          },
          execution_mode: "native",
          native_handler: "trigger_notification",
          webhook_url: null,
          webhook_secret: null,
          is_enabled: true,
          created_at: "2026-04-25T00:00:00.000Z",
          updated_at: "2026-04-25T00:00:00.000Z",
        } satisfies AgentTool,
      ],
      inboundMessageId: "msg-a",
      leadId: "lead-a",
      crmConversationId: "crm-conv-a",
      allowSummarization: false,
      msg: {
        messageId: "wamid.a",
        phone: "5511999990000",
        pushName: "Ana",
        text: "qualifiquei o lead",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.status).toBe("succeeded");
    expect(supabase.inserts.agent_steps[1]).toMatchObject({
      step_type: "tool",
      native_handler: "trigger_notification",
      input: {
        template_name: "Lead Qualificado",
        custom: { produto: "Plano Gold" },
      },
      output: expect.objectContaining({
        success: true,
        target_address_masked: "***1111",
      }),
    });
  });

  it("keeps tenant scoping when the caller org cannot see another org template", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_notification_templates", {
      data: [],
      error: null,
    });

    const result = await triggerNotificationHandler(
      {
        organization_id: "org-a",
        lead_id: "lead-a",
        crm_conversation_id: "crm-conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase,
        config: config(),
      } as never,
      { template_name: "template da org b" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(supabase.filters.agent_notification_templates.eq).toContainEqual([
      "organization_id",
      "org-a",
    ]);
    expect(supabase.filters.agent_notification_templates.eq).toContainEqual([
      "config_id",
      "config-a",
    ]);
  });

  it("migration 023 keeps the notification schema and rpc surface additive", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/023_ai_agent_notifications.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.agent_notification_templates");
    expect(sql).toContain("target_type IN ('phone', 'group')");
    expect(sql).toContain("char_length(body_template) BETWEEN 1 AND 1500");
  });
});
