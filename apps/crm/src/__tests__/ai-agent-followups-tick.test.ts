import { beforeEach, describe, expect, it, vi } from "vitest";
import { runFollowupsTick } from "@/lib/ai-agent/followups/tick";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability", () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  getRequestId: vi.fn(() => "req-test"),
}));

const providerSendText = vi.fn();
vi.mock("@/lib/whatsapp/providers", () => ({
  createProvider: vi.fn(() => ({
    sendText: providerSendText,
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

const ORG = "org-a";
const CONFIG = "cfg-a";
const FOLLOWUP = "fup-a";
const FOLLOWUP_2 = "fup-b";
const TEMPLATE = "tpl-a";
const CONV = "conv-a";
const CRM_CONV = "crm-conv-a";
const LEAD = "lead-a";

function makeFollowup(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: FOLLOWUP,
    organization_id: ORG,
    config_id: CONFIG,
    name: "Lembrete 24h",
    template_id: TEMPLATE,
    delay_hours: 1,
    is_enabled: true,
    order_index: 0,
    send_window_start: "00:00",
    send_window_end: "23:59",
    require_ai_active: true,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TEMPLATE,
    organization_id: ORG,
    config_id: CONFIG,
    name: "Lembrete",
    description: null,
    target_type: "phone",
    target_address: "5511999999999",
    body_template: "Oi {{lead_name}}, voce esqueceu de mim? - {{agent_name}}",
    status: "active",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONV,
    organization_id: ORG,
    config_id: CONFIG,
    lead_id: LEAD,
    crm_conversation_id: CRM_CONV,
    last_interaction_at: "2026-04-30T00:00:00.000Z",
    human_handoff_at: null,
    ...overrides,
  };
}

function queueHappyPathBase(supabase: ReturnType<typeof createSupabaseMock>, followups = [makeFollowup()]) {
  supabase.queue("agent_followups", { data: followups, error: null });
  supabase.queue("agent_configs", {
    data: { name: "Vendedora", status: "active" },
    error: null,
  });
  supabase.queue("agent_notification_templates", {
    data: [makeTemplate()],
    error: null,
  });
  supabase.queue("agent_conversations", {
    data: [makeConversation()],
    error: null,
  });
  supabase.queue("whatsapp_connections", {
    data: {
      provider: "uazapi",
      instance_url: "https://example.com",
      instance_token: "tok",
    },
    error: null,
  });
}

function queueEligibleEvaluation(supabase: ReturnType<typeof createSupabaseMock>) {
  supabase.queue("conversations", { data: { status: "active", assigned_to: "ai" }, error: null });
  supabase.queue("messages", {
    data: [{ id: "m1", sender: "ai", created_at: "2026-04-30T00:00:00.000Z" }],
    error: null,
  });
  supabase.queue("agent_followup_runs", { data: [], error: null });
}

beforeEach(() => {
  providerSendText.mockReset();
  providerSendText.mockResolvedValue({ messageId: "msg-1", success: true });
});

describe("runFollowupsTick", () => {
  it("envia a proxima etapa elegivel e marca o run como sent", async () => {
    const supabase = createSupabaseMock();
    queueHappyPathBase(supabase);
    queueEligibleEvaluation(supabase);
    // Revalidacao antes do envio.
    queueEligibleEvaluation(supabase);
    supabase.queue("leads", {
      data: { name: "Maria", phone: "+55 11 98888-7777" },
      error: null,
    });
    supabase.queue("agent_followup_runs", { data: null, error: null });
    supabase.queue("agent_followup_runs", { data: null, error: null });

    const result = await runFollowupsTick(supabase as never);

    expect(result.fired).toBe(1);
    expect(result.errors).toBe(0);
    expect(supabase.inserts.agent_followup_runs?.[0]).toMatchObject({
      followup_id: FOLLOWUP,
      conversation_id: CONV,
      organization_id: ORG,
      status: "sending",
    });
    expect(supabase.updates.agent_followup_runs?.[0]).toMatchObject({
      status: "sent",
    });
    expect(providerSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "5511988887777",
        message: expect.stringContaining("Maria"),
      }),
    );
  });

  it("cancela a fila quando a ultima mensagem e do lead", async () => {
    const supabase = createSupabaseMock();
    queueHappyPathBase(supabase);
    supabase.queue("conversations", { data: { status: "active", assigned_to: "ai" }, error: null });
    supabase.queue("messages", {
      data: [
        { id: "m2", sender: "lead", created_at: "2026-04-30T02:00:00.000Z" },
        { id: "m1", sender: "ai", created_at: "2026-04-30T00:00:00.000Z" },
      ],
      error: null,
    });

    const result = await runFollowupsTick(supabase as never);

    expect(result.cancelled).toBe(1);
    expect(providerSendText).not.toHaveBeenCalled();
    expect(supabase.inserts.agent_followup_runs ?? []).toHaveLength(0);
    expect(supabase.inserts.agent_followup_conversation_states?.[0]).toMatchObject({
      status: "cancelled",
      cancel_reason: "lead_replied",
    });
  });

  it("pausa e reagenda quando esta fora da janela de envio", async () => {
    const supabase = createSupabaseMock();
    queueHappyPathBase(supabase, [
      makeFollowup({ send_window_start: "23:58", send_window_end: "23:59" }),
    ]);
    queueEligibleEvaluation(supabase);

    const result = await runFollowupsTick(supabase as never);

    expect(result.paused).toBe(1);
    expect(providerSendText).not.toHaveBeenCalled();
    expect(supabase.inserts.agent_followup_conversation_states?.[0]).toMatchObject({
      status: "paused",
      pause_reason: "outside_send_window",
    });
  });

  it("usa sent_at da etapa anterior para calcular a proxima etapa", async () => {
    const supabase = createSupabaseMock();
    queueHappyPathBase(supabase, [
      makeFollowup(),
      makeFollowup({ id: FOLLOWUP_2, order_index: 1, delay_hours: 720 }),
    ]);
    supabase.queue("conversations", { data: { status: "active", assigned_to: "ai" }, error: null });
    supabase.queue("messages", {
      data: [{ id: "m1", sender: "ai", created_at: "2026-04-30T00:00:00.000Z" }],
      error: null,
    });
    supabase.queue("agent_followup_runs", {
      data: [{ followup_id: FOLLOWUP, status: "sent", sent_at: new Date().toISOString() }],
      error: null,
    });

    const result = await runFollowupsTick(supabase as never);

    expect(result.skipped).toBe(1);
    expect(providerSendText).not.toHaveBeenCalled();
  });

  it("skip lead sem phone sem inserir run", async () => {
    const supabase = createSupabaseMock();
    queueHappyPathBase(supabase);
    queueEligibleEvaluation(supabase);
    queueEligibleEvaluation(supabase);
    supabase.queue("leads", { data: { name: "Sem Phone", phone: null }, error: null });

    const result = await runFollowupsTick(supabase as never);

    expect(result.skipped).toBe(1);
    expect(supabase.inserts.agent_followup_runs ?? []).toHaveLength(0);
    expect(providerSendText).not.toHaveBeenCalled();
  });

  it("envia follow-up com mensagem propria sem template", async () => {
    const supabase = createSupabaseMock();
    queueHappyPathBase(supabase, [
      makeFollowup({
        template_id: null,
        message_text: "Oi {{lead_name}}, posso te ajudar? - {{agent_name}}",
      }),
    ]);
    queueEligibleEvaluation(supabase);
    queueEligibleEvaluation(supabase);
    supabase.queue("leads", { data: { name: "Maria", phone: "+55 11 98888-7777" }, error: null });
    supabase.queue("agent_followup_runs", { data: null, error: null });
    supabase.queue("agent_followup_runs", { data: null, error: null });

    const result = await runFollowupsTick(supabase as never);

    expect(result.fired).toBe(1);
    expect(providerSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Oi Maria, posso te ajudar? - Vendedora",
      }),
    );
  });

  it("pausa quando a etapa exige IA ativa e a conversa esta com humano", async () => {
    const supabase = createSupabaseMock();
    queueHappyPathBase(supabase);
    supabase.queue("conversations", { data: { status: "waiting_human", assigned_to: null }, error: null });
    supabase.queue("messages", {
      data: [{ id: "m1", sender: "agent", created_at: "2026-04-30T00:00:00.000Z" }],
      error: null,
    });
    supabase.queue("agent_followup_runs", { data: [], error: null });

    const result = await runFollowupsTick(supabase as never);

    expect(result.paused).toBe(1);
    expect(providerSendText).not.toHaveBeenCalled();
    expect(supabase.inserts.agent_followup_conversation_states?.[0]).toMatchObject({
      status: "paused",
      pause_reason: "ai_inactive",
    });
  });

  it("zero followups enabled = idle", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_followups", { data: [], error: null });

    const result = await runFollowupsTick(supabase as never);

    expect(result.followups_loaded).toBe(0);
    expect(result.fired).toBe(0);
    expect(result.errors).toBe(0);
  });
});
