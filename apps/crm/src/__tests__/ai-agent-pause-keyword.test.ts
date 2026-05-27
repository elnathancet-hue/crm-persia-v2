// Backlog #8 Auditoria (mai/2026) — teste do matchPause atualizando
// `conversations.assigned_to` + `status` pra paridade com matchResume.
//
// Endereca rodada 7 #4 do POST_CODEX_AUDIT_AGENT_FLOW_353.md. Antes,
// lead mandava "PAUSAR" e so `agent_conversations.human_handoff_at`
// era setado — `conversations` continuava com `assigned_to="ai"
// status="active"`, deixando operador sem visibilidade de que a IA
// estava pausada por keyword.

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

describe("Backlog #8: matchPause espelha matchResume em conversations", () => {
  it("PAUSAR seta human_handoff_at + atualiza conversations.assigned_to=null status=waiting_human", async () => {
    const supabase = createSupabaseMock();

    supabase.queue("organizations", {
      data: { settings: { features: { [NATIVE_AGENT_FEATURE_FLAG]: true } } },
      error: null,
    });
    // Primary agent — pause_keywords default ["PAUSAR", "HUMANO", "STOP IA"]
    supabase.queue("agent_configs", {
      data: {
        id: "agent-primary",
        debounce_window_ms: 10000,
        humanization_config: {
          split_enabled: false,
          business_hours_enabled: false,
        },
      },
      error: null,
    });
    // dedup messages
    supabase.queue("messages", { data: null, error: null });
    // lead existing
    supabase.queue("leads", { data: { id: "lead-pause" }, error: null });
    // pickAgentForLead: sem secundarios
    supabase.queue("agent_configs", { data: [], error: null });
    // conversation ja existe + assigned_to=ai (estado da conv antes do pause)
    supabase.queue("conversations", {
      data: { id: "conv-pause", assigned_to: "ai", status: "active" },
      error: null,
    });
    // UPDATE last_message_at
    supabase.queue("conversations", { data: null, error: null });
    // insert da inbound message "PAUSAR"
    supabase.queue("messages", { data: { id: "msg-pause-in" }, error: null });
    // agent_conversations existing
    supabase.queue("agent_conversations", {
      data: {
        id: "agent-conv-pause",
        config_id: "agent-primary",
        current_node_id: null,
        human_handoff_at: null,
        after_hours_notified_at: null,
        ai_control_epoch: 3,
      },
      error: null,
    });

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-pause",
      provider: makeProvider() as never,
      requestId: "req-pause",
      msg: {
        messageId: "wa-pause-1",
        phone: "+5511999999999",
        pushName: "Lead",
        text: "PAUSAR",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    // Webhook retorna paused_by_keyword (e nao enfileira).
    expect(result).toMatchObject({
      handled: true,
      response: { status: "paused_by_keyword" },
    });

    // agent_conversations.update: human_handoff_at + reason + epoch bump
    const agentConvUpdates =
      (supabase.updates.agent_conversations as Array<Record<string, unknown>>) ?? [];
    expect(agentConvUpdates).toHaveLength(1);
    expect(agentConvUpdates[0]).toMatchObject({
      human_handoff_reason: "pause_keyword",
      ai_control_epoch: 4, // bumped from 3
    });
    expect(agentConvUpdates[0]?.human_handoff_at).toBeDefined();

    // conversations.update: paridade com matchResume (que vira ai/active).
    // Aqui vira null/waiting_human pra operador ver o estado.
    const convUpdates =
      (supabase.updates.conversations as Array<Record<string, unknown>>) ?? [];
    const pauseUpdate = convUpdates.find(
      (u) => u.assigned_to === null && u.status === "waiting_human",
    );
    expect(pauseUpdate).toBeDefined();
    expect(pauseUpdate).toMatchObject({
      assigned_to: null,
      status: "waiting_human",
    });
  });
});
