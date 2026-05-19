import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentConfig,
  AgentConversation,
  AgentStage,
} from "@persia/shared/ai-agent";
import {
  runStageActionsOnToolSuccess,
  runStageAutoActionsIfPending,
} from "@/lib/ai-agent/stage-actions-runtime";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

// PR-AI-AGENT-STAGE-ACTIONS-RUNTIME: testes do disparo automatico de
// auto_actions ao entrar numa etapa. Mockamos nativeHandlers no nivel
// do modulo pra observar quais foram chamados sem precisar de
// db real / provider real.

const handlerCalls: Array<{ handler: string; input: Record<string, unknown> }> = [];
const handlerReturnSuccess = vi.fn(async (handler: string) => ({
  success: true,
  output: { handler, ok: true },
}));
const handlerReturnFailure = vi.fn(async () => ({
  success: false,
  output: {},
  error: "simulated failure",
}));
const handlerThatThrows = vi.fn(async () => {
  throw new Error("kaboom");
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability", () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/ai-agent/tools/registry", () => ({
  nativeHandlers: {
    add_tag: vi.fn(async (_ctx: unknown, input: Record<string, unknown>) => {
      handlerCalls.push({ handler: "add_tag", input });
      return handlerReturnSuccess("add_tag");
    }),
    send_media: vi.fn(async (_ctx: unknown, input: Record<string, unknown>) => {
      handlerCalls.push({ handler: "send_media", input });
      return handlerReturnSuccess("send_media");
    }),
    move_pipeline_stage: vi.fn(async (_ctx: unknown, input: Record<string, unknown>) => {
      handlerCalls.push({ handler: "move_pipeline_stage", input });
      return handlerReturnFailure();
    }),
    trigger_notification: vi.fn(async (_ctx: unknown, input: Record<string, unknown>) => {
      handlerCalls.push({ handler: "trigger_notification", input });
      return handlerThatThrows();
    }),
    transfer_to_user: vi.fn(async () => handlerReturnSuccess("transfer_to_user")),
    transfer_to_agent: vi.fn(async () => handlerReturnSuccess("transfer_to_agent")),
    stop_agent: vi.fn(async () => handlerReturnSuccess("stop_agent")),
  },
  isImplementedNativeHandler: (h: string | null) => h !== null,
  getDefaultStopAgentTool: vi.fn(),
  materializePresetTool: vi.fn(),
}));

const ORG = "org-a";
const RUN_ID = "run-a";
const LEAD_ID = "lead-a";
const CONV_ID = "agent-conv-a";
const CRM_CONV_ID = "crm-conv-a";

function makeStage(overrides: Partial<AgentStage> & { action_config?: unknown } = {}): AgentStage {
  return {
    id: "stage-a",
    config_id: "config-a",
    organization_id: ORG,
    slug: "boas-vindas",
    order_index: 0,
    situation: "Boas-vindas",
    instruction: "",
    transition_hint: null,
    rag_enabled: false,
    rag_top_k: 3,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  } as AgentStage;
}

function makeConversation(
  overrides: Partial<AgentConversation> = {},
): AgentConversation {
  return {
    id: CONV_ID,
    organization_id: ORG,
    crm_conversation_id: CRM_CONV_ID,
    lead_id: LEAD_ID,
    config_id: "config-a",
    current_stage_id: "stage-a",
    history_summary: null,
    variables: {},
    tokens_used_total: 0,
    last_interaction_at: null,
    actions_executed: [],
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  } as AgentConversation;
}

function makeConfig(): AgentConfig {
  return {
    id: "config-a",
    organization_id: ORG,
    name: "Test",
    description: null,
    scope_type: "global",
    scope_id: null,
    model: "gpt-4o-mini",
    system_prompt: "",
    guardrails: {
      max_iterations: 5,
      timeout_seconds: 30,
      cost_ceiling_tokens: 10000,
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
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
  } as AgentConfig;
}

describe("runStageAutoActionsIfPending", () => {
  beforeEach(() => {
    handlerCalls.length = 0;
    vi.clearAllMocks();
  });

  it("dispara cada auto_action em ordem e insere step pra cada uma", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", { data: null, error: null });

    const stage = makeStage({
      action_config: {
        auto_actions: [
          { type: "add_tag", tag_name: "qualificado" },
          { type: "send_media", slug: "catalogo-2026" },
        ],
      },
    });

    const insertedSteps: Array<{ nativeHandler?: string | null }> = [];
    const insertStep = vi.fn(async (step) => {
      insertedSteps.push(step);
    });

    const result = await runStageAutoActionsIfPending({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation(),
      stage,
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 5,
      insertStep,
    });

    expect(result).toEqual({
      executed: 2,
      failed: 0,
      nextOrderIndex: 7,
      skipped: false,
    });
    expect(handlerCalls.map((c) => c.handler)).toEqual(["add_tag", "send_media"]);
    expect(handlerCalls[0]?.input).toEqual({ tag_name: "qualificado" });
    expect(handlerCalls[1]?.input).toEqual({ slug: "catalogo-2026" });
    expect(insertedSteps).toHaveLength(2);
    expect(insertedSteps[0]?.nativeHandler).toBe("add_tag");
    expect(insertedSteps[1]?.nativeHandler).toBe("send_media");
  });

  it("e idempotente: nao re-executa se stage ja esta em actions_executed", async () => {
    const supabase = createSupabaseMock();
    const stage = makeStage({
      action_config: {
        auto_actions: [{ type: "add_tag", tag_name: "qualificado" }],
      },
    });

    const result = await runStageAutoActionsIfPending({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation({
        actions_executed: ["stage-a"],
      }),
      stage,
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 3,
      insertStep: vi.fn(),
    });

    expect(result).toEqual({
      executed: 0,
      failed: 0,
      nextOrderIndex: 3,
      skipped: true,
    });
    expect(handlerCalls).toHaveLength(0);
  });

  it("marca stage como executada mesmo sem auto_actions (skip rapido proximo)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", { data: null, error: null });

    const stage = makeStage({ action_config: { auto_actions: [] } });

    const result = await runStageAutoActionsIfPending({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation(),
      stage,
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
    });

    expect(result.executed).toBe(0);
    expect(result.skipped).toBe(false);
    expect(supabase.updates.agent_conversations?.[0]).toMatchObject({
      actions_executed: ["stage-a"],
    });
  });

  it("sucesso parcial: 1 ok + 1 falha + 1 throw -> persiste detail, NAO marca legacy (attempts < max)", async () => {
    const supabase = createSupabaseMock();
    // 4 UPDATEs esperados (1 por acao + 0 marca legacy ja que nao completou)
    supabase.queue("agent_conversations", { data: null, error: null });
    supabase.queue("agent_conversations", { data: null, error: null });
    supabase.queue("agent_conversations", { data: null, error: null });

    const stage = makeStage({
      action_config: {
        auto_actions: [
          { type: "add_tag", tag_name: "qualificado" }, // ok
          { type: "move_pipeline_stage", stage_name: "Negociacao" }, // fail
          { type: "trigger_notification", template_name: "Lead Novo" }, // throw
        ],
      },
    });

    const result = await runStageAutoActionsIfPending({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation(),
      stage,
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
    });

    expect(result.executed).toBe(1);
    expect(result.failed).toBe(2);
    // PR3: NAO marca legacy (attempts dos failed ainda < MAX_RETRIES=3).
    // Proxima entrada do lead na etapa deve re-tentar as falhas.
    const updates = (supabase.updates.agent_conversations ?? []) as Array<Record<string, unknown>>;
    const legacyMark = updates.find((u) => Array.isArray(u.actions_executed));
    expect(legacyMark).toBeUndefined();
    // Em vez disso, atualizou actions_executed_detail (persist per-action).
    const detailUpdates = updates.filter((u) => "actions_executed_detail" in u);
    expect(detailUpdates.length).toBe(3); // 1 per acao
    const lastDetail = detailUpdates[detailUpdates.length - 1]?.actions_executed_detail as Record<string, unknown>;
    expect(lastDetail).toHaveProperty("on_enter:stage-a");
    const stageState = lastDetail["on_enter:stage-a"] as { succeeded: number[]; failed: Record<string, unknown> };
    expect(stageState.succeeded).toEqual([0]); // add_tag rodou
    expect(stageState.failed).toHaveProperty("1"); // move_pipeline falhou
    expect(stageState.failed).toHaveProperty("2"); // trigger_notification throw
  });

  it("dry_run NAO persiste actions_executed", async () => {
    const supabase = createSupabaseMock();

    const stage = makeStage({
      action_config: {
        auto_actions: [{ type: "add_tag", tag_name: "qualificado" }],
      },
    });

    await runStageAutoActionsIfPending({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation(),
      stage,
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: true,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
    });

    // handler foi chamado, mas nada foi persistido
    expect(handlerCalls).toHaveLength(1);
    expect(supabase.updates.agent_conversations).toBeUndefined();
  });

  // ==========================================================================
  // PR2 (mai/2026) — on_enter filter + on_tool_success
  // ==========================================================================

  it("on_enter filter: pula acoes com trigger='on_tool_success'", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", { data: null, error: null });

    const stage = makeStage({
      action_config: {
        auto_actions: [
          // dispara on_enter (default)
          { type: "add_tag", tag_name: "qualificado" },
          // dorme: so dispara apos create_appointment
          {
            type: "trigger_notification",
            template_name: "Lead agendou",
            trigger: "on_tool_success",
            on_tool_success_of: "create_appointment",
          },
          // dispara on_enter (sem trigger)
          { type: "send_media", slug: "catalogo-2026" },
        ],
      },
    });

    const result = await runStageAutoActionsIfPending({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation(),
      stage,
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
    });

    expect(result.executed).toBe(2);
    expect(result.failed).toBe(0);
    // Confirma que SO os 2 on_enter foram executados — trigger_notification
    // (que tem trigger='on_tool_success') NAO foi chamado aqui.
    expect(handlerCalls.map((c) => c.handler)).toEqual(["add_tag", "send_media"]);
    expect(handlerCalls.some((c) => c.handler === "trigger_notification")).toBe(false);
  });

  // ==========================================================================
  // PR3 (mai/2026) — per-action retry tracking via actions_executed_detail
  // ==========================================================================

  it("PR3: re-entrada pula sucessos e retenta SO as falhas pendentes", async () => {
    const supabase = createSupabaseMock();

    const stage = makeStage({
      action_config: {
        auto_actions: [
          { type: "add_tag", tag_name: "qualificado" }, // index 0 — succeeded antes
          { type: "move_pipeline_stage", stage_name: "Negociacao" }, // index 1 — failed antes
        ],
      },
    });

    // Simula segundo tick: lead voltou na stage com detail preenchido
    // (idx 0 succeeded; idx 1 failed com attempts=1).
    const convWithHistory = makeConversation({
      actions_executed_detail: {
        "on_enter:stage-a": {
          succeeded: [0],
          failed: { "1": { attempts: 1, last_error: "first try fail" } },
        },
      } as never,
    });

    await runStageAutoActionsIfPending({
      db: supabase as never,
      orgId: ORG,
      agentConversation: convWithHistory,
      stage,
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
    });

    // Apenas move_pipeline_stage (que falhou antes) e re-chamado.
    expect(handlerCalls.map((c) => c.handler)).toEqual(["move_pipeline_stage"]);
    // add_tag JA estava em succeeded — nao re-roda mesmo sendo idempotente
    // (evita audit duplicado + custo de handler).
  });

  it("PR3: ao atingir MAX_RETRIES, marca legacy actions_executed + desiste", async () => {
    const supabase = createSupabaseMock();

    const stage = makeStage({
      action_config: {
        auto_actions: [
          { type: "move_pipeline_stage", stage_name: "Negociacao" }, // SEMPRE falha (mock)
        ],
      },
    });

    // Detail com attempts=2 — proxima falha = 3, atinge MAX_RETRIES.
    const convNearMax = makeConversation({
      actions_executed_detail: {
        "on_enter:stage-a": {
          succeeded: [],
          failed: { "0": { attempts: 2, last_error: "previous error" } },
        },
      } as never,
    });

    const result = await runStageAutoActionsIfPending({
      db: supabase as never,
      orgId: ORG,
      agentConversation: convNearMax,
      stage,
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
    });

    expect(result.failed).toBe(1);
    expect(result.executed).toBe(0);
    // PR3: como attempts atingiu MAX_RETRIES=3, stage e marcada legacy
    // como "tentei tudo, desisto" — proxima entrada NAO re-tenta.
    const updates = (supabase.updates.agent_conversations ?? []) as Array<Record<string, unknown>>;
    const legacyMark = updates.find((u) => Array.isArray(u.actions_executed));
    expect(legacyMark).toMatchObject({ actions_executed: ["stage-a"] });
  });

  it("PR3: stage pula totalmente quando todos os indices ja resolvidos", async () => {
    const supabase = createSupabaseMock();

    const stage = makeStage({
      action_config: {
        auto_actions: [
          { type: "add_tag", tag_name: "qualificado" }, // idx 0 — succeeded
          { type: "send_media", slug: "catalogo" }, // idx 1 — exceeded retries
        ],
      },
    });

    const convDone = makeConversation({
      actions_executed_detail: {
        "on_enter:stage-a": {
          succeeded: [0],
          failed: { "1": { attempts: 3, last_error: "gave up" } },
        },
      } as never,
    });

    const result = await runStageAutoActionsIfPending({
      db: supabase as never,
      orgId: ORG,
      agentConversation: convDone,
      stage,
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
    });

    // Nada novo chamado — tudo ja resolvido.
    expect(handlerCalls).toHaveLength(0);
    expect(result.skipped).toBe(true);
    // Marca legacy pra short-circuit nas proximas msgs.
    const updates = (supabase.updates.agent_conversations ?? []) as Array<Record<string, unknown>>;
    const legacyMark = updates.find((u) => Array.isArray(u.actions_executed));
    expect(legacyMark).toMatchObject({ actions_executed: ["stage-a"] });
  });

  it("PR3: persist por acao — UPDATE em cada iteracao do loop", async () => {
    const supabase = createSupabaseMock();

    const stage = makeStage({
      action_config: {
        auto_actions: [
          { type: "add_tag", tag_name: "tag1" },
          { type: "add_tag", tag_name: "tag2" },
        ],
      },
    });

    await runStageAutoActionsIfPending({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation(),
      stage,
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
    });

    // 2 acoes -> 2 UPDATEs em actions_executed_detail + 1 UPDATE marca legacy
    const updates = (supabase.updates.agent_conversations ?? []) as Array<Record<string, unknown>>;
    const detailUpdates = updates.filter((u) => "actions_executed_detail" in u);
    expect(detailUpdates.length).toBe(2);
    // Primeiro detail update ja tem idx 0 em succeeded; segundo tem idx 0 e 1.
    const first = detailUpdates[0]?.actions_executed_detail as Record<string, unknown>;
    const second = detailUpdates[1]?.actions_executed_detail as Record<string, unknown>;
    expect((first["on_enter:stage-a"] as { succeeded: number[] }).succeeded).toEqual([0]);
    expect((second["on_enter:stage-a"] as { succeeded: number[] }).succeeded).toEqual([0, 1]);
  });

  it("PR3: retrocompat — stage_id em actions_executed legado + detail vazio = skip total", async () => {
    const supabase = createSupabaseMock();

    const stage = makeStage({
      action_config: {
        auto_actions: [{ type: "add_tag", tag_name: "x" }],
      },
    });

    const result = await runStageAutoActionsIfPending({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation({
        actions_executed: ["stage-a"], // legado: marcou antes da PR3
      }),
      stage,
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
    });

    expect(result.skipped).toBe(true);
    expect(handlerCalls).toHaveLength(0);
  });
});

