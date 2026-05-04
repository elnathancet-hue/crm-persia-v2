import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));

import {
  bulkApplyTagsToDealLeads,
  bulkDeleteDeals,
  bulkMarkDealsAsLost,
  bulkMoveDealsToStage,
  bulkUpdateDealStatus,
  markDealAsLost,
  moveDealKanban,
} from "@persia/shared/crm";

const ORG_A = "org-a";

function ctx(supabase: MockSupabase) {
  return { db: supabase as never, orgId: ORG_A };
}

// PR-AUDX/PR-AUD6: cobre as 5 bulk ops + markDealAsLost + audit log
// (insert em lead_activities) + count REAL (era otimista) + os new
// caminhos do moveDealKanban com audit. Os criticos de seguranca
// (org-scoping, sanitizacao) e UX ja entraram em PRs anteriores;
// estes tests trancam o comportamento.

describe("@persia/shared/crm — bulk mutations + audit log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Silencia console.error que o sanitizeMutationError usa em alguns
    // paths de erro do mock.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  // ==========================================================================
  // moveDealKanban — audit log novo
  // ==========================================================================

  it("moveDealKanban loga em lead_activities quando muda de stage", async () => {
    const supabase = createSupabaseMock();
    // Stage alvo
    supabase.queue("pipeline_stages", {
      data: { id: "stage-b", pipeline_id: "p1", name: "Qualificado" },
      error: null,
    });
    // Deal atual (no stage-a, lead-1)
    supabase.queue("deals", {
      data: { id: "d1", pipeline_id: "p1", lead_id: "lead-1", stage_id: "stage-a" },
      error: null,
    });
    // Update do deal
    supabase.queue("deals", { data: null, error: null });
    // Lookup nome da stage origem
    supabase.queue("pipeline_stages", {
      data: { name: "Novo" },
      error: null,
    });
    // Insert em lead_activities (fire-and-forget)
    supabase.queue("lead_activities", { data: null, error: null });

    await moveDealKanban(ctx(supabase), "d1", "stage-b", 5);

    const inserts = supabase.inserts.lead_activities ?? [];
    expect(inserts).toHaveLength(1);
    const row = inserts[0] as Record<string, unknown>;
    expect(row.lead_id).toBe("lead-1");
    expect(row.organization_id).toBe(ORG_A);
    expect(row.type).toBe("stage_change");
    expect(row.description).toContain("Qualificado");
    expect(row.description).toContain("Kanban");
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.source).toBe("kanban_drag");
    expect(meta.deal_id).toBe("d1");
    expect(meta.to_stage_id).toBe("stage-b");
  });

  it("moveDealKanban NAO loga quando stage de destino == stage atual (idempotency)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", {
      data: { id: "stage-a", pipeline_id: "p1", name: "Novo" },
      error: null,
    });
    supabase.queue("deals", {
      data: { id: "d1", pipeline_id: "p1", lead_id: "lead-1", stage_id: "stage-a" },
      error: null,
    });
    supabase.queue("deals", { data: null, error: null });

    await moveDealKanban(ctx(supabase), "d1", "stage-a", 5);

    expect(supabase.inserts.lead_activities ?? []).toHaveLength(0);
  });

  it("moveDealKanban NAO loga quando deal nao tem lead_id (orphan deal)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", {
      data: { id: "stage-b", pipeline_id: "p1", name: "Q" },
      error: null,
    });
    supabase.queue("deals", {
      data: { id: "d1", pipeline_id: "p1", lead_id: null, stage_id: "stage-a" },
      error: null,
    });
    supabase.queue("deals", { data: null, error: null });

    await moveDealKanban(ctx(supabase), "d1", "stage-b", 5);

    expect(supabase.inserts.lead_activities ?? []).toHaveLength(0);
  });

  // ==========================================================================
  // markDealAsLost
  // ==========================================================================

  it("markDealAsLost rejeita motivo vazio", async () => {
    const supabase = createSupabaseMock();
    await expect(
      markDealAsLost(ctx(supabase), "d1", { loss_reason: "  " }),
    ).rejects.toThrow(/obrigatorio/i);
  });

  it("markDealAsLost atualiza status + colunas de loss + trim", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", { data: null, error: null });

    await markDealAsLost(ctx(supabase), "d1", {
      loss_reason: "  Sem orcamento  ",
      competitor: "  Acme  ",
      loss_note: "  Negociou direto com o gerente  ",
    });

    const updates = supabase.updates.deals as Array<Record<string, unknown>>;
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("lost");
    expect(updates[0].loss_reason).toBe("Sem orcamento");
    expect(updates[0].competitor).toBe("Acme");
    expect(updates[0].loss_note).toBe("Negociou direto com o gerente");
  });

  // ==========================================================================
  // bulkMarkDealsAsLost — audit + real count
  // ==========================================================================

  it("bulkMarkDealsAsLost retorna count REAL (count do que realmente atualizou, nao o ids.length)", async () => {
    const supabase = createSupabaseMock();
    // Update retorna so 2 das 3 ids (1 caiu em RLS)
    supabase.queue("deals", {
      data: [
        { id: "d1", lead_id: "lead-1" },
        { id: "d2", lead_id: "lead-2" },
      ],
      error: null,
    });
    // 2 inserts em lead_activities (1 por deal com lead_id)
    supabase.queue("lead_activities", { data: null, error: null });

    const result = await bulkMarkDealsAsLost(ctx(supabase), ["d1", "d2", "d3"], {
      loss_reason: "Concorrente",
    });

    expect(result.updated_count).toBe(2);
  });

  it("bulkMarkDealsAsLost loga 1 entry em lead_activities por deal com lead", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", {
      data: [
        { id: "d1", lead_id: "lead-1" },
        { id: "d2", lead_id: "lead-2" },
        { id: "d3", lead_id: null },  // sem lead — pula log
      ],
      error: null,
    });
    supabase.queue("lead_activities", { data: null, error: null });

    await bulkMarkDealsAsLost(ctx(supabase), ["d1", "d2", "d3"], {
      loss_reason: "Sem orcamento",
      competitor: "Acme",
    });

    const inserts = supabase.inserts.lead_activities ?? [];
    expect(inserts).toHaveLength(1);
    const batch = inserts[0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(2);  // so deals com lead_id
    expect(batch[0].type).toBe("deal_lost");
    expect(batch[0].description).toContain("Sem orcamento");
    const meta = batch[0].metadata as Record<string, unknown>;
    expect(meta.source).toBe("bulk_mark_lost");
    expect(meta.competitor).toBe("Acme");
  });

  it("bulkMarkDealsAsLost rejeita > 200 ids", async () => {
    const supabase = createSupabaseMock();
    const ids = Array.from({ length: 201 }, (_, i) => `d${i}`);
    await expect(
      bulkMarkDealsAsLost(ctx(supabase), ids, { loss_reason: "X" }),
    ).rejects.toThrow(/Maximo 200/);
  });

  it("bulkMarkDealsAsLost retorna { updated_count: 0 } quando array vazio", async () => {
    const supabase = createSupabaseMock();
    const result = await bulkMarkDealsAsLost(ctx(supabase), [], {
      loss_reason: "X",
    });
    expect(result).toEqual({ updated_count: 0 });
  });

  // ==========================================================================
  // bulkMoveDealsToStage — audit + real count
  // ==========================================================================

  it("bulkMoveDealsToStage retorna count REAL e loga audit", async () => {
    const supabase = createSupabaseMock();
    // 1. Stage de destino
    supabase.queue("pipeline_stages", {
      data: { id: "stage-b", pipeline_id: "p1", name: "Qualificado" },
      error: null,
    });
    // 2. Lookup dos deals (todos do pipeline p1)
    supabase.queue("deals", {
      data: [
        { id: "d1", pipeline_id: "p1", lead_id: "lead-1", stage_id: "stage-a" },
        { id: "d2", pipeline_id: "p1", lead_id: "lead-2", stage_id: "stage-a" },
      ],
      error: null,
    });
    // 3. Update + select retorna 2 deals atualizados
    supabase.queue("deals", {
      data: [{ id: "d1" }, { id: "d2" }],
      error: null,
    });
    // 4. Insert em lead_activities
    supabase.queue("lead_activities", { data: null, error: null });

    const result = await bulkMoveDealsToStage(ctx(supabase), ["d1", "d2"], "stage-b");

    expect(result.moved_count).toBe(2);
    const inserts = supabase.inserts.lead_activities ?? [];
    expect(inserts).toHaveLength(1);
    const batch = inserts[0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(2);
    expect(batch[0].type).toBe("stage_change");
    expect((batch[0].metadata as Record<string, unknown>).source).toBe("bulk_move");
  });

  it("bulkMoveDealsToStage rejeita quando algum deal e de outro pipeline", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", {
      data: { id: "stage-b", pipeline_id: "p1", name: "Q" },
      error: null,
    });
    supabase.queue("deals", {
      data: [
        { id: "d1", pipeline_id: "p1", lead_id: null, stage_id: "stage-a" },
        { id: "d2", pipeline_id: "p2", lead_id: null, stage_id: "stage-x" }, // outro pipeline
      ],
      error: null,
    });

    await expect(
      bulkMoveDealsToStage(ctx(supabase), ["d1", "d2"], "stage-b"),
    ).rejects.toThrow(/outro funil/);
  });

  it("bulkMoveDealsToStage rejeita ids nao encontrados (cross-tenant defense)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("pipeline_stages", {
      data: { id: "stage-b", pipeline_id: "p1", name: "Q" },
      error: null,
    });
    supabase.queue("deals", {
      data: [{ id: "d1", pipeline_id: "p1", lead_id: null, stage_id: "stage-a" }],
      error: null,
    });
    // Pediu 2, voltou 1 — id "d2" nao existe ou e de outro tenant
    await expect(
      bulkMoveDealsToStage(ctx(supabase), ["d1", "d2"], "stage-b"),
    ).rejects.toThrow(/nao foram encontrados/);
  });

  // ==========================================================================
  // bulkUpdateDealStatus — audit + real count
  // ==========================================================================

  it("bulkUpdateDealStatus retorna count REAL e loga audit", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", {
      data: [
        { id: "d1", lead_id: "lead-1" },
        { id: "d2", lead_id: null },
      ],
      error: null,
    });
    supabase.queue("lead_activities", { data: null, error: null });

    const result = await bulkUpdateDealStatus(ctx(supabase), ["d1", "d2"], "won");

    expect(result.updated_count).toBe(2);
    const inserts = supabase.inserts.lead_activities ?? [];
    expect(inserts).toHaveLength(1);
    const batch = inserts[0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(1);  // so o deal com lead_id
    expect(batch[0].description).toContain("ganho");
  });

  it("bulkUpdateDealStatus seta closed_at quando status != open", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", { data: [{ id: "d1", lead_id: null }], error: null });

    await bulkUpdateDealStatus(ctx(supabase), ["d1"], "lost");

    const updates = supabase.updates.deals as Array<Record<string, unknown>>;
    expect(updates[0].status).toBe("lost");
    expect(updates[0].closed_at).toBeTruthy();
  });

  it("bulkUpdateDealStatus limpa closed_at quando volta pra open", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("deals", { data: [{ id: "d1", lead_id: null }], error: null });

    await bulkUpdateDealStatus(ctx(supabase), ["d1"], "open");

    const updates = supabase.updates.deals as Array<Record<string, unknown>>;
    expect(updates[0].closed_at).toBeNull();
  });

  // ==========================================================================
  // bulkDeleteDeals — captura snapshot ANTES do delete + count real
  // ==========================================================================

  it("bulkDeleteDeals captura lead_id ANTES do delete pra preservar log", async () => {
    const supabase = createSupabaseMock();
    // 1. Pre-delete snapshot
    supabase.queue("deals", {
      data: [
        { id: "d1", lead_id: "lead-1", title: "Negocio A" },
        { id: "d2", lead_id: null, title: "Negocio B" },
      ],
      error: null,
    });
    // 2. Delete + select
    supabase.queue("deals", { data: [{ id: "d1" }, { id: "d2" }], error: null });
    // 3. Insert em lead_activities
    supabase.queue("lead_activities", { data: null, error: null });

    const result = await bulkDeleteDeals(ctx(supabase), ["d1", "d2"]);

    expect(result.deleted_count).toBe(2);
    const inserts = supabase.inserts.lead_activities ?? [];
    expect(inserts).toHaveLength(1);
    const batch = inserts[0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(1);  // so d1 tem lead
    expect(batch[0].type).toBe("deal_deleted");
    expect(batch[0].description).toContain("Negocio A");
  });

  it("bulkDeleteDeals retorna count diferente quando RLS corta linhas", async () => {
    const supabase = createSupabaseMock();
    // Snapshot mostra 2 deals
    supabase.queue("deals", {
      data: [
        { id: "d1", lead_id: null, title: "A" },
        { id: "d2", lead_id: null, title: "B" },
      ],
      error: null,
    });
    // Mas delete so volta 1 (RLS bloqueou d2 in flight)
    supabase.queue("deals", { data: [{ id: "d1" }], error: null });

    const result = await bulkDeleteDeals(ctx(supabase), ["d1", "d2"]);
    expect(result.deleted_count).toBe(1);  // count REAL, nao otimista
  });

  it("bulkDeleteDeals retorna { deleted_count: 0 } quando array vazio (sem call ao DB)", async () => {
    const supabase = createSupabaseMock();
    const result = await bulkDeleteDeals(ctx(supabase), []);
    expect(result).toEqual({ deleted_count: 0 });
    // Confirma que nao foi ao DB
    expect(supabase.from).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // bulkApplyTagsToDealLeads — valida tags org + dedup leads + audit
  // ==========================================================================

  it("bulkApplyTagsToDealLeads valida que tags pertencem a org", async () => {
    const supabase = createSupabaseMock();
    // Tags retorna vazio (id de tag nao pertence ao org)
    supabase.queue("tags", { data: [], error: null });

    await expect(
      bulkApplyTagsToDealLeads(ctx(supabase), ["d1"], ["tag-de-outro-org"]),
    ).rejects.toThrow(/Nenhuma tag valida/);
  });

  it("bulkApplyTagsToDealLeads dedupe leads quando multiplos deals tem mesmo lead_id", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", {
      data: [{ id: "tag-1", name: "QUENTE" }],
      error: null,
    });
    // 3 deals mas todos do mesmo lead -> 1 link so
    supabase.queue("deals", {
      data: [
        { id: "d1", lead_id: "lead-1" },
        { id: "d2", lead_id: "lead-1" },
        { id: "d3", lead_id: "lead-1" },
      ],
      error: null,
    });
    supabase.queue("lead_tags", { data: null, error: null });
    supabase.queue("lead_activities", { data: null, error: null });

    const result = await bulkApplyTagsToDealLeads(
      ctx(supabase),
      ["d1", "d2", "d3"],
      ["tag-1"],
    );

    expect(result.leads_count).toBe(1);
    expect(result.links_count).toBe(1);
    // Audit log: 1 entry pro lead unico
    const auditInserts = supabase.inserts.lead_activities ?? [];
    expect(auditInserts).toHaveLength(1);
    const batch = auditInserts[0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(1);
    expect(batch[0].type).toBe("tag_applied");
  });

  it("bulkApplyTagsToDealLeads retorna zeros quando todos os deals sao orphan", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", {
      data: [{ id: "tag-1", name: "X" }],
      error: null,
    });
    supabase.queue("deals", {
      data: [
        { id: "d1", lead_id: null },
        { id: "d2", lead_id: null },
      ],
      error: null,
    });

    const result = await bulkApplyTagsToDealLeads(
      ctx(supabase),
      ["d1", "d2"],
      ["tag-1"],
    );

    expect(result).toEqual({ leads_count: 0, links_count: 0 });
  });

  it("bulkApplyTagsToDealLeads gera N×M links (N leads × M tags)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", {
      data: [
        { id: "tag-1", name: "A" },
        { id: "tag-2", name: "B" },
      ],
      error: null,
    });
    supabase.queue("deals", {
      data: [
        { id: "d1", lead_id: "lead-1" },
        { id: "d2", lead_id: "lead-2" },
      ],
      error: null,
    });
    supabase.queue("lead_tags", { data: null, error: null });
    supabase.queue("lead_activities", { data: null, error: null });

    const result = await bulkApplyTagsToDealLeads(
      ctx(supabase),
      ["d1", "d2"],
      ["tag-1", "tag-2"],
    );

    expect(result.leads_count).toBe(2);
    expect(result.links_count).toBe(4);  // 2 × 2

    // Confirma que o upsert recebeu 4 linhas
    const upserts = supabase.inserts.lead_tags as Array<unknown>[];
    expect(upserts[0]).toHaveLength(4);
  });
});
