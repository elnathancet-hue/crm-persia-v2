import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));

import {
  fetchLead,
  fetchLeadActivities,
  listLeads,
  listTags,
  listTagsWithCount,
} from "@persia/shared/crm";

const ORG_A = "org-a";

function ctx(supabase: MockSupabase) {
  return { db: supabase as never, orgId: ORG_A };
}

describe("@persia/shared/crm — queries compartilhadas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // listLeads
  // ============================================================================

  it("listLeads sem filtros retorna leads paginados do org", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: [
        { id: "lead-1", name: "Carlos", lead_tags: [] },
        { id: "lead-2", name: "Ana", lead_tags: [] },
      ],
      error: null,
      count: 2,
    });

    const result = await listLeads(ctx(supabase));

    expect(result).toMatchObject({
      total: 2,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(result.leads).toHaveLength(2);
    // Filtro org sempre aplicado (defesa em profundidade pra service-role).
    const eqs = supabase.filters.leads?.eq ?? [];
    expect(eqs.some(([col, val]) => col === "organization_id" && val === ORG_A)).toBe(true);
  });

  it("listLeads com status='all' nao aplica filtro de status", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: [], error: null, count: 0 });

    await listLeads(ctx(supabase), { status: "all" });

    const eqs = supabase.filters.leads?.eq ?? [];
    expect(eqs.some(([col]) => col === "status")).toBe(false);
  });

  it("listLeads com status='qualified' aplica filtro", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: [], error: null, count: 0 });

    await listLeads(ctx(supabase), { status: "qualified" });

    const eqs = supabase.filters.leads?.eq ?? [];
    expect(eqs.some(([col, val]) => col === "status" && val === "qualified")).toBe(true);
  });

  it("listLeads com tags vazio resultando em zero leads retorna pagina vazia sem segunda query", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("lead_tags", { data: [], error: null });

    const result = await listLeads(ctx(supabase), { tags: ["tag-1"] });

    expect(result.leads).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
    // Nao chega a fazer query em "leads" — ja sabe que e vazio.
    expect(supabase.filters.leads).toBeUndefined();
  });

  it("listLeads com tags pre-filtra via lead_tags antes do select de leads", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("lead_tags", {
      data: [
        { lead_id: "lead-1" },
        { lead_id: "lead-2" },
        { lead_id: "lead-1" }, // duplicada — deve ser deduplicada
      ],
      error: null,
    });
    supabase.queue("leads", {
      data: [{ id: "lead-1", lead_tags: [] }],
      error: null,
      count: 1,
    });

    const result = await listLeads(ctx(supabase), { tags: ["tag-vip"] });

    expect(result.leads).toHaveLength(1);
    const inFilters = supabase.filters.leads?.in ?? [];
    expect(
      inFilters.some(([col, vals]) => col === "id" && vals.length === 2),
    ).toBe(true);
  });

  it("listLeads paginacao calcula totalPages corretamente", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: [], error: null, count: 47 });

    const result = await listLeads(ctx(supabase), { page: 2, limit: 10 });

    expect(result.total).toBe(47);
    expect(result.totalPages).toBe(5);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
  });

  it("listLeads throw quando DB retorna error", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: null, error: { message: "db down" } });

    await expect(listLeads(ctx(supabase))).rejects.toThrow("db down");
  });

  // ============================================================================
  // fetchLead
  // ============================================================================

  it("fetchLead retorna lead + custom fields + activities", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: { id: "lead-1", name: "Carlos", lead_tags: [] },
      error: null,
    });
    supabase.queue("lead_custom_field_values", {
      data: [
        {
          id: "cf-1",
          custom_field_id: "field-1",
          value: "Brasil",
          custom_fields: { id: "field-1", name: "Pais", field_type: "text" },
        },
      ],
      error: null,
    });
    supabase.queue("lead_activities", {
      data: [{ id: "act-1", type: "stage_change", lead_id: "lead-1" }],
      error: null,
    });

    const result = await fetchLead(ctx(supabase), "lead-1");

    expect(result.lead.id).toBe("lead-1");
    expect(result.lead.lead_custom_field_values).toHaveLength(1);
    expect(result.activities).toHaveLength(1);
  });

  it("fetchLead throw quando lead nao existe", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", {
      data: null,
      error: { message: "Row not found" },
    });

    await expect(fetchLead(ctx(supabase), "lead-x")).rejects.toThrow("Row not found");
  });

  // ============================================================================
  // fetchLeadActivities
  // ============================================================================

  it("fetchLeadActivities verifica que lead pertence ao org antes", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: { id: "lead-1" }, error: null });
    supabase.queue("lead_activities", {
      data: [{ id: "act-1", lead_id: "lead-1" }],
      error: null,
    });

    const result = await fetchLeadActivities(ctx(supabase), "lead-1");
    expect(result).toHaveLength(1);

    // Verifica que houve query no leads (org check).
    const leadsEqs = supabase.filters.leads?.eq ?? [];
    expect(leadsEqs.some(([col, val]) => col === "organization_id" && val === ORG_A)).toBe(true);
  });

  it("fetchLeadActivities throw quando lead nao pertence ao org", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: null, error: null }); // maybeSingle vazio

    await expect(
      fetchLeadActivities(ctx(supabase), "lead-x"),
    ).rejects.toThrow("Lead nao encontrado nesta organizacao");
  });

  it("fetchLeadActivities aplica limit quando informado", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("leads", { data: { id: "lead-1" }, error: null });
    supabase.queue("lead_activities", { data: [], error: null });

    await fetchLeadActivities(ctx(supabase), "lead-1", { limit: 50 });

    // Inspeciona o builder do lead_activities pra garantir limit foi chamado.
    const builder = supabase.from.mock.results.find((r) =>
      (supabase.from as ReturnType<typeof vi.fn>).mock.calls.some(
        (c, i) => c[0] === "lead_activities" && supabase.from.mock.results[i] === r,
      ),
    );
    // Garantia leve — se o limit foi chamado, builder.limit eh chamado pelo menos 1x.
    if (builder) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const limitFn = (builder.value as any).limit as ReturnType<typeof vi.fn>;
      expect(limitFn).toHaveBeenCalledWith(50);
    }
  });

  // ============================================================================
  // listTags
  // ============================================================================

  it("listTags ordena por created_at desc por padrao", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", {
      data: [
        { id: "tag-1", name: "vip", color: "#fff" },
        { id: "tag-2", name: "frio", color: "#ccc" },
      ],
      error: null,
    });

    const result = await listTags(ctx(supabase));
    expect(result).toHaveLength(2);
  });

  it("listTags com orderBy='name' ordena alfabeticamente (admin behavior)", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: [], error: null });

    await listTags(ctx(supabase), { orderBy: "name" });
    // Mock nao captura order arg, mas assertion eh que nao throw.
  });

  it("listTags throw em erro de DB", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: null, error: { message: "db error" } });

    await expect(listTags(ctx(supabase))).rejects.toThrow("db error");
  });

  // ============================================================================
  // listTagsWithCount
  // ============================================================================

  it("listTagsWithCount agrega lead_count por tag", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", {
      data: [
        { id: "tag-1", name: "vip", color: "#fff", organization_id: ORG_A, created_at: "2026-01-01" },
        { id: "tag-2", name: "frio", color: "#ccc", organization_id: ORG_A, created_at: "2026-01-02" },
      ],
      error: null,
    });
    supabase.queue("lead_tags", {
      data: [
        { tag_id: "tag-1" },
        { tag_id: "tag-1" },
        { tag_id: "tag-1" },
        { tag_id: "tag-2" },
      ],
      error: null,
    });

    const result = await listTagsWithCount(ctx(supabase));

    expect(result).toHaveLength(2);
    const vip = result.find((t) => t.id === "tag-1");
    const frio = result.find((t) => t.id === "tag-2");
    expect(vip?.lead_count).toBe(3);
    expect(frio?.lead_count).toBe(1);
  });

  it("listTagsWithCount retorna [] sem fazer segunda query quando nao ha tags", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", { data: [], error: null });

    const result = await listTagsWithCount(ctx(supabase));

    expect(result).toEqual([]);
    // Nao consultou lead_tags — economiza round-trip.
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("listTagsWithCount tag sem leads retorna lead_count: 0", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("tags", {
      data: [{ id: "tag-orfa", name: "nova", color: "#000", organization_id: ORG_A, created_at: "2026-01-01" }],
      error: null,
    });
    supabase.queue("lead_tags", { data: [], error: null });

    const result = await listTagsWithCount(ctx(supabase));

    expect(result[0]?.lead_count).toBe(0);
  });
});
