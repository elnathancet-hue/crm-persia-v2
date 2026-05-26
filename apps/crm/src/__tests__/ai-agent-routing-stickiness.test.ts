import { describe, expect, it, vi } from "vitest";
import { NATIVE_AGENT_FEATURE_FLAG } from "@persia/shared/ai-agent";
import { tryEnqueueForNativeAgent } from "@/lib/ai-agent/executor";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/observability", () => ({
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

function makeProvider() {
  return {
    name: "uazapi",
    sendText: vi.fn(async () => ({ success: true, messageId: "msg-out" })),
    setTyping: vi.fn(),
    getContactProfilePic: vi.fn(),
  };
}

describe("AI Agent routing stickiness", () => {
  it("mantem o lead com o agente que iniciou a conversa e usa a config desse agente", async () => {
    const supabase = createSupabaseMock();

    supabase.queue("organizations", {
      data: { settings: { features: { [NATIVE_AGENT_FEATURE_FLAG]: true } } },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-b-primary",
        debounce_window_ms: 10000,
        humanization_config: { split_enabled: false, business_hours_enabled: false },
      },
      error: null,
    });
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("leads", { data: { id: "lead-sticky" }, error: null });
    supabase.queue("agent_configs", { data: [], error: null });
    supabase.queue("conversations", {
      data: { id: "conv-sticky", assigned_to: "ai", status: "active" },
      error: null,
    });
    supabase.queue("conversations", { data: null, error: null });
    supabase.queue("messages", { data: { id: "msg-in" }, error: null });
    supabase.queue("agent_conversations", {
      data: {
        id: "agent-conv-sticky",
        config_id: "agent-a-other",
        current_node_id: null,
        human_handoff_at: null,
        after_hours_notified_at: null,
        ai_control_epoch: 0,
      },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-a-other",
        debounce_window_ms: 42000,
        humanization_config: { split_enabled: false, business_hours_enabled: false },
        new_lead_stage_id: null,
      },
      error: null,
    });

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-sticky",
      provider: makeProvider() as never,
      requestId: "req-sticky",
      msg: {
        messageId: "wa-sticky-2",
        phone: "+5511999999999",
        pushName: "Ana",
        text: "preciso de suporte tecnico",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.handled).toBe(true);
    expect(supabase.inserts.agent_conversations ?? []).toHaveLength(0);
    expect(supabase.rpcCalls[0]).toMatchObject({
      fn: "enqueue_pending_message",
      args: {
        p_agent_conversation_id: "agent-conv-sticky",
        p_debounce_window_ms: 42000,
      },
    });
  });

  it("continua conversa existente sem reaplicar o entry trigger keyword_match", async () => {
    const supabase = createSupabaseMock();

    supabase.queue("organizations", {
      data: { settings: { features: { [NATIVE_AGENT_FEATURE_FLAG]: true } } },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-keyword",
        debounce_window_ms: 10000,
        humanization_config: { split_enabled: false, business_hours_enabled: false },
      },
      error: null,
    });
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("leads", { data: { id: "lead-keyword" }, error: null });
    supabase.queue("agent_configs", { data: [], error: null });
    supabase.queue("conversations", {
      data: { id: "conv-keyword", assigned_to: "ai", status: "active" },
      error: null,
    });
    supabase.queue("conversations", { data: null, error: null });
    supabase.queue("messages", { data: { id: "msg-keyword-2" }, error: null });
    supabase.queue("agent_conversations", {
      data: {
        id: "agent-conv-keyword",
        config_id: "agent-keyword",
        current_node_id: "ai-collect-data",
        human_handoff_at: null,
        after_hours_notified_at: null,
        ai_control_epoch: 0,
      },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-keyword",
        debounce_window_ms: 10000,
        humanization_config: { split_enabled: false, business_hours_enabled: false },
        new_lead_stage_id: null,
      },
      error: null,
    });

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-keyword",
      provider: makeProvider() as never,
      requestId: "req-keyword",
      msg: {
        messageId: "wa-keyword-2",
        phone: "+5511999999999",
        pushName: "Ana",
        text: "meu nome e Ana",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result).toMatchObject({
      handled: true,
      response: { status: "enqueued" },
    });
    expect(supabase.selects.agent_flows).toBeUndefined();
    expect(supabase.rpcCalls).toHaveLength(1);
  });
});