describe("runStageActionsOnToolSuccess", () => {
  beforeEach(() => {
    handlerCalls.length = 0;
    vi.clearAllMocks();
  });

  it("dispara acoes ligadas ao tool especifico, ignora demais", async () => {
    const supabase = createSupabaseMock();
    // 1. re-fetch current_stage_id da conversa
    supabase.queue("agent_conversations", {
      data: { current_stage_id: "stage-a" },
      error: null,
    });
    // 2. carrega stage com action_config
    const stage = makeStage({
      action_config: {
        auto_actions: [
          { type: "add_tag", tag_name: "on-enter-only" }, // on_enter → skip aqui
          {
            type: "add_tag",
            tag_name: "agendou-reuniao",
            trigger: "on_tool_success",
            on_tool_success_of: "create_appointment",
          }, // match
          {
            type: "trigger_notification",
            template_name: "Lead reagendou",
            trigger: "on_tool_success",
            on_tool_success_of: "reschedule_appointment",
          }, // outro tool → skip
        ],
      },
    });
    supabase.queue("agent_stages", { data: stage, error: null });

    const result = await runStageActionsOnToolSuccess({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation(),
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 7,
      insertStep: vi.fn(),
      toolName: "create_appointment",
    });

    expect(result.skipped).toBe(false);
    expect(result.executed).toBe(1);
    expect(handlerCalls).toHaveLength(1);
    expect(handlerCalls[0]?.handler).toBe("add_tag");
    expect(handlerCalls[0]?.input).toEqual({ tag_name: "agendou-reuniao" });
  });

  it("skip quando current_stage_id nao existe", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", {
      data: { current_stage_id: null },
      error: null,
    });

    const result = await runStageActionsOnToolSuccess({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation({ current_stage_id: null as never }),
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
      toolName: "create_appointment",
    });

    expect(result.skipped).toBe(true);
    expect(handlerCalls).toHaveLength(0);
  });

  it("skip quando stage nao tem nenhuma acao matching o tool", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", {
      data: { current_stage_id: "stage-a" },
      error: null,
    });
    const stage = makeStage({
      action_config: {
        auto_actions: [
          { type: "add_tag", tag_name: "qualificado" }, // on_enter
        ],
      },
    });
    supabase.queue("agent_stages", { data: stage, error: null });

    const result = await runStageActionsOnToolSuccess({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation(),
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
      toolName: "create_appointment",
    });

    expect(result.skipped).toBe(true);
    expect(handlerCalls).toHaveLength(0);
  });

  it("NAO marca stage como executada (sem persistMark — pode disparar de novo)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", {
      data: { current_stage_id: "stage-a" },
      error: null,
    });
    const stage = makeStage({
      action_config: {
        auto_actions: [
          {
            type: "add_tag",
            tag_name: "agendou-reuniao",
            trigger: "on_tool_success",
            on_tool_success_of: "create_appointment",
          },
        ],
      },
    });
    supabase.queue("agent_stages", { data: stage, error: null });

    await runStageActionsOnToolSuccess({
      db: supabase as never,
      orgId: ORG,
      agentConversation: makeConversation(),
      config: makeConfig(),
      runId: RUN_ID,
      leadId: LEAD_ID,
      crmConversationId: CRM_CONV_ID,
      provider: null,
      openaiClient: null,
      dryRun: false,
      startingOrderIndex: 0,
      insertStep: vi.fn(),
      toolName: "create_appointment",
    });

    // O re-fetch e o load do stage usam .from('agent_conversations') e
    // .from('agent_stages'). Confirma que NENHUM update foi feito em
    // agent_conversations.actions_executed (cada tool success pode re-disparar).
    expect(supabase.updates.agent_conversations).toBeUndefined();
  });
});
