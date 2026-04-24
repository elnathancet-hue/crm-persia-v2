import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, AgentConversation } from "@persia/shared/ai-agent";
import {
  HANDOFF_DEFAULT_TEMPLATE,
  renderHandoffTemplate,
  type HandoffNotificationVariables,
} from "@persia/shared/ai-agent";
import { logError } from "@/lib/observability";
import {
  normalizeHandoffTargetAddress,
  sendHandoffNotification,
} from "@/lib/ai-agent/handoff-notification";
import { stopAgentHandler } from "@/lib/ai-agent/tools/stop-agent";
import { normalizeAgentInput, normalizeAgentPatch } from "@/actions/ai-agent/utils";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability", () => ({
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "config-a",
    organization_id: "org-a",
    name: "Recepcao",
    description: null,
    scope_type: "global",
    scope_id: null,
    model: "claude-sonnet-4-6",
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
    handoff_notification_enabled: false,
    handoff_notification_target_type: null,
    handoff_notification_target_address: null,
    handoff_notification_template: null,
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
    created_at: "2026-04-23T00:00:00.000Z",
    updated_at: "2026-04-23T00:00:00.000Z",
    ...overrides,
  };
}

const vars: HandoffNotificationVariables = {
  lead_name: "Maria Silva",
  lead_phone: "+5511999999999",
  summary: "Cliente quer migrar ainda hoje.",
  wa_link: "https://crm.funilpersia.top/chat/crm-conv-a",
  agent_name: "Recepcao",
  handoff_reason: "cliente pediu humano",
};

