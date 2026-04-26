import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { createToolFromPreset, createCustomTool, setStageTool } from "@/actions/ai-agent/tools";
import { listRuns } from "@/actions/ai-agent/audit";
import { addTagHandler } from "@/lib/ai-agent/tools/add-tag";
import { movePipelineStageHandler } from "@/lib/ai-agent/tools/move-pipeline-stage";
import { transferToAgentHandler } from "@/lib/ai-agent/tools/transfer-to-agent";
import { transferToStageHandler } from "@/lib/ai-agent/tools/transfer-to-stage";
import { transferToUserHandler } from "@/lib/ai-agent/tools/transfer-to-user";

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

describe("ai-agent PR3 runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createToolFromPreset materializes a shipped PR3 preset into agent_tools", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_configs", {
      data: { id: "config-a", organization_id: ORG_A },
      error: null,
    });
    supabase.queue("agent_tools", { data: null, error: null });
    supabase.queue("agent_tools", {
      data: {
        id: "tool-a",
        organization_id: ORG_A,
        config_id: "config-a",
        name: "transfer_to_user",
        description: "desc",
        input_schema: { type: "object", properties: {} },
        execution_mode: "native",
        native_handler: "transfer_to_user",
        webhook_url: null,
        webhook_secret: null,
        is_enabled: true,
      },
      error: null,
    });

    const tool = await createToolFromPreset({
      config_id: "config-a",
      handler: "transfer_to_user",
    });

    expect(tool.native_handler).toBe("transfer_to_user");
    expect(supabase.inserts.agent_tools?.[0]).toMatchObject({
      organization_id: ORG_A,
      config_id: "config-a",
      name: "transfer_to_user",
      execution_mode: "native",
      native_handler: "transfer_to_user",
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/automations/agents");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/automations/agents/config-a");
  });

  it("createCustomTool rejects non-HTTPS custom webhook tools", async () => {
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
      createCustomTool({
        config_id: "config-a",
        name: "custom_webhook",
        description: "webhook",
        input_schema: { type: "object", properties: {} },
        execution_mode: "n8n_webhook",
        webhook_url: "http://hooks.example.com/flow",
        webhook_secret: "12345678901234567890123456789012",
      }),
    ).rejects.toThrow(/HTTPS/i);
    expect(supabase.inserts.agent_tools).toBeUndefined();
  });

  it("setStageTool rejects stage/tool pairs from different configs", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_stages", {
      data: { id: "stage-a", organization_id: ORG_A, config_id: "config-a" },
      error: null,
    });
    supabase.queue("agent_tools", {
      data: { id: "tool-b", organization_id: ORG_A, config_id: "config-b" },
      error: null,
    });

    await expect(
      setStageTool({
        stage_id: "stage-a",
        tool_id: "tool-b",
        is_enabled: true,
      }),
    ).rejects.toThrow(/mesmo agente/i);
  });

  it("listRuns scopes by organization and attaches ordered steps", async () => {
    const supabase = createSupabaseMock();
    stubAuth(supabase);
    supabase.queue("agent_conversations", {
      data: [{ id: "agent-conv-a" }],
      error: null,
    });
    supabase.queue("agent_runs", {
      data: [
        {
          id: "run-a",
          organization_id: ORG_A,
          agent_conversation_id: "agent-conv-a",
          inbound_message_id: null,
          status: "succeeded",
          model: "gpt-5-mini",
          tokens_input: 10,
          tokens_output: 4,
          cost_usd_cents: 1,
          duration_ms: 50,
          error_msg: null,
          created_at: "2026-04-23T12:00:00.000Z",
        },
      ],
      error: null,
    });
    supabase.queue("agent_steps", {
      data: [
        {
          id: "step-a1",
          organization_id: ORG_A,
          run_id: "run-a",
          order_index: 0,
          step_type: "llm",
          tool_id: null,
          native_handler: null,
          input: {},
          output: {},
          duration_ms: 20,
          created_at: "2026-04-23T12:00:01.000Z",
        },
        {
          id: "step-a2",
          organization_id: ORG_A,
          run_id: "run-a",
          order_index: 1,
          step_type: "tool",
          tool_id: "tool-a",
          native_handler: "add_tag",
          input: {},
          output: {},
          duration_ms: 12,
          created_at: "2026-04-23T12:00:02.000Z",
        },
      ],
      error: null,
    });

    const runs = await listRuns({ config_id: "config-a", limit: 200 });

    expect(runs).toHaveLength(1);
    expect(runs[0].steps.map((step) => step.id)).toEqual(["step-a1", "step-a2"]);
    expect(supabase.filters.agent_conversations.eq).toContainEqual(["organization_id", ORG_A]);
    expect(supabase.filters.agent_runs.eq).toContainEqual(["organization_id", ORG_A]);
    expect(supabase.filters.agent_steps.eq).toContainEqual(["organization_id", ORG_A]);
  });

  it("transferToUserHandler dry-run simulates the assignment without writes", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organization_members", {
      data: { user_id: "11111111-1111-4111-8111-111111111111" },
      error: null,
    });
    supabase.queue("profiles", {
      data: { full_name: "Alice" },
      error: null,
    });

    const result = await transferToUserHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase as never,
      } as never,
      { user_id: "11111111-1111-4111-8111-111111111111", reason: "escalacao" },
    );

    expect(result.success).toBe(true);
    expect(result.side_effects).toContain("would assign lead to Alice");
    expect(supabase.updates.leads).toBeUndefined();
    expect(supabase.inserts.lead_activities).toBeUndefined();
  });

  it("transferToUserHandler updates the lead and logs an internal activity note", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("organization_members", {
      data: { user_id: "11111111-1111-4111-8111-111111111111" },
      error: null,
    });
    supabase.queue("profiles", {
      data: { full_name: "Alice" },
      error: null,
    });
    supabase.queue("leads", { data: null, error: null });
    supabase.queue("lead_activities", { data: null, error: null });

    const result = await transferToUserHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: false,
        db: supabase as never,
      } as never,
      { user_id: "11111111-1111-4111-8111-111111111111", reason: "fechar venda" },
    );

    expect(result.success).toBe(true);
    expect(supabase.updates.leads?.[0]).toMatchObject({
      assigned_to: "11111111-1111-4111-8111-111111111111",
    });
    expect(supabase.inserts.lead_activities?.[0]).toMatchObject({
      organization_id: ORG_A,
      lead_id: "lead-a",
      type: "assigned",
    });
    expect((supabase.inserts.lead_activities?.[0] as Record<string, unknown>).description).toContain("Alice");
  });

  it("transferToStageHandler updates current_stage_id inside the same config", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", {
      data: { config_id: "config-a", current_stage_id: "stage-old" },
      error: null,
    });
    supabase.queue("agent_stages", {
      data: { id: "stage-new", config_id: "config-a" },
      error: null,
    });
    supabase.queue("agent_conversations", { data: null, error: null });

    const result = await transferToStageHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: false,
        db: supabase as never,
      } as never,
      { stage_id: "22222222-2222-4222-8222-222222222222", reason: "qualificado" },
    );

    expect(result.success).toBe(true);
    expect(supabase.updates.agent_conversations?.[0]).toMatchObject({
      current_stage_id: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("transferToAgentHandler moves the conversation to a new active config and first stage", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("agent_conversations", {
      data: {
        config_id: "config-a",
        current_stage_id: "stage-a",
        history_summary: "old",
        variables: { foo: "bar" },
      },
      error: null,
    });
    supabase.queue("agent_configs", {
      data: { id: "config-b", status: "active" },
      error: null,
    });
    supabase.queue("agent_stages", {
      data: { id: "stage-b1" },
      error: null,
    });
    supabase.queue("agent_conversations", { data: null, error: null });

    const result = await transferToAgentHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: false,
        db: supabase as never,
      } as never,
      { agent_config_id: "33333333-3333-4333-8333-333333333333", reason: "mudar para vendas" },
    );

    expect(result.success).toBe(true);
    expect(supabase.updates.agent_conversations?.[0]).toMatchObject({
      config_id: "33333333-3333-4333-8333-333333333333",
      current_stage_id: "stage-b1",
    });
  });

  it("addTagHandler creates a normalized tag and links it to the lead", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: null, error: null });
    supabase.queue("tags", {
      data: { id: "tag-a", name: "vip quente" },
      error: null,
    });
    supabase.queue("lead_tags", { data: null, error: null });

    const result = await addTagHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: false,
        db: supabase as never,
      } as never,
      { tag_name: "  VIP   Quente " },
    );

    expect(result.success).toBe(true);
    expect(supabase.inserts.tags?.[0]).toMatchObject({
      organization_id: ORG_A,
      name: "vip quente",
    });
    expect(supabase.inserts.lead_tags?.[0]).toMatchObject({
      organization_id: ORG_A,
      lead_id: "lead-a",
      tag_id: "tag-a",
    });
  });

  it("addTagHandler dry-run does not write to tags or lead_tags when tag is new", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: null, error: null });

    const result = await addTagHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase as never,
      } as never,
      { tag_name: "novo segmento" },
    );

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      tag_name: "novo segmento",
      created: true,
      tag_id: null,
    });
    expect(result.side_effects).toEqual([
      "would create tag novo segmento and attach to lead",
    ]);
    expect(supabase.inserts.tags).toBeUndefined();
    expect(supabase.inserts.lead_tags).toBeUndefined();
  });

  it("addTagHandler dry-run does not write to lead_tags when tag already exists", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", {
      data: { id: "tag-existing", name: "vip" },
      error: null,
    });

    const result = await addTagHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase as never,
      } as never,
      { tag_name: "VIP" },
    );

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      tag_name: "vip",
      created: false,
      tag_id: "tag-existing",
    });
    expect(supabase.inserts.tags).toBeUndefined();
    expect(supabase.inserts.lead_tags).toBeUndefined();
  });

  // ==========================================================================
  // PR8 — move_pipeline_stage
  // ==========================================================================

  it("movePipelineStageHandler rejects invalid stage_id (not a uuid)", async () => {
    const supabase = createSupabaseMock();
    const result = await movePipelineStageHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: false,
        db: supabase as never,
      } as never,
      { stage_id: "not-a-uuid" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid tool input");
  });

  it("movePipelineStageHandler fails when lead has no open deal", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", { data: [], error: null });

    const result = await movePipelineStageHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase as never,
      } as never,
      { stage_id: "44444444-4444-4444-8444-444444444444" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nenhum funil/);
  });

  it("movePipelineStageHandler fails when lead is in multiple pipelines and pipeline_id is missing", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", {
      data: [
        { id: "deal-1", pipeline_id: "pipeline-1", stage_id: "stage-x", status: "open" },
        { id: "deal-2", pipeline_id: "pipeline-2", stage_id: "stage-y", status: "open" },
      ],
      error: null,
    });

    const result = await movePipelineStageHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase as never,
      } as never,
      { stage_id: "44444444-4444-4444-8444-444444444444" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/mais de um funil/);
    expect(result.output).toMatchObject({
      pipeline_ids: ["pipeline-1", "pipeline-2"],
    });
  });

  it("movePipelineStageHandler rejects target stage from another pipeline", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", {
      data: [
        { id: "deal-1", pipeline_id: "pipeline-1", stage_id: "stage-x", status: "open" },
      ],
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Outro funil",
        pipeline_id: "pipeline-2",
        organization_id: ORG_A,
      },
      error: null,
    });

    const result = await movePipelineStageHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase as never,
      } as never,
      { stage_id: "44444444-4444-4444-8444-444444444444" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nao pertence ao funil/);
  });

  it("movePipelineStageHandler rejects stage from another organization", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", {
      data: [
        { id: "deal-1", pipeline_id: "pipeline-1", stage_id: "stage-x", status: "open" },
      ],
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Stage de outra org",
        pipeline_id: "pipeline-1",
        organization_id: "org-other",
      },
      error: null,
    });

    const result = await movePipelineStageHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase as never,
      } as never,
      { stage_id: "44444444-4444-4444-8444-444444444444" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nao pertence a esta organizacao/);
  });

  it("movePipelineStageHandler dry-run returns 'would move' side_effect without writing", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", {
      data: [
        { id: "deal-1", pipeline_id: "pipeline-1", stage_id: "stage-x", status: "open" },
      ],
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Qualificado",
        pipeline_id: "pipeline-1",
        organization_id: ORG_A,
      },
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: { name: "Novo" },
      error: null,
    });

    const result = await movePipelineStageHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase as never,
      } as never,
      { stage_id: "44444444-4444-4444-8444-444444444444", reason: "lead qualificou" },
    );

    expect(result.success).toBe(true);
    expect(result.side_effects).toEqual([
      'would move lead from "Novo" to "Qualificado" in CRM Kanban',
    ]);
    expect(result.output).toMatchObject({
      deal_id: "deal-1",
      from_stage_id: "stage-x",
      from_stage_name: "Novo",
      to_stage_id: "44444444-4444-4444-8444-444444444444",
      to_stage_name: "Qualificado",
      pipeline_id: "pipeline-1",
      reason: "lead qualificou",
    });
    expect(supabase.updates.deals).toBeUndefined();
    expect(supabase.inserts.lead_activities).toBeUndefined();
  });

  it("movePipelineStageHandler returns noop when lead is already at the target stage", async () => {
    const supabase = createSupabaseMock();
    // Deal ja esta na stage de destino
    supabase.queue("deals", {
      data: [
        {
          id: "deal-1",
          pipeline_id: "pipeline-1",
          stage_id: "44444444-4444-4444-8444-444444444444",
          status: "open",
        },
      ],
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Qualificado",
        pipeline_id: "pipeline-1",
        organization_id: ORG_A,
      },
      error: null,
    });

    const result = await movePipelineStageHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: false,
        db: supabase as never,
      } as never,
      { stage_id: "44444444-4444-4444-8444-444444444444" },
    );

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      noop: true,
      stage_id: "44444444-4444-4444-8444-444444444444",
      stage_name: "Qualificado",
    });
    expect(supabase.updates.deals).toBeUndefined();
  });

  it("movePipelineStageHandler honors pipeline_id filter to disambiguate multi-pipeline lead", async () => {
    const PIPE_2 = "55555555-5555-4555-8555-555555555555";
    const supabase = createSupabaseMock();
    // Mock retorna so o deal do pipeline-2 (filtrado pelo .eq("pipeline_id", ...))
    supabase.queue("deals", {
      data: [
        { id: "deal-2", pipeline_id: PIPE_2, stage_id: "stage-y", status: "open" },
      ],
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Fechado",
        pipeline_id: PIPE_2,
        organization_id: ORG_A,
      },
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: { name: "Em negociacao" },
      error: null,
    });

    const result = await movePipelineStageHandler(
      {
        organization_id: ORG_A,
        lead_id: "lead-a",
        crm_conversation_id: "conv-a",
        agent_conversation_id: "agent-conv-a",
        run_id: "run-a",
        dry_run: true,
        db: supabase as never,
      } as never,
      {
        stage_id: "44444444-4444-4444-8444-444444444444",
        pipeline_id: PIPE_2,
      },
    );

    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      deal_id: "deal-2",
      pipeline_id: PIPE_2,
    });
    // Verifica que o filtro foi aplicado
    const dealFilters = supabase.filters.deals?.eq ?? [];
    expect(dealFilters.some(([col, val]) => col === "pipeline_id" && val === PIPE_2)).toBe(true);
  });
});
