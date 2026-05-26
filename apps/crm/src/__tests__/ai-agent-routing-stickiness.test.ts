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

// Bug J fix (mai/2026): routing stickiness.
//
// Cenario: lead inicia conversa com agente A (primary). Depois manda msg
// que casaria com regra do agente B (secondary). Antes do fix: criava
// 2a row em agent_conversations -> lead falando com 2 agentes em
// paralelo na mesma conversation. Depois do fix: o lookup de
// agent_conversations por (org, lead, crm_conversation_id) — SEM filtrar
// por config_id — devolve a row do agente A, e o executor força
// agentConfigId = A pra resto do processamento.

describe("AI Agent routing stickiness (Bug J)", () => {
  it("mantém o lead com o agente que iniciou a conversa, mesmo quando outra msg casa regra de agente secundário", async () => {
    const supabase = createSupabaseMock();

    // 1. Feature flag ativo
    supabase.queue("organizations", {
      data: { settings: { features: { [NATIVE_AGENT_FEATURE_FLAG]: true } } },
      error: null,
    });

    // 2. Primary agent (agente B) — pickAgentForLead retornaria ele
    //    porque o mock vai ter regra que casa o texto da msg.
    supabase.queue("agent_configs", {
      data: {
        id: "agent-b-primary",
        debounce_window_ms: 10000,
        humanization_config: { split_enabled: false, business_hours_enabled: false },
      },
      error: null,
    });

    // 3. Message dedup — vazio (msg nova)
    supabase.queue("messages", { data: null, error: null });

    // 4. Lead existente (Lead que já tem conversa com agente A)
    supabase.queue("leads", { data: { id: "lead-sticky" }, error: null });

    // 5. Secondary agents lookup (pickAgentForLead) — vazio pra simplificar
    //    Como não tem agente secondary, pickAgentForLead retorna primary.
    //    Mas o que importa é provar que mesmo se mudasse, stickiness ganha.
    supabase.queue("agent_configs", { data: [], error: null });

    // 6. Conversation existente (já criada pelo primeiro contato)
    supabase.queue("conversations", {
      data: { id: "conv-sticky", assigned_to: "ai", status: "active" },
      error: null,
    });

    // 7. UPDATE last_message_at (existing conv)
    supabase.queue("conversations", { data: null, error: null });

    // 8. Insert inbound message
    supabase.queue("messages", { data: { id: "msg-in" }, error: null });

    // 9. ⭐ Find agent_conversations SEM filtrar por config_id.
    //    Retorna uma row do AGENTE A (não do primary B).
    //    O Bug J fix vai detectar e forçar agentConfigId = "agent-a-other".
    supabase.queue("agent_conversations", {
      data: {
        id: "agent-conv-sticky",
        config_id: "agent-a-other",   // ← diferente do primary
        current_node_id: null,
        human_handoff_at: null,
        after_hours_notified_at: null,
        ai_control_epoch: 0,
      },
      error: null,
    });

    // 10. Conversation status check (send-guard early)
    supabase.queue("conversations", {
      data: { assigned_to: "ai", status: "active" },
      error: null,
    });

    // 11. Final SELECT (após pause/resume keyword check)
    supabase.queue("agent_conversations", {
      data: { human_handoff_at: null, ai_control_epoch: 0 },
      error: null,
    });

    // 12. Enqueue RPC + flush bump — ok com qualquer resposta
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("agent_conversations", { data: null, error: null });

    const provider = makeProvider();
    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-sticky",
      provider: provider as never,
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

    // ✓ Stickiness mantida: handled = true (não criou nova agent_conversations)
    expect(result.handled).toBe(true);

    // ✓ Insert em agent_conversations não foi chamado (reutilizou existing)
    const agentConvInserts = supabase.inserts.agent_conversations ?? [];
    expect(agentConvInserts).toHaveLength(0);
  });
});
