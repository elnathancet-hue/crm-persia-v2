import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
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

import { CUSTOM_WEBHOOK_LIMITS, type AgentConfig, type AgentConversation, type AgentStage, type AgentTool } from "@persia/shared/ai-agent";
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { createCustomWebhookTool, updateTool } from "@/actions/ai-agent/tools";
import {
  addAllowedDomain,
  listAllowedDomains,
  removeAllowedDomain,
} from "@/actions/ai-agent/webhook-allowlist";
import { executeAgent } from "@/lib/ai-agent/executor";
import { asAgentDb } from "@/lib/ai-agent/db";
import * as webhookCaller from "@/lib/ai-agent/webhook-caller";
import type { WebhookCallerDeps } from "@/lib/ai-agent/webhook-caller";

const ORG_A = "org-a";

function stubAuth(supabase: MockSupabase, role: "admin" | "agent" = "admin") {
  vi.mocked(requireRole).mockResolvedValue({
    supabase,
    user: { id: "user-1" },
    orgId: ORG_A,
    userId: "user-1",
    role,
  } as never);
}

function asyncBody(chunks: string[]): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.from(chunk, "utf8");
      }
    },
  };
}

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "config-a",
    organization_id: ORG_A,
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
    created_at: "2026-04-23T00:00:00.000Z",
    updated_at: "2026-04-23T00:00:00.000Z",
    ...overrides,
  };
}

function stage(overrides: Partial<AgentStage> = {}): AgentStage {
  return {
    id: "stage-a",
    config_id: "config-a",
    organization_id: ORG_A,
    slug: "inicio",
    order_index: 0,
    situation: "Inicio",
    instruction: "Cumprimente o cliente.",
    transition_hint: null,
    rag_enabled: false,
    created_at: "2026-04-23T00:00:00.000Z",
    updated_at: "2026-04-23T00:00:00.000Z",
    ...overrides,
  };
}

function conversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: "agent-conv-a",
    organization_id: ORG_A,
    crm_conversation_id: "crm-conv-a",
    lead_id: "lead-a",
    config_id: "config-a",
    current_stage_id: "stage-a",
    history_summary: null,
    variables: {},
    tokens_used_total: 0,
    last_interaction_at: null,
    created_at: "2026-04-23T00:00:00.000Z",
    updated_at: "2026-04-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("ai-agent PR5 runtime", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    openaiMock.chat.completions.create.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("invokeCustomWebhook rejects bad schemes", async () => {
    const result = await webhookCaller.invokeCustomWebhook({
      tool_id: "tool-a",
      webhook_url: "http://hooks.example.com/run",
      webhook_secret: "12345678901234567890123456789012",
      payload: { ok: true },
      context: {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "crm-conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
      },
      allowlist: ["hooks.example.com"],
    });

    expect(result.success).toBe(false);
    expect(result.output.code).toBe("invalid_scheme");
  });

  it("invokeCustomWebhook rejects allowlist misses", async () => {
    const result = await webhookCaller.invokeCustomWebhook({
      tool_id: "tool-a",
      webhook_url: "https://hooks.example.com/run",
      webhook_secret: "12345678901234567890123456789012",
      payload: { ok: true },
      context: {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "crm-conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
      },
      allowlist: ["n8n.example.com"],
    });

    expect(result.success).toBe(false);
    expect(result.output.code).toBe("allowlist_miss");
  });

  it("invokeCustomWebhook rejects private IP resolutions", async () => {
    const result = await webhookCaller.invokeCustomWebhook(
      {
        tool_id: "tool-a",
        webhook_url: "https://hooks.example.com/run",
        webhook_secret: "12345678901234567890123456789012",
        payload: { ok: true },
        context: {
          organization_id: ORG_A,
          lead_id: "lead-a",
          crm_conversation_id: "crm-conv-a",
          agent_conversation_id: "agent-conv-a",
          run_id: "run-a",
          dry_run: true,
        },
        allowlist: ["hooks.example.com"],
      },
      {
        resolve4: vi.fn().mockResolvedValue(["127.0.0.1"]),
        resolve6: vi.fn().mockResolvedValue([]),
      },
    );

    expect(result.success).toBe(false);
    expect(result.output.code).toBe("private_ip_blocked");
  });

  it("invokeCustomWebhook rejects redirects", async () => {
    const result = await webhookCaller.invokeCustomWebhook(
      {
        tool_id: "tool-a",
        webhook_url: "https://hooks.example.com/run",
        webhook_secret: "12345678901234567890123456789012",
        payload: { ok: true },
        context: {
          organization_id: ORG_A,
          lead_id: "lead-a",
          crm_conversation_id: "crm-conv-a",
          agent_conversation_id: "agent-conv-a",
          run_id: "run-a",
          dry_run: true,
        },
        allowlist: ["hooks.example.com"],
      },
      {
        resolve4: vi.fn().mockResolvedValue(["93.184.216.34"]),
        resolve6: vi.fn().mockResolvedValue([]),
        request: vi.fn().mockResolvedValue({
          statusCode: 302,
          headers: {},
          body: asyncBody(["redirect"]),
        }),
      },
    );

    expect(result.success).toBe(false);
    expect(result.output.code).toBe("redirect_disallowed");
  });

  it("invokeCustomWebhook rejects oversized responses", async () => {
    const tooLarge = "x".repeat(CUSTOM_WEBHOOK_LIMITS.max_response_bytes + 1);
    const result = await webhookCaller.invokeCustomWebhook(
      {
        tool_id: "tool-a",
        webhook_url: "https://hooks.example.com/run",
        webhook_secret: "12345678901234567890123456789012",
        payload: { ok: true },
        context: {
          organization_id: ORG_A,
          lead_id: "lead-a",
          crm_conversation_id: "crm-conv-a",
          agent_conversation_id: "agent-conv-a",
          run_id: "run-a",
          dry_run: true,
        },
        allowlist: ["hooks.example.com"],
      },
      {
        resolve4: vi.fn().mockResolvedValue(["93.184.216.34"]),
        resolve6: vi.fn().mockResolvedValue([]),
        request: vi.fn().mockResolvedValue({
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: asyncBody([tooLarge]),
        }),
      },
    );

    expect(result.success).toBe(false);
    expect(result.output.code).toBe("response_too_large");
  });

  it("invokeCustomWebhook aborts on timeout", async () => {
    const request = vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    }) as unknown as NonNullable<WebhookCallerDeps["request"]>;

    const result = await webhookCaller.invokeCustomWebhook(
      {
        tool_id: "tool-a",
        webhook_url: "https://hooks.example.com/run",
        webhook_secret: "12345678901234567890123456789012",
        payload: { ok: true },
        context: {
          organization_id: ORG_A,
          lead_id: "lead-a",
          crm_conversation_id: "crm-conv-a",
          agent_conversation_id: "agent-conv-a",
          run_id: "run-a",
          dry_run: true,
        },
        allowlist: ["hooks.example.com"],
      },
      {
        resolve4: vi.fn().mockResolvedValue(["93.184.216.34"]),
        resolve6: vi.fn().mockResolvedValue([]),
        request,
      },
    );

    expect(result.success).toBe(false);
    expect(result.output.code).toBe("timeout");
  });

  it("invokeCustomWebhook signs the request and returns sanitized audit output", async () => {
    const now = vi.fn(() => 1_700_000_000_000);
    const request = vi.fn(async ({ body, headers }: { body: string; headers: Record<string, string> }) => {
      const expectedSignature = createHmac("sha256", "12345678901234567890123456789012")
        .update(`1700000000000.${body}`)
        .digest("hex");

      expect(headers[CUSTOM_WEBHOOK_LIMITS.signature_header]).toBe(`sha256=${expectedSignature}`);
      expect(headers["X-Persia-Timestamp"]).toBe("1700000000000");

      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: asyncBody(['{"ok":true,"message":"done"}']),
      };
    });

    const result = await webhookCaller.invokeCustomWebhook(
      {
        tool_id: "tool-a",
        webhook_url: "https://hooks.example.com/run",
        webhook_secret: "12345678901234567890123456789012",
        payload: { lead_id: "lead-a" },
        context: {
          organization_id: ORG_A,
          lead_id: "lead-a",
          crm_conversation_id: "crm-conv-a",
          agent_conversation_id: "agent-conv-a",
          run_id: "run-a",
          dry_run: false,
        },
        allowlist: ["hooks.example.com"],
      },
      {
        now,
        resolve4: vi.fn().mockResolvedValue(["93.184.216.34"]),
        resolve6: vi.fn().mockResolvedValue([]),
        request,
      },
    );

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ ok: true, message: "done" });
    expect(result.audit_output).toMatchObject({
      http_status: 200,
      url_host: "hooks.example.com",
      response_size_bytes: expect.any(Number),
      response_sha256: expect.any(String),
    });
    expect(result.audit_output).not.toHaveProperty("message");
  });

  it("createCustomWebhookTool rejects non-HTTPS URLs", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", {
      data: { id: "config-a", organization_id: ORG_A },
      error: null,
    });
    supabase.queue("organizations", {
      data: { settings: { webhook_allowlist: { domains: ["hooks.example.com"] } } },
      error: null,
    });

    await expect(
      createCustomWebhookTool({
        config_id: "config-a",
        name: "n8n lead sync",
        description: "Sincroniza lead",
        input_schema: { type: "object", properties: {} },
        webhook_url: "http://hooks.example.com/run",
        webhook_secret: "12345678901234567890123456789012",
      }),
    ).rejects.toThrow(/HTTPS/i);
  });

  it("createCustomWebhookTool rejects allowlist misses", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", {
      data: { id: "config-a", organization_id: ORG_A },
      error: null,
    });
    supabase.queue("organizations", {
      data: { settings: { webhook_allowlist: { domains: ["n8n.example.com"] } } },
      error: null,
    });

    await expect(
      createCustomWebhookTool({
        config_id: "config-a",
        name: "n8n lead sync",
        description: "Sincroniza lead",
        input_schema: { type: "object", properties: {} },
        webhook_url: "https://hooks.example.com/run",
        webhook_secret: "12345678901234567890123456789012",
      }),
    ).rejects.toThrow(/allowlist/i);
  });

  it("createCustomWebhookTool rejects short secrets", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", {
      data: { id: "config-a", organization_id: ORG_A },
      error: null,
    });

    await expect(
      createCustomWebhookTool({
        config_id: "config-a",
        name: "n8n lead sync",
        description: "Sincroniza lead",
        input_schema: { type: "object", properties: {} },
        webhook_url: "https://hooks.example.com/run",
        webhook_secret: "short-secret",
      }),
    ).rejects.toThrow(/32/);
  });

  it("createCustomWebhookTool inserts a webhook tool when URL and secret are valid", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    vi.spyOn(webhookCaller, "resolvePublicIps").mockResolvedValue(["93.184.216.34"]);
    supabase.queue("agent_configs", {
      data: { id: "config-a", organization_id: ORG_A },
      error: null,
    });
    supabase.queue("organizations", {
      data: { settings: { webhook_allowlist: { domains: ["hooks.example.com"] } } },
      error: null,
    });
    supabase.queue("agent_tools", {
      data: {
        id: "tool-a",
        organization_id: ORG_A,
        config_id: "config-a",
        name: "n8n lead sync",
        description: "Sincroniza lead",
        input_schema: { type: "object", properties: {} },
        execution_mode: "n8n_webhook",
        native_handler: null,
        webhook_url: "https://hooks.example.com/run",
        webhook_secret: "12345678901234567890123456789012",
        is_enabled: true,
      },
      error: null,
    });

    const tool = await createCustomWebhookTool({
      config_id: "config-a",
      name: "n8n lead sync",
      description: "Sincroniza lead",
      input_schema: { type: "object", properties: {} },
      webhook_url: "https://hooks.example.com/run",
      webhook_secret: "12345678901234567890123456789012",
    });

    expect(tool.execution_mode).toBe("n8n_webhook");
    expect(supabase.inserts.agent_tools?.[0]).toMatchObject({
      execution_mode: "n8n_webhook",
      native_handler: null,
      webhook_url: "https://hooks.example.com/run",
    });
  });

  it("updateTool revalidates webhook URL changes", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_tools", {
      data: {
        id: "tool-a",
        organization_id: ORG_A,
        config_id: "config-a",
        name: "n8n lead sync",
        description: "Sincroniza lead",
        input_schema: { type: "object", properties: {} },
        execution_mode: "n8n_webhook",
        native_handler: null,
        webhook_url: "https://hooks.example.com/run",
        webhook_secret: "12345678901234567890123456789012",
        is_enabled: true,
      },
      error: null,
    });
    supabase.queue("organizations", {
      data: { settings: { webhook_allowlist: { domains: ["hooks.example.com"] } } },
      error: null,
    });

    await expect(
      updateTool("tool-a", {
        webhook_url: "https://evil.example.com/run",
      }),
    ).rejects.toThrow(/allowlist/i);
  });

  it("list/add/remove allowlist domains normalize and persist settings", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    vi.spyOn(webhookCaller, "resolvePublicIps").mockResolvedValue(["93.184.216.34"]);

    supabase.queue("organizations", {
      data: {
        settings: {
          webhook_allowlist: {
            domains: ["hooks.example.com", "api.example.com"],
          },
        },
      },
      error: null,
    });
    await expect(listAllowedDomains()).resolves.toEqual(["api.example.com", "hooks.example.com"]);

    supabase.queue("organizations", {
      data: {
        settings: {
          webhook_allowlist: {
            domains: ["hooks.example.com"],
          },
        },
      },
      error: null,
    });
    await expect(addAllowedDomain({ domain: "HTTPS://API.EXAMPLE.COM/path" })).resolves.toEqual([
      "api.example.com",
      "hooks.example.com",
    ]);
    expect(supabase.updates.organizations?.[0]).toMatchObject({
      settings: {
        webhook_allowlist: {
          domains: ["api.example.com", "hooks.example.com"],
        },
      },
    });

    supabase.queue("organizations", {
      data: {
        settings: {
          webhook_allowlist: {
            domains: ["api.example.com", "hooks.example.com"],
          },
        },
      },
      error: null,
    });
    await expect(removeAllowedDomain("hooks.example.com")).resolves.toEqual(["api.example.com"]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/settings");
  });

  it("addAllowedDomain rejects private hosts", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    vi.spyOn(webhookCaller, "resolvePublicIps").mockRejectedValue(
      new Error("Webhook hostname resolves to a private or reserved IP"),
    );
    supabase.queue("organizations", {
      data: { settings: { webhook_allowlist: { domains: [] } } },
      error: null,
    });

    await expect(addAllowedDomain({ domain: "internal.example.com" })).rejects.toThrow(/private/i);
  });

  it("executeAgent routes n8n_webhook tools through the webhook caller and stores only sanitized audit metadata", async () => {
    const supabase = createSupabaseMock();
    vi.spyOn(webhookCaller, "invokeCustomWebhook").mockResolvedValue({
      success: true,
      output: { ok: true, external_id: "sync-123" },
      http_status: 200,
      duration_ms: 42,
      audit_output: {
        http_status: 200,
        duration_ms: 42,
        url_host: "hooks.example.com",
        body_sha256: "abc",
        response_size_bytes: 12,
        response_sha256: "def",
      },
    });

    supabase.queue("agent_runs", { data: { id: "run-a" }, error: null });
    supabase.queue("organizations", {
      data: { settings: { webhook_allowlist: { domains: ["hooks.example.com"] } } },
      error: null,
    });
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
                name: "custom_webhook",
                arguments: JSON.stringify({ lead_status: "qualified" }),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      })
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: "stop",
          message: { content: "Webhook executado com sucesso." },
        }],
        usage: { prompt_tokens: 8, completion_tokens: 4 },
      });

    const result = await executeAgent({
      db: asAgentDb(supabase as never),
      orgId: ORG_A,
      dryRun: true,
      config: config(),
      stage: stage(),
      agentConversation: conversation(),
      tools: [
        {
          id: "tool-a",
          organization_id: ORG_A,
          config_id: "config-a",
          name: "custom_webhook",
          description: "Chama n8n",
          input_schema: { type: "object", properties: {} },
          execution_mode: "n8n_webhook",
          native_handler: null,
          webhook_url: "https://hooks.example.com/run",
          webhook_secret: "12345678901234567890123456789012",
          is_enabled: true,
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T00:00:00.000Z",
        } satisfies AgentTool,
      ],
      inboundMessageId: "msg-a",
      leadId: "lead-a",
      crmConversationId: "crm-conv-a",
      msg: {
        messageId: "wamid.a",
        phone: "5511999990000",
        pushName: "Ana",
        text: "qualifica esse lead",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.assistantReply).toBe("Webhook executado com sucesso.");
    expect(vi.mocked(webhookCaller.invokeCustomWebhook)).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_id: "tool-a",
        allowlist: ["hooks.example.com"],
      }),
    );
    expect(supabase.inserts.agent_steps?.[1]).toMatchObject({
      step_type: "tool",
      output: {
        success: true,
        http_status: 200,
        url_host: "hooks.example.com",
        body_sha256: "abc",
        response_size_bytes: 12,
        response_sha256: "def",
      },
    });
    expect(
      (supabase.inserts.agent_steps?.[1] as { output: Record<string, unknown> }).output,
    ).not.toHaveProperty("external_id");
  });
});
