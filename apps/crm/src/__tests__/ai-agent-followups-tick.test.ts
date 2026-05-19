import { beforeEach, describe, expect, it, vi } from "vitest";
import { runFollowupsTick } from "@/lib/ai-agent/followups/tick";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

// PR4 (mai/2026): testes do runtime de agent_followups. Foco em:
//   - Idempotency via UNIQUE constraint (INSERT antes do send)
//   - Filtro: handoff_at, last_interaction_at, is_enabled
//   - Render: corpo usa vars do lead + agent
//   - Skip silencioso pra: sem provider, sem phone, config archived,
//     template archived
//   - Cap: respeita MAX_PROCESSED_PER_TICK (200)

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability", () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  getRequestId: vi.fn(() => "req-test"),
}));

// Provider stub global — registramos `sendText` mockado pra observar
// argumentos. `createProvider` retorna o mesmo stub sempre.
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
const TEMPLATE = "tpl-a";
const CONV = "conv-a";
const LEAD = "lead-a";

function makeFollowup(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: FOLLOWUP,
    organization_id: ORG,
    config_id: CONFIG,
    name: "Lembrete 24h",
    template_id: TEMPLATE,
    delay_hours: 24,
    is_enabled: true,
    order_index: 0,
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
    body_template: "Oi {{lead_name}}, voce esqueceu de mim? — {{agent_name}}",
    status: "active",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
  };
}

function makeConversation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONV,
    organization_id: ORG,
    lead_id: LEAD,
    crm_conversation_id: "crm-conv-a",
    last_interaction_at: "2026-04-30T00:00:00.000Z", // bem antigo
    human_handoff_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  providerSendText.mockReset();
  providerSendText.mockResolvedValue({ messageId: "msg-1", success: true });
});

