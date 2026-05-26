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

function queueBaseRows(
  supabase: ReturnType<typeof createSupabaseMock>,
  afterHoursNotifiedAt: string | null,
) {
  supabase.queue("organizations", {
    data: { settings: { features: { [NATIVE_AGENT_FEATURE_FLAG]: true } } },
    error: null,
  });
  supabase.queue("agent_configs", {
    data: {
      id: "agent-a",
      debounce_window_ms: 10000,
      humanization_config: {
        business_hours_enabled: true,
        business_hours_timezone: "America/Sao_Paulo",
        business_hours: {
          monday: null,
          tuesday: null,
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
          sunday: null,
        },
        after_hours_message: "Estamos fora do horario. Ja te respondo no proximo periodo.",
        split_enabled: false,
      },
    },
    error: null,
  });
  supabase.queue("messages", { data: null, error: null });
  supabase.queue("leads", { data: { id: "lead-a" }, error: null });
  supabase.queue("conversations", {
    data: { id: "conv-a", assigned_to: "ai", status: "active" },
    error: null,
  });
  // Existing conversation touch (`last_message_at`) awaits the update builder
  // in the mock, so it consumes one conversations result before the send guard.
  supabase.queue("conversations", { data: null, error: null });
  supabase.queue("messages", { data: { id: "msg-in" }, error: null });
  supabase.queue("agent_conversations", {
    data: {
      id: "agent-conv-a",
      current_node_id: null,
      human_handoff_at: null,
      after_hours_notified_at: afterHoursNotifiedAt,
      ai_control_epoch: 0,
    },
    error: null,
  });
  supabase.queue("conversations", {
    data: { assigned_to: "ai", status: "active" },
    error: null,
  });
  supabase.queue("agent_conversations", {
    data: { human_handoff_at: null, ai_control_epoch: 0 },
    error: null,
  });
}

function makeProvider() {
  return {
    name: "uazapi",
    sendText: vi.fn(async () => ({ success: true, messageId: "msg-out" })),
    setTyping: vi.fn(),
    getContactProfilePic: vi.fn(),
  };
}