describe("ai-agent PR5.6 runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PERSIA_APP_URL;
  });

  it("renderHandoffTemplate replaces known vars and unknown placeholders become empty", () => {
    const rendered = renderHandoffTemplate(
      "Lead {{lead_name}} / {{lead_phone}} / {{missing}}",
      vars,
    );

    expect(rendered).toBe("Lead Maria Silva / +5511999999999 / ");
  });

  it("renderHandoffTemplate falls back to default when template is empty", () => {
    expect(renderHandoffTemplate("", vars)).toBe(
      renderHandoffTemplate(HANDOFF_DEFAULT_TEMPLATE, vars),
    );
  });

  it("sendHandoffNotification skips cleanly when disabled", async () => {
    const result = await sendHandoffNotification({
      db: createSupabaseMock() as never,
      orgId: "org-a",
      runId: "run-a",
      stepOrderIndex: 2,
      config: config(),
      conversation: conversation(),
      leadId: "lead-a",
      handoffReason: "cliente pediu humano",
      provider: null,
      anthropicClient: null,
    });

    expect(result).toEqual({
      attempted: false,
      sent: false,
      audit: { enabled: false },
    });
  });

  it("sendHandoffNotification skips when target is missing despite enabled flag", async () => {
    const result = await sendHandoffNotification({
      db: createSupabaseMock() as never,
      orgId: "org-a",
      runId: "run-a",
      stepOrderIndex: 2,
      config: config({ handoff_notification_enabled: true }),
      conversation: conversation(),
      leadId: "lead-a",
      handoffReason: "cliente pediu humano",
      provider: { name: "uazapi", sendText: vi.fn() } as never,
      anthropicClient: null,
    });

    expect(result.attempted).toBe(false);
    expect(result.sent).toBe(false);
    expect(result.audit).toMatchObject({ skipped: "missing_target" });
  });

  it("sendHandoffNotification uses history_summary when present and does not call Claude", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: { name: "Maria", phone: "5511999999999" },
      error: null,
    });
    const provider = { name: "uazapi", sendText: vi.fn(async () => ({ success: true })) } as never;
    const anthropicClient = { messages: { create: vi.fn() } } as never;

    const result = await sendHandoffNotification({
      db: supabase as never,
      orgId: "org-a",
      runId: "run-a",
      stepOrderIndex: 3,
      config: config({
        handoff_notification_enabled: true,
        handoff_notification_target_type: "phone",
        handoff_notification_target_address: "5511999991111",
      }),
      conversation: conversation({
        history_summary: "Resumo grande que sera reaproveitado.",
      }),
      leadId: "lead-a",
      handoffReason: "cliente pediu humano",
      provider,
      anthropicClient,
    });

    expect(result.sent).toBe(true);
    expect(provider.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "5511999991111",
        message: expect.stringContaining("Resumo grande que sera reaproveitado."),
      }),
    );
    expect(anthropicClient.messages.create).not.toHaveBeenCalled();
  });

  it("sendHandoffNotification falls back to Claude summary when history_summary is absent", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: { name: "Maria", phone: "5511999999999" },
      error: null,
    });
    supabase.queue("messages", {
      data: [
        { sender: "lead", content: "Preciso de ajuda", media_url: null },
        { sender: "ai", content: "Claro, vou transferir", media_url: null },
      ],
      error: null,
    });
    const provider = { name: "uazapi", sendText: vi.fn(async () => ({ success: true })) } as never;
    const anthropicClient = {
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: "text", text: "Lead com urgencia e contexto resumido." }],
        })),
      },
    } as never;

    const result = await sendHandoffNotification({
      db: supabase as never,
      orgId: "org-a",
      runId: "run-a",
      stepOrderIndex: 3,
      config: config({
        handoff_notification_enabled: true,
        handoff_notification_target_type: "phone",
        handoff_notification_target_address: "5511999991111",
      }),
      conversation: conversation(),
      leadId: "lead-a",
      handoffReason: "cliente pediu humano",
      provider,
      anthropicClient,
    });

    expect(result.sent).toBe(true);
    expect(anthropicClient.messages.create).toHaveBeenCalled();
    expect(result.audit).toMatchObject({
      summary_source: "claude",
      target_type: "phone",
    });
  });

  it("sendHandoffNotification falls back to plain text when Claude fails", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: { name: "Maria", phone: "5511999999999" },
      error: null,
    });
    supabase.queue("messages", {
      data: [{ sender: "lead", content: "Oi", media_url: null }],
      error: null,
    });
    const provider = { name: "uazapi", sendText: vi.fn(async () => ({ success: true })) } as never;
    const anthropicClient = {
      messages: {
        create: vi.fn(async () => {
          throw new Error("claude down");
        }),
      },
    } as never;

    const result = await sendHandoffNotification({
      db: supabase as never,
      orgId: "org-a",
      runId: "run-a",
      stepOrderIndex: 3,
      config: config({
        handoff_notification_enabled: true,
        handoff_notification_target_type: "phone",
        handoff_notification_target_address: "5511999991111",
      }),
      conversation: conversation(),
      leadId: "lead-a",
      handoffReason: "cliente pediu humano",
      provider,
      anthropicClient,
    });

    expect(result.sent).toBe(true);
    expect(provider.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Lead acionou o agente e pediu atendimento humano."),
      }),
    );
    expect(result.audit).toMatchObject({ summary_source: "fallback_plain" });
  });

  it("sendHandoffNotification fails soft when provider throws", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: { name: "Maria", phone: "5511999999999" },
      error: null,
    });
    const provider = {
      name: "uazapi",
      sendText: vi.fn(async () => {
        throw new Error("provider down");
      }),
    } as never;

    const result = await sendHandoffNotification({
      db: supabase as never,
      orgId: "org-a",
      runId: "run-a",
      stepOrderIndex: 3,
      config: config({
        handoff_notification_enabled: true,
        handoff_notification_target_type: "group",
        handoff_notification_target_address: "1203@g.us",
      }),
      conversation: conversation({
        history_summary: "Resumo existente.",
      }),
      leadId: "lead-a",
      handoffReason: "cliente pediu humano",
      provider,
      anthropicClient: null,
    });

    expect(result.attempted).toBe(true);
    expect(result.sent).toBe(false);
    expect(result.error).toBe("provider down");
    expect(vi.mocked(logError)).toHaveBeenCalled();
  });

  it("normalizeHandoffTargetAddress sanitizes phone and preserves group jid", () => {
    expect(normalizeHandoffTargetAddress("phone", "(11) 99999-9999")).toBe("11999999999");
    expect(normalizeHandoffTargetAddress("group", "1203@g.us")).toBe("1203@g.us");
  });

  it("normalizeAgentInput and normalizeAgentPatch reject invalid handoff configs", () => {
    expect(() =>
      normalizeAgentInput({
        name: "Recepcao",
        scope_type: "global",
        model: "claude-sonnet-4-6",
        system_prompt: "Prompt",
        handoff_notification_enabled: true,
      }),
    ).toThrow(/Configure o destino da notificacao/);

    expect(() =>
      normalizeAgentPatch(
        {
          handoff_notification_enabled: true,
        },
        config(),
      ),
    ).toThrow(/Configure o destino da notificacao/);

    expect(() =>
      normalizeAgentPatch(
        {
          handoff_notification_enabled: true,
          handoff_notification_target_type: "phone",
          handoff_notification_target_address: "123",
        },
        config(),
      ),
    ).toThrow(/Telefone da notificacao invalido/);

    expect(() =>
      normalizeAgentPatch(
        {
          handoff_notification_template: "x".repeat(1501),
        },
        config(),
      ),
    ).toThrow(/1500/);
  });

  it("stopAgentHandler dry_run simulates without notification attempt", async () => {
    const result = await stopAgentHandler(
      {
        organization_id: "org-a",
        lead_id: "lead-a",
        crm_conversation_id: "crm-conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        config: config({
          handoff_notification_enabled: true,
          handoff_notification_target_type: "group",
          handoff_notification_target_address: "1203@g.us",
        }),
        agentConversation: conversation({
          history_summary: "Resumo existente.",
        }),
      } as never,
      { reason: "cliente pediu humano" },
    );

    expect(result.success).toBe(true);
    expect(result.output.handoff_notification).toMatchObject({
      attempted: false,
      simulated: true,
    });
  });

  it("stopAgentHandler sends handoff notification when enabled", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: { name: "Maria", phone: "5511999999999" },
      error: null,
    });
    const provider = {
      name: "uazapi",
      sendText: vi.fn(async () => ({ success: true })),
    } as never;

    const result = await stopAgentHandler(
      {
        organization_id: "org-a",
        lead_id: "lead-a",
        crm_conversation_id: "crm-conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: false,
        db: supabase,
        provider,
        config: config({
          handoff_notification_enabled: true,
          handoff_notification_target_type: "group",
          handoff_notification_target_address: "1203@g.us",
        }),
        agentConversation: conversation({
          history_summary: "Resumo existente.",
        }),
        stepOrderIndex: 4,
      } as never,
      { reason: "cliente pediu humano" },
    );

    expect(result.success).toBe(true);
    expect(provider.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "1203@g.us",
      }),
    );
    expect(result.output.handoff_notification).toMatchObject({
      attempted: true,
      sent: true,
      audit: expect.objectContaining({
        target_type: "group",
        step_order_index: 4,
      }),
    });
    expect(supabase.inserts.lead_activities).toHaveLength(1);
  });

  it("migration 021 keeps the defensive checks", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/021_ai_agent_handoff_notification.sql", import.meta.url),
      "utf8",
    );

    expect(sql).toContain("agent_configs_handoff_target_type_check");
    expect(sql).toContain("agent_configs_handoff_target_consistency_check");
    expect(sql).toContain("agent_configs_handoff_template_length_check");
    expect(sql).toContain("handoff_notification_enabled = false");
    expect(sql).toContain("char_length(handoff_notification_template) <= 1500");
  });
});