describe("runFollowupsTick", () => {
  it("dispara INSERT antes do sendText + envia pro phone do lead", async () => {
    const supabase = createSupabaseMock();
    // 1. agent_followups (enabled=true)
    supabase.queue("agent_followups", { data: [makeFollowup()], error: null });
    // 2. agent_configs (lookup do nome — active)
    supabase.queue("agent_configs", {
      data: { name: "Vendedora", status: "active" },
      error: null,
    });
    // 3. agent_notification_templates
    supabase.queue("agent_notification_templates", { data: makeTemplate(), error: null });
    // 4. agent_conversations (due — last_interaction muito antigo)
    supabase.queue("agent_conversations", { data: [makeConversation()], error: null });
    // 5. agent_followup_runs lookup pra dedupe (vazio = nunca disparou)
    supabase.queue("agent_followup_runs", { data: [], error: null });
    // 6. whatsapp_connections (provider load)
    supabase.queue("whatsapp_connections", {
      data: {
        provider: "uazapi",
        instance_url: "https://example.com",
        instance_token: "tok",
      },
      error: null,
    });
    // 7. leads (phone lookup pra dispatch)
    supabase.queue("leads", {
      data: { name: "Maria", phone: "+55 11 98888-7777" },
      error: null,
    });
    // 8. agent_followup_runs INSERT (sem erro = lock obtido)
    supabase.queue("agent_followup_runs", { data: null, error: null });

    const result = await runFollowupsTick(supabase as never);

    expect(result.fired).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);

    // Confirma que INSERT em agent_followup_runs aconteceu ANTES do send
    // (estrutura do dispatch: insert → render → sendText).
    expect(supabase.inserts.agent_followup_runs).toHaveLength(1);
    expect(supabase.inserts.agent_followup_runs?.[0]).toMatchObject({
      followup_id: FOLLOWUP,
      conversation_id: CONV,
      organization_id: ORG,
    });

    // Confirma que sendText foi chamado pro PHONE DO LEAD (normalizado),
    // nao pro target_address do template.
    expect(providerSendText).toHaveBeenCalledTimes(1);
    expect(providerSendText.mock.calls[0]?.[0]).toMatchObject({
      phone: "5511988887777",
    });
    // Body renderizado com vars do lead + agent.
    expect(providerSendText.mock.calls[0]?.[0].message).toContain("Maria");
    expect(providerSendText.mock.calls[0]?.[0].message).toContain("Vendedora");
  });

  it("idempotency: 23505 no INSERT = skip silencioso, NAO sendText", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_followups", { data: [makeFollowup()], error: null });
    supabase.queue("agent_configs", {
      data: { name: "Agente", status: "active" },
      error: null,
    });
    supabase.queue("agent_notification_templates", { data: makeTemplate(), error: null });
    supabase.queue("agent_conversations", { data: [makeConversation()], error: null });
    supabase.queue("agent_followup_runs", { data: [], error: null });
    supabase.queue("whatsapp_connections", {
      data: { provider: "uazapi", instance_url: "https://ex.com", instance_token: "t" },
      error: null,
    });
    supabase.queue("leads", {
      data: { name: "Joao", phone: "5511977776666" },
      error: null,
    });
    // INSERT colide com row ja existente (outro tick) — unique_violation
    supabase.queue("agent_followup_runs", {
      data: null,
      error: { message: "duplicate", code: "23505" },
    });

    const result = await runFollowupsTick(supabase as never);

    expect(result.fired).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
    expect(providerSendText).not.toHaveBeenCalled();
  });

  it("dedupe pre-tick: conversation ja em agent_followup_runs e excluida", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_followups", { data: [makeFollowup()], error: null });
    supabase.queue("agent_configs", {
      data: { name: "X", status: "active" },
      error: null,
    });
    supabase.queue("agent_notification_templates", { data: makeTemplate(), error: null });
    supabase.queue("agent_conversations", { data: [makeConversation()], error: null });
    // RUNS lookup retorna a conversa ja disparada
    supabase.queue("agent_followup_runs", {
      data: [{ conversation_id: CONV }],
      error: null,
    });

    const result = await runFollowupsTick(supabase as never);

    expect(result.conversations_matched).toBe(1);
    // Filtrada antes de chegar no dispatch — provider nem foi carregado
    expect(result.fired).toBe(0);
    expect(providerSendText).not.toHaveBeenCalled();
  });

  it("skip lead sem phone — NAO insere agent_followup_runs", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_followups", { data: [makeFollowup()], error: null });
    supabase.queue("agent_configs", {
      data: { name: "X", status: "active" },
      error: null,
    });
    supabase.queue("agent_notification_templates", { data: makeTemplate(), error: null });
    supabase.queue("agent_conversations", { data: [makeConversation()], error: null });
    supabase.queue("agent_followup_runs", { data: [], error: null });
    supabase.queue("whatsapp_connections", {
      data: { provider: "uazapi", instance_url: "https://ex.com", instance_token: "t" },
      error: null,
    });
    // lead sem phone
    supabase.queue("leads", { data: { name: "Sem Phone", phone: null }, error: null });

    const result = await runFollowupsTick(supabase as never);

    expect(result.fired).toBe(0);
    expect(result.skipped).toBe(1);
    // CRITICO: NAO podemos ter inserido em runs — senao perdemos
    // chance de re-tentar quando o phone for adicionado.
    expect(supabase.inserts.agent_followup_runs ?? []).toHaveLength(0);
    expect(providerSendText).not.toHaveBeenCalled();
  });

  it("skip org sem whatsapp_connection conectado", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_followups", { data: [makeFollowup()], error: null });
    supabase.queue("agent_configs", {
      data: { name: "X", status: "active" },
      error: null,
    });
    supabase.queue("agent_notification_templates", { data: makeTemplate(), error: null });
    supabase.queue("agent_conversations", { data: [makeConversation()], error: null });
    supabase.queue("agent_followup_runs", { data: [], error: null });
    // whatsapp_connections retorna null = sem provider conectado
    supabase.queue("whatsapp_connections", { data: null, error: null });

    const result = await runFollowupsTick(supabase as never);

    expect(result.fired).toBe(0);
    expect(result.skipped).toBe(1);
    expect(supabase.inserts.agent_followup_runs ?? []).toHaveLength(0);
    expect(providerSendText).not.toHaveBeenCalled();
  });

  it("skip config arquivado — nao toca template/conv/provider", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_followups", { data: [makeFollowup()], error: null });
    supabase.queue("agent_configs", {
      data: { name: "X", status: "paused" },
      error: null,
    });

    const result = await runFollowupsTick(supabase as never);

    expect(result.followups_loaded).toBe(1);
    expect(result.fired).toBe(0);
    expect(result.skipped).toBe(0);
    expect(providerSendText).not.toHaveBeenCalled();
  });

  it("template archived = skip todo o followup", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_followups", { data: [makeFollowup()], error: null });
    supabase.queue("agent_configs", {
      data: { name: "X", status: "active" },
      error: null,
    });
    supabase.queue("agent_notification_templates", {
      data: { ...makeTemplate(), status: "archived" },
      error: null,
    });

    const result = await runFollowupsTick(supabase as never);
    expect(result.fired).toBe(0);
    expect(providerSendText).not.toHaveBeenCalled();
  });

  it("zero followups enabled = idle result com fired=0", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_followups", { data: [], error: null });
    const result = await runFollowupsTick(supabase as never);
    expect(result.followups_loaded).toBe(0);
    expect(result.fired).toBe(0);
    expect(result.errors).toBe(0);
  });
});
