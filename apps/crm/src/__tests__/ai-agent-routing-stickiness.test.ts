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
  it("aplica CRM inicial do agente secundario quando lead novo e roteado por condition", async () => {
    const supabase = createSupabaseMock();

    supabase.queue("organizations", {
      data: { settings: { features: { [NATIVE_AGENT_FEATURE_FLAG]: true } } },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-primary",
        debounce_window_ms: 10000,
        humanization_config: { split_enabled: false, business_hours_enabled: false },
        new_lead_stage_id: "stage-primary",
      },
      error: null,
    });
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("leads", { data: null, error: null });
    supabase.queue("leads", { data: { id: "lead-new" }, error: null });
    supabase.queue("agent_configs", {
      data: [
        {
          id: "agent-secondary",
          debounce_window_ms: 15000,
          humanization_config: { split_enabled: false, business_hours_enabled: false },
          new_lead_stage_id: "stage-secondary",
        },
      ],
      error: null,
    });
    supabase.queue("agent_entry_conditions", {
      data: [
        {
          id: "condition-secondary",
          organization_id: "org-routing",
          agent_config_id: "agent-secondary",
          condition_type: "message_contains",
          condition_value: { keyword: "suporte" },
          priority: 10,
          created_at: "2026-05-26T00:00:00.000Z",
          updated_at: "2026-05-26T00:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("leads", {
      data: { status: "new", stage_id: null },
      error: null,
    });
    supabase.queue("lead_tags", { data: [], error: null });
    supabase.queue("segment_memberships", { data: [], error: null });
    supabase.queue("conversations", { data: null, error: null });
    supabase.queue("conversations", {
      data: { id: "conv-new", assigned_to: "ai", status: "active" },
      error: null,
    });
    supabase.queue("messages", { data: { id: "msg-new" }, error: null });
    supabase.queue("agent_conversations", { data: null, error: null });
    supabase.queue("agent_conversations", {
      data: {
        id: "agent-conv-new",
        current_node_id: null,
        human_handoff_at: null,
        after_hours_notified_at: null,
        ai_control_epoch: 0,
      },
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: { id: "stage-secondary", pipeline_id: "pipeline-secondary" },
      error: null,
    });
    supabase.queue("leads", { data: null, error: null });
    supabase.queue("agent_flows", { data: null, error: null });

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-routing",
      provider: makeProvider() as never,
      requestId: "req-routing",
      msg: {
        messageId: "wa-new-secondary",
        phone: "+5511999999999",
        pushName: "Ana",
        text: "preciso de suporte tecnico",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    expect(result).toMatchObject({
      handled: true,
      response: { status: "enqueued", leadId: "lead-new" },
    });
    expect(supabase.inserts.agent_conversations?.[0]).toMatchObject({
      config_id: "agent-secondary",
      lead_id: "lead-new",
      crm_conversation_id: "conv-new",
    });
    expect(supabase.updates.leads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pipeline_id: "pipeline-secondary",
          stage_id: "stage-secondary",
        }),
      ]),
    );
    expect(supabase.rpcCalls[0]).toMatchObject({
      fn: "enqueue_pending_message",
      args: {
        p_agent_conversation_id: "agent-conv-new",
        p_debounce_window_ms: 15000,
      },
    });
  });

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

  it("captura 23505 no agent_conversations INSERT e re-SELECT pega o vencedor", async () => {
    // PR-1 Auditoria (mai/2026): cenario de race entre 2 webhooks
    // paralelos do mesmo lead. UNIQUE partial (migration 071) dispara
    // 23505 no perdedor. Executor deve re-SELECT a linha do vencedor,
    // aplicar stickiness com o config_id dele, e prosseguir o enqueue
    // sem cair pro pipeline legacy.
    const supabase = createSupabaseMock();

    supabase.queue("organizations", {
      data: { settings: { features: { [NATIVE_AGENT_FEATURE_FLAG]: true } } },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-primary",
        debounce_window_ms: 10000,
        humanization_config: { split_enabled: false, business_hours_enabled: false },
      },
      error: null,
    });
    // dedup messages: nao existe ainda
    supabase.queue("messages", { data: null, error: null });
    // lead ja existe (race de webhooks, nao de leads novos)
    supabase.queue("leads", { data: { id: "lead-race" }, error: null });
    // pickAgentForLead: sem secundarios — fica no primary
    supabase.queue("agent_configs", { data: [], error: null });
    // conversation ja existe e esta ativa
    supabase.queue("conversations", {
      data: { id: "conv-race", assigned_to: "ai", status: "active" },
      error: null,
    });
    // UPDATE last_message_at
    supabase.queue("conversations", { data: null, error: null });
    // insert da inbound message
    supabase.queue("messages", { data: { id: "msg-race-in" }, error: null });
    // agent_conversations SELECT: null (perdedor ainda nao ve o vencedor)
    supabase.queue("agent_conversations", { data: null, error: null });
    // agent_conversations INSERT: 23505 (perdeu a race)
    supabase.queue("agent_conversations", {
      data: null,
      error: { message: "duplicate key value violates unique constraint", code: "23505" },
    });
    // agent_conversations re-SELECT: pega o vencedor (mesmo config)
    supabase.queue("agent_conversations", {
      data: {
        id: "agent-conv-winner",
        config_id: "agent-primary",
        current_node_id: null,
        human_handoff_at: null,
        after_hours_notified_at: null,
        ai_control_epoch: 0,
      },
      error: null,
    });
    // entry trigger gate: sem flow → segue como conversation_started
    supabase.queue("agent_flows", { data: null, error: null });

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-race",
      provider: makeProvider() as never,
      requestId: "req-race",
      msg: {
        messageId: "wa-race-1",
        phone: "+5511999999999",
        pushName: "Race",
        text: "oi",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    // Webhook NAO deve cair pro legacy: handled=true, status=enqueued.
    expect(result).toMatchObject({
      handled: true,
      response: { status: "enqueued" },
    });
    // Enqueue deve usar o agent_conversation_id DO VENCEDOR.
    expect(supabase.rpcCalls[0]).toMatchObject({
      fn: "enqueue_pending_message",
      args: { p_agent_conversation_id: "agent-conv-winner" },
    });
  });

  it("captura 23505 e troca stickiness pro config do vencedor (multi-agent edge)", async () => {
    // Edge case: 2 webhooks pegam pickAgentForLead diferentes (msgs
    // diferentes do mesmo lead casando regras de agentes distintos).
    // O vencedor INSERT com config-A; o perdedor (que ia inserir com
    // config-B) detecta 23505, re-SELECT, e troca stickiness pra
    // config-A pra nao bifurcar o lead em 2 agentes.
    const supabase = createSupabaseMock();

    supabase.queue("organizations", {
      data: { settings: { features: { [NATIVE_AGENT_FEATURE_FLAG]: true } } },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-loser",
        debounce_window_ms: 10000,
        humanization_config: { split_enabled: false, business_hours_enabled: false },
      },
      error: null,
    });
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("leads", { data: { id: "lead-edge" }, error: null });
    supabase.queue("agent_configs", { data: [], error: null });
    supabase.queue("conversations", {
      data: { id: "conv-edge", assigned_to: "ai", status: "active" },
      error: null,
    });
    supabase.queue("conversations", { data: null, error: null });
    supabase.queue("messages", { data: { id: "msg-edge-in" }, error: null });
    supabase.queue("agent_conversations", { data: null, error: null });
    supabase.queue("agent_conversations", {
      data: null,
      error: { message: "duplicate key", code: "23505" },
    });
    // Vencedor pegou config diferente (agent-winner)
    supabase.queue("agent_conversations", {
      data: {
        id: "agent-conv-edge-winner",
        config_id: "agent-winner",
        current_node_id: null,
        human_handoff_at: null,
        after_hours_notified_at: null,
        ai_control_epoch: 0,
      },
      error: null,
    });
    // loadRoutingAgentById pelo config do vencedor
    supabase.queue("agent_configs", {
      data: {
        id: "agent-winner",
        debounce_window_ms: 25000,
        humanization_config: { split_enabled: false, business_hours_enabled: false },
        new_lead_stage_id: null,
      },
      error: null,
    });
    supabase.queue("agent_flows", { data: null, error: null });

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-edge",
      provider: makeProvider() as never,
      requestId: "req-edge",
      msg: {
        messageId: "wa-edge-1",
        phone: "+5511988888888",
        pushName: "Edge",
        text: "oi",
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
    // Debounce window deve ser o do agent-winner (25000), nao o do
    // agent-loser (10000) que esta primary — confirma que stickiness
    // do vencedor sobrescreveu o pick original.
    expect(supabase.rpcCalls[0]).toMatchObject({
      fn: "enqueue_pending_message",
      args: {
        p_agent_conversation_id: "agent-conv-edge-winner",
        p_debounce_window_ms: 25000,
      },
    });
  });

  it("falha pos-criacao do agent_conv retorna handled=true status=native_error", async () => {
    // PR-1 Auditoria (mai/2026): se erro acontece DEPOIS de
    // agent_conversations existir (criado ou refetched), webhook NAO
    // cai pro legacy — legacy criaria response duplicada concorrente
    // com o flush nativo. Retornamos handled=true status=native_error
    // pra webhook parar; cron flush retenta na proxima janela.
    const supabase = createSupabaseMock();

    supabase.queue("organizations", {
      data: { settings: { features: { [NATIVE_AGENT_FEATURE_FLAG]: true } } },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: {
        id: "agent-primary",
        debounce_window_ms: 10000,
        humanization_config: { split_enabled: false, business_hours_enabled: false },
      },
      error: null,
    });
    supabase.queue("messages", { data: null, error: null });
    supabase.queue("leads", { data: { id: "lead-postfail" }, error: null });
    supabase.queue("agent_configs", { data: [], error: null });
    supabase.queue("conversations", {
      data: { id: "conv-postfail", assigned_to: "ai", status: "active" },
      error: null,
    });
    supabase.queue("conversations", { data: null, error: null });
    supabase.queue("messages", { data: { id: "msg-postfail-in" }, error: null });
    // SELECT acha agent_conv ja existente — agentConvKnown=true imediato
    supabase.queue("agent_conversations", {
      data: {
        id: "agent-conv-postfail",
        config_id: "agent-primary",
        current_node_id: null,
        human_handoff_at: null,
        after_hours_notified_at: null,
        ai_control_epoch: 0,
      },
      error: null,
    });
    // entry trigger gate falha (simulando erro pos-creation)
    supabase.queue("agent_flows", {
      data: null,
      error: { message: "simulated_post_creation_error" },
    });
    // RPC enqueue tambem falha simulando falha em cascata
    // (na pratica entry trigger erro nao bloqueia, vai pro enqueue).
    // Aqui forco enqueue a falhar pra cobrir o caminho do catch.
    supabase.rpc.mockImplementationOnce(async () => ({
      data: null,
      error: { message: "simulated_rpc_failure" },
    }));

    const result = await tryEnqueueForNativeAgent({
      supabase: supabase as never,
      orgId: "org-postfail",
      provider: makeProvider() as never,
      requestId: "req-postfail",
      msg: {
        messageId: "wa-postfail",
        phone: "+5511977777777",
        pushName: "PostFail",
        text: "oi",
        type: "text",
        isGroup: false,
        isFromMe: false,
        timestamp: Date.now(),
      },
    });

    // handled=true: webhook nao cai pro legacy.
    expect(result.handled).toBe(true);
    expect(result.response.status).toBe("native_error");
    expect(result.response.handledBy).toBe("ai_native_flow");
  });
});
