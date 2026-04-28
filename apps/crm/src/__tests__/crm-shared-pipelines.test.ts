import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));

import {
  createDeal,
  createPipeline,
  createStage,
  deleteDeal,
  deletePipeline,
  deleteStage,
  ensureDefaultPipeline,
  findLeadOpenDealWithStages,
  listLeadsForDealAssignment,
  listPipelines,
  listStages,
  listStagesForOrg,
  moveDealKanban,
  updateDeal,
  updateDealStatus,
  updatePipelineName,
  updateStage,
  updateStageOrder,
} from "@persia/shared/crm";

const ORG_A = "org-a";

function ctx(supabase: MockSupabase) {
  return { db: supabase as never, orgId: ORG_A };
}

describe("@persia/shared/crm — pipelines & stages & deals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // listPipelines
  // ============================================================================

  it("listPipelines sem opts retorna so metadata", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", {
      data: [{ id: "p1", name: "Funil A" }, { id: "p2", name: "Funil B" }],
      error: null,
    });

    const result = await listPipelines(ctx(supabase));

    expect(result).toHaveLength(2);
    const eqs = supabase.filters.pipelines?.eq ?? [];
    expect(eqs.some(([col, val]) => col === "organization_id" && val === ORG_A)).toBe(true);
  });

  it("listPipelines com withStagesAndDeals usa join nested", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", {
      data: [{ id: "p1", name: "F", pipeline_stages: [{ id: "s1", deals: [] }] }],
      error: null,
    });

    const result = await listPipelines(ctx(supabase), { withStagesAndDeals: true });

    expect(result).toHaveLength(1);
    // O select usado vem do mock — checamos via spy do .select().
    const selectCalls = supabase.selects.pipelines as unknown[][];
    expect(selectCalls?.[0]?.[0]).toContain("pipeline_stages");
  });

  // ============================================================================
  // listStages
  // ============================================================================

  it("listStages valida pipeline-org antes e retorna [] se nao pertence", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", { data: null, error: null });

    const result = await listStages(ctx(supabase), "p-fake");
    expect(result).toEqual([]);
  });

  it("listStages retorna stages ordenadas por sort_order", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", { data: { id: "p1" }, error: null });
    supabase.queue("pipeline_stages", {
      data: [
        { id: "s1", name: "Novo", sort_order: 0, pipeline_id: "p1", color: "#3b82f6" },
        { id: "s2", name: "Contato", sort_order: 1, pipeline_id: "p1", color: "#f59e0b" },
      ],
      error: null,
    });

    const result = await listStages(ctx(supabase), "p1");
    expect(result).toHaveLength(2);
  });

  // ============================================================================
  // createPipeline
  // ============================================================================

  it("createPipeline insere pipeline + 6 stages padrao com outcomes corretos", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", { data: { id: "p-new", name: "Funil Principal" }, error: null });
    // 6 inserts em pipeline_stages (4 em_andamento + 1 falha + 1 bem_sucedido)
    for (let i = 0; i < 6; i++) {
      supabase.queue("pipeline_stages", { data: null, error: null });
    }

    const pipeline = await createPipeline(ctx(supabase));

    expect(pipeline.id).toBe("p-new");
    expect(supabase.inserts.pipeline_stages).toHaveLength(6);

    const inserted = supabase.inserts.pipeline_stages as Array<{
      name: string;
      outcome: string;
    }>;

    expect(inserted.map((s) => s.name)).toEqual([
      "Novo",
      "Contato",
      "Qualificado",
      "Proposta",
      "Perdido",
      "Fechado",
    ]);
    expect(inserted.map((s) => s.outcome)).toEqual([
      "em_andamento",
      "em_andamento",
      "em_andamento",
      "em_andamento",
      "falha",
      "bem_sucedido",
    ]);
  });

  it("createPipeline com withDefaultStages: false nao cria stages", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", { data: { id: "p-vazio", name: "F" }, error: null });

    await createPipeline(ctx(supabase), { name: "F", withDefaultStages: false });

    expect(supabase.inserts.pipeline_stages).toBeUndefined();
  });

  // ============================================================================
  // updatePipelineName
  // ============================================================================

  it("updatePipelineName atualiza com org-scoping", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", { data: null, error: null });

    await updatePipelineName(ctx(supabase), "p1", "Novo Nome");

    expect(supabase.updates.pipelines?.[0]).toMatchObject({ name: "Novo Nome" });
    const eqs = supabase.filters.pipelines?.eq ?? [];
    expect(eqs.some(([col, val]) => col === "organization_id" && val === ORG_A)).toBe(true);
  });

  // ============================================================================
  // deletePipeline
  // ============================================================================

  it("deletePipeline em cascata: ownership → deals → stages → pipeline", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", { data: { id: "p1" }, error: null }); // ownership
    supabase.queue("pipeline_stages", { data: [{ id: "s1" }, { id: "s2" }], error: null }); // get stages
    supabase.queue("deals", { data: null, error: null }); // delete deals stage 1
    supabase.queue("deals", { data: null, error: null }); // delete deals stage 2
    supabase.queue("pipeline_stages", { data: null, error: null }); // delete all stages
    supabase.queue("pipelines", { data: null, error: null }); // delete pipeline

    await deletePipeline(ctx(supabase), "p1");

    expect(supabase.deletes.deals).toBe(true);
    expect(supabase.deletes.pipeline_stages).toBe(true);
    expect(supabase.deletes.pipelines).toBe(true);
  });

  it("deletePipeline throw quando pipeline nao pertence ao org", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", { data: null, error: null });

    await expect(deletePipeline(ctx(supabase), "p-fake")).rejects.toThrow(/nao encontrado/i);
  });

  // ============================================================================
  // createStage
  // ============================================================================

  it("createStage valida pipeline pertence ao org", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", { data: null, error: null });

    await expect(
      createStage(ctx(supabase), { pipelineId: "p-fake", name: "X", sortOrder: 0 }),
    ).rejects.toThrow(/Pipeline nao encontrado/);
    expect(supabase.inserts.pipeline_stages).toBeUndefined();
  });

  it("createStage usa cor default quando nao informada", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", { data: { id: "p1" }, error: null });
    supabase.queue("pipeline_stages", {
      data: { id: "s-new", name: "Custom", sort_order: 3, pipeline_id: "p1", color: "#6366f1" },
      error: null,
    });

    await createStage(ctx(supabase), { pipelineId: "p1", name: "Custom", sortOrder: 3 });

    expect(supabase.inserts.pipeline_stages?.[0]).toMatchObject({
      pipeline_id: "p1",
      name: "Custom",
      sort_order: 3,
      color: "#6366f1",
    });
  });

  // ============================================================================
  // updateStage
  // ============================================================================

  it("updateStage maps sortOrder → sort_order no DB patch", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", { data: { id: "s1" }, error: null }); // ownership
    supabase.queue("pipeline_stages", { data: null, error: null }); // update

    await updateStage(ctx(supabase), "s1", { name: "Renomeada", sortOrder: 5 });

    expect(supabase.updates.pipeline_stages?.[0]).toMatchObject({
      name: "Renomeada",
      sort_order: 5,
    });
  });

  it("updateStage noop quando sem campos", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", { data: { id: "s1" }, error: null });

    await updateStage(ctx(supabase), "s1", {});

    expect(supabase.updates.pipeline_stages).toBeUndefined();
  });

  // ============================================================================
  // updateStageOrder (bulk)
  // ============================================================================

  it("updateStageOrder atualiza sort_order pra cada stage", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", { data: null, error: null });
    supabase.queue("pipeline_stages", { data: null, error: null });
    supabase.queue("pipeline_stages", { data: null, error: null });

    await updateStageOrder(ctx(supabase), [
      { id: "s1", position: 0 },
      { id: "s2", position: 1 },
      { id: "s3", position: 2 },
    ]);

    expect(supabase.updates.pipeline_stages).toHaveLength(3);
    const updates = supabase.updates.pipeline_stages as Array<{ sort_order: number }>;
    expect(updates.map((u) => u.sort_order)).toEqual([0, 1, 2]);
  });

  // ============================================================================
  // deleteStage
  // ============================================================================

  it("deleteStage cascata deals + stage com org-scoping", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", { data: { id: "s1" }, error: null }); // ownership
    supabase.queue("deals", { data: null, error: null }); // delete deals
    supabase.queue("pipeline_stages", { data: null, error: null }); // delete stage

    await deleteStage(ctx(supabase), "s1");

    expect(supabase.deletes.deals).toBe(true);
    expect(supabase.deletes.pipeline_stages).toBe(true);
  });

  // ============================================================================
  // createDeal
  // ============================================================================

  it("createDeal valida stage pertence ao pipeline + org", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", { data: null, error: null });

    await expect(
      createDeal(ctx(supabase), { pipelineId: "p1", stageId: "s-fake", title: "Deal X" }),
    ).rejects.toThrow(/Etapa nao encontrada neste funil/);
  });

  it("createDeal valida lead pertence ao org quando lead_id informado", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", { data: { id: "s1", pipeline_id: "p1" }, error: null });
    supabase.queue("leads", { data: null, error: null });

    await expect(
      createDeal(ctx(supabase), {
        pipelineId: "p1",
        stageId: "s1",
        title: "Deal",
        leadId: "lead-x",
      }),
    ).rejects.toThrow(/Lead nao encontrado/);
  });

  it("createDeal insere com defaults (status=open, value=0 quando omitido)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", { data: { id: "s1", pipeline_id: "p1" }, error: null });
    supabase.queue("deals", {
      data: { id: "d-new", title: "X", status: "open", value: 0 },
      error: null,
    });

    await createDeal(ctx(supabase), { pipelineId: "p1", stageId: "s1", title: "X" });

    expect(supabase.inserts.deals?.[0]).toMatchObject({
      organization_id: ORG_A,
      pipeline_id: "p1",
      stage_id: "s1",
      title: "X",
      value: 0,
      status: "open",
    });
  });

  // ============================================================================
  // updateDeal
  // ============================================================================

  it("updateDeal seta closed_at quando status muda pra won", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", { data: null, error: null });

    await updateDeal(ctx(supabase), "d1", { status: "won" });

    const patch = supabase.updates.deals?.[0] as Record<string, unknown>;
    expect(patch.status).toBe("won");
    expect(patch.closed_at).toBeTruthy();
  });

  it("updateDeal limpa closed_at quando volta pra open", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", { data: null, error: null });

    await updateDeal(ctx(supabase), "d1", { status: "open" });

    const patch = supabase.updates.deals?.[0] as Record<string, unknown>;
    expect(patch.closed_at).toBeNull();
  });

  it("updateDeal noop quando sem campos", async () => {
    const supabase = createSupabaseMock();

    await updateDeal(ctx(supabase), "d1", {});
    expect(supabase.updates.deals).toBeUndefined();
  });

  // ============================================================================
  // updateDealStatus
  // ============================================================================

  it("updateDealStatus delega pra updateDeal", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", { data: null, error: null });

    await updateDealStatus(ctx(supabase), "d1", "lost");

    const patch = supabase.updates.deals?.[0] as Record<string, unknown>;
    expect(patch.status).toBe("lost");
    expect(patch.closed_at).toBeTruthy();
  });

  // ============================================================================
  // moveDealKanban
  // ============================================================================

  it("moveDealKanban valida que stage e deal estao no MESMO pipeline", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", { data: { id: "s1", pipeline_id: "p1" }, error: null });
    supabase.queue("deals", { data: { id: "d1", pipeline_id: "p2" }, error: null }); // pipeline diferente

    await expect(
      moveDealKanban(ctx(supabase), "d1", "s1", 0),
    ).rejects.toThrow(/nao pertence ao mesmo funil/);
  });

  it("moveDealKanban atualiza stage_id + sort_order quando pipelines batem", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", { data: { id: "s2", pipeline_id: "p1" }, error: null });
    supabase.queue("deals", { data: { id: "d1", pipeline_id: "p1" }, error: null });
    supabase.queue("deals", { data: null, error: null });

    await moveDealKanban(ctx(supabase), "d1", "s2", 3);

    expect(supabase.updates.deals?.[0]).toMatchObject({
      stage_id: "s2",
      sort_order: 3,
    });
  });

  // ============================================================================
  // deleteDeal
  // ============================================================================

  it("deleteDeal remove com org-scoping", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", { data: null, error: null });

    await deleteDeal(ctx(supabase), "d1");

    expect(supabase.deletes.deals).toBe(true);
  });

  // ============================================================================
  // listLeadsForDealAssignment
  // ============================================================================

  it("listLeadsForDealAssignment retorna lista compacta org-scoped", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: [
        { id: "l1", name: "Ana", phone: "111", email: "a@x" },
        { id: "l2", name: "Bruno", phone: "222", email: "b@x" },
      ],
      error: null,
    });

    const result = await listLeadsForDealAssignment(ctx(supabase));

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("l1");
    const eqs = supabase.filters.leads?.eq ?? [];
    expect(
      eqs.some(([col, val]) => col === "organization_id" && val === ORG_A),
    ).toBe(true);
  });

  it("listLeadsForDealAssignment retorna [] quando query vazia", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: null, error: null });

    const result = await listLeadsForDealAssignment(ctx(supabase));
    expect(result).toEqual([]);
  });

  it("listLeadsForDealAssignment throw quando DB retorna erro", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: null, error: { message: "boom" } });

    await expect(listLeadsForDealAssignment(ctx(supabase))).rejects.toThrow(
      "boom",
    );
  });

  // ============================================================================
  // listStagesForOrg
  // ============================================================================

  it("listStagesForOrg retorna stages do org sem filtrar pipeline", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", {
      data: [
        { id: "s1", pipeline_id: "p1", sort_order: 0 },
        { id: "s2", pipeline_id: "p2", sort_order: 1 },
      ],
      error: null,
    });

    const result = await listStagesForOrg(ctx(supabase));
    expect(result).toHaveLength(2);
    const eqs = supabase.filters.pipeline_stages?.eq ?? [];
    expect(
      eqs.some(([col, val]) => col === "organization_id" && val === ORG_A),
    ).toBe(true);
    // Nao filtra por pipeline_id
    expect(eqs.some(([col]) => col === "pipeline_id")).toBe(false);
  });

  it("listStagesForOrg throw em erro de DB", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", {
      data: null,
      error: { message: "fail" },
    });

    await expect(listStagesForOrg(ctx(supabase))).rejects.toThrow("fail");
  });

  // ============================================================================
  // findLeadOpenDealWithStages
  // ============================================================================

  it("findLeadOpenDealWithStages retorna null quando lead nao tem deal aberto", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", { data: null, error: null });

    const result = await findLeadOpenDealWithStages(ctx(supabase), "lead-1");
    expect(result).toBeNull();
  });

  it("findLeadOpenDealWithStages retorna deal + stages do pipeline", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", {
      data: {
        id: "d1",
        pipeline_id: "p1",
        stage_id: "s2",
        status: "open",
      },
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: [
        {
          id: "s1",
          name: "Novo",
          color: "#fff",
          outcome: "em_andamento",
          sort_order: 0,
        },
        {
          id: "s2",
          name: "Qualificado",
          color: "#000",
          outcome: "em_andamento",
          sort_order: 1,
        },
      ],
      error: null,
    });

    const result = await findLeadOpenDealWithStages(ctx(supabase), "lead-1");
    expect(result).not.toBeNull();
    expect(result!.deal).toEqual({
      id: "d1",
      pipeline_id: "p1",
      stage_id: "s2",
    });
    expect(result!.stages).toHaveLength(2);
    expect(result!.stages[0].id).toBe("s1");
  });

  it("findLeadOpenDealWithStages throw quando query de stages falha", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", {
      data: { id: "d1", pipeline_id: "p1", stage_id: "s1", status: "open" },
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: null,
      error: { message: "stages err" },
    });

    await expect(
      findLeadOpenDealWithStages(ctx(supabase), "lead-1"),
    ).rejects.toThrow("stages err");
  });

  // ============================================================================
  // ensureDefaultPipeline
  // ============================================================================

  it("ensureDefaultPipeline retorna id existente quando ja ha pipeline", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipelines", {
      data: { id: "p-existing" },
      error: null,
    });

    const id = await ensureDefaultPipeline(ctx(supabase));
    expect(id).toBe("p-existing");
    // Nao chamou insert
    expect(supabase.inserts.pipelines).toBeUndefined();
  });

  it("ensureDefaultPipeline cria pipeline default quando org nao tem nenhum", async () => {
    const supabase = createSupabaseMock();
    // 1. lookup do existing — nada
    supabase.queue("pipelines", { data: null, error: null });
    // 2. insert do pipeline novo
    supabase.queue("pipelines", {
      data: { id: "p-new", name: "Funil Principal" },
      error: null,
    });
    // 3-8. inserts das 6 stages padrao (best-effort, retorno nao importa)
    for (let i = 0; i < 6; i++) {
      supabase.queue("pipeline_stages", { data: null, error: null });
    }

    const id = await ensureDefaultPipeline(ctx(supabase));
    expect(id).toBe("p-new");
    expect(supabase.inserts.pipelines).toBeDefined();
  });
});