describe("ai-agent business hours", () => {
  it("sends the after-hours message once and does not enqueue the flow", async () => {
    const supabase = createSupabaseMock();
    queueBaseRows(supabase, null);
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("agent_conversations", { data: null, error: null });
    const provider = makeProvider();

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-a",
      provider: provider as never,
      requestId: "req-a",
      msg: {
        messageId: "wa-in-1",
        phone: "+5511999999999",
        pushName: "Ana",
        text: "oi",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result).toMatchObject({
      handled: true,
      response: { status: "after_hours", handledBy: "ai_native_flow" },
    });
    expect(provider.sendText).toHaveBeenCalledWith({
      phone: "+5511999999999",
      message: "Estamos fora do horario. Ja te respondo no proximo periodo.",
    });
    expect(supabase.rpcCalls).toHaveLength(0);
    expect(supabase.updates.agent_conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ after_hours_notified_at: expect.any(String) }),
      ]),
    );
  });

  it("does not resend the after-hours message during cooldown", async () => {
    const supabase = createSupabaseMock();
    queueBaseRows(supabase, new Date().toISOString());
    const provider = makeProvider();

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-a",
      provider: provider as never,
      requestId: "req-a",
      msg: {
        messageId: "wa-in-2",
        phone: "+5511999999999",
        pushName: "Ana",
        text: "oi de novo",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result.response.status).toBe("after_hours");
    expect(provider.sendText).not.toHaveBeenCalled();
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("handles media-only inbound messages in the native path", async () => {
    const supabase = createSupabaseMock();
    queueBaseRows(supabase, null);
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("agent_conversations", { data: null, error: null });
    const provider = makeProvider();

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-a",
      provider: provider as never,
      requestId: "req-media",
      msg: {
        messageId: "wa-in-media",
        phone: "+5511999999999",
        pushName: "Ana",
        text: null,
        type: "image",
        mediaUrl: "https://cdn.example.com/exame.jpg",
        mediaMimeType: "image/jpeg",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result).toMatchObject({
      handled: true,
      response: { status: "after_hours", handledBy: "ai_native_flow" },
    });
    expect(supabase.inserts.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: null,
          media_url: "https://cdn.example.com/exame.jpg",
          media_type: "image/jpeg",
          type: "image",
        }),
      ]),
    );
    expect(provider.sendText).toHaveBeenCalledWith({
      phone: "+5511999999999",
      message: "Estamos fora do horario. Ja te respondo no proximo periodo.",
    });
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("stores the lead message but does not enqueue AI when the conversation is human-owned", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { [NATIVE_AGENT_FEATURE_FLAG]: true } } },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-a",
        debounce_window_ms: 10000,
        humanization_config: {
          business_hours_enabled: false,
          split_enabled: false,
        },
      },
      error: null,
    });
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("leads", { data: { id: "lead-a" }, error: null });
    supabase.queue("conversations", {
      data: { id: "conv-human", assigned_to: "user-1", status: "waiting_human" },
      error: null,
    });
    supabase.queue("conversations", { data: null, error: null });
    supabase.queue("messages", { data: { id: "msg-in-human" }, error: null });
    const provider = makeProvider();

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-a",
      provider: provider as never,
      requestId: "req-human",
      msg: {
        messageId: "wa-in-human",
        phone: "+5511999999999",
        pushName: "Ana",
        text: "massa",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result).toMatchObject({
      handled: true,
      response: {
        handledBy: "ai_native_flow",
        status: "human_owned_conversation",
        conversationId: "conv-human",
      },
    });
    expect(supabase.inserts.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversation_id: "conv-human",
          content: "massa",
          sender: "lead",
        }),
      ]),
    );
    expect(supabase.inserts.agent_conversations ?? []).toHaveLength(0);
    expect(supabase.updates.agent_conversations ?? []).toHaveLength(0);
    expect(supabase.rpcCalls).toHaveLength(0);
    expect(provider.sendText).not.toHaveBeenCalled();
  });

  it("resume keyword restores AI ownership for a human-owned conversation", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organizations", {
      data: { settings: { features: { [NATIVE_AGENT_FEATURE_FLAG]: true } } },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-a",
        debounce_window_ms: 10000,
        humanization_config: {
          business_hours_enabled: false,
          split_enabled: false,
          resume_keywords: ["ATIVAR"],
        },
      },
      error: null,
    });
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("leads", { data: { id: "lead-a" }, error: null });
    supabase.queue("agent_configs", { data: [], error: null });
    supabase.queue("conversations", {
      data: { id: "conv-human", assigned_to: "user-1", status: "waiting_human" },
      error: null,
    });
    supabase.queue("conversations", { data: null, error: null });
    supabase.queue("messages", { data: { id: "msg-resume" }, error: null });
    supabase.queue("agent_conversations", {
      data: {
        id: "agent-conv-human",
        config_id: "agent-a",
        current_node_id: null,
        human_handoff_at: "2026-05-26T10:00:00.000Z",
        after_hours_notified_at: null,
        ai_control_epoch: 7,
      },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-a",
        debounce_window_ms: 10000,
        humanization_config: {
          business_hours_enabled: false,
          split_enabled: false,
          resume_keywords: ["ATIVAR"],
        },
        new_lead_stage_id: null,
      },
      error: null,
    });
    supabase.queue("agent_flows", { data: null, error: null });

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-a",
      provider: makeProvider() as never,
      requestId: "req-resume",
      msg: {
        messageId: "wa-resume",
        phone: "+5511999999999",
        pushName: "Ana",
        text: "ATIVAR",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result).toMatchObject({
      handled: true,
      response: { status: "enqueued", conversationId: "conv-human" },
    });
    expect(supabase.updates.agent_conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          human_handoff_at: null,
          human_handoff_reason: null,
          ai_control_epoch: 8,
        }),
      ]),
    );
    expect(supabase.updates.conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assigned_to: "ai", status: "active" }),
      ]),
    );
    expect(supabase.rpcCalls[0]).toMatchObject({
      fn: "enqueue_pending_message",
      args: {
        p_agent_conversation_id: "agent-conv-human",
        p_text: "ATIVAR",
      },
    });
  });
});
