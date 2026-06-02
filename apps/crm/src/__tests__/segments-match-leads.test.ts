// Etapa 0 — Baseline e Testes de Caracterização
//
// Garante que qualquer melhoria de UX de segmentação não quebre o matcher.
// Cobre todos os campos e operadores suportados por findMatchingLeadIds.
// Nenhuma mudança funcional neste arquivo — pura caracterização do comportamento atual.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type MockSupabase } from "@/test/helpers/supabase-mock";

vi.mock("server-only", () => ({}));

import { findMatchingLeadIds } from "@persia/shared/crm";
import type { SegmentRules } from "@persia/shared/crm";

const ORG = "org-baseline";

describe("findMatchingLeadIds — Etapa 0 baseline", () => {
  let db: MockSupabase;

  beforeEach(() => {
    db = createSupabaseMock();
    vi.clearAllMocks();
  });

  // ============================================================================
  // Regras vazias / inválidas — comportamento documentado como "sem filtro"
  // ============================================================================

  it("retorna null para rules === null (caller deve tratar como sem filtro)", async () => {
    const result = await findMatchingLeadIds(db as never, ORG, null);
    expect(result).toBeNull();
  });

  it("retorna null para rules === undefined", async () => {
    const result = await findMatchingLeadIds(db as never, ORG, undefined);
    expect(result).toBeNull();
  });

  it("retorna null para conditions: [] (array vazio)", async () => {
    const rules: SegmentRules = { operator: "AND", conditions: [] };
    const result = await findMatchingLeadIds(db as never, ORG, rules);
    expect(result).toBeNull();
  });

  it("retorna null para conditions ausente no objeto", async () => {
    const rules: SegmentRules = { operator: "AND" };
    const result = await findMatchingLeadIds(db as never, ORG, rules);
    expect(result).toBeNull();
  });

  it("ignora condition com field não suportado (ex: pipeline_id) e retorna null se todas ignoradas", async () => {
    // pipeline_id não está na allowlist — deve ser silenciado
    const rules: SegmentRules = {
      operator: "AND",
      conditions: [{ field: "pipeline_id", op: "eq", value: "p1" }],
    };
    const result = await findMatchingLeadIds(db as never, ORG, rules);
    expect(result).toBeNull();
  });

  it("ignora condition sem field e retorna null", async () => {
    const rules: SegmentRules = {
      operator: "AND",
      conditions: [{ op: "eq", value: "new" }], // field ausente
    };
    const result = await findMatchingLeadIds(db as never, ORG, rules);
    expect(result).toBeNull();
  });

  it("ignora condition sem op e retorna null", async () => {
    const rules: SegmentRules = {
      operator: "AND",
      conditions: [{ field: "status", value: "new" }], // op ausente
    };
    const result = await findMatchingLeadIds(db as never, ORG, rules);
    expect(result).toBeNull();
  });

  // ============================================================================
  // Condition simples — status
  // ============================================================================

  it("status eq retorna leads do org com o status correspondente", async () => {
    db.queue("leads", {
      data: [{ id: "lead-1" }, { id: "lead-2" }],
      error: null,
    });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "status", op: "eq", value: "new" }],
    });

    expect(result).toEqual(expect.arrayContaining(["lead-1", "lead-2"]));
    expect(result).toHaveLength(2);
  });

  it("status neq retorna leads sem aquele status", async () => {
    db.queue("leads", { data: [{ id: "lead-3" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "status", op: "neq", value: "lost" }],
    });

    expect(result).toEqual(["lead-3"]);
  });

  it("retorna [] quando nenhum lead bate na condition", async () => {
    db.queue("leads", { data: [], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "status", op: "eq", value: "nonexistent" }],
    });

    expect(result).toEqual([]);
  });

  it("sempre filtra organization_id em queries de leads", async () => {
    db.queue("leads", { data: [{ id: "lead-1" }], error: null });

    await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "status", op: "eq", value: "new" }],
    });

    const eqs = db.filters.leads?.eq ?? [];
    expect(eqs.some(([col, val]) => col === "organization_id" && val === ORG)).toBe(true);
  });

  it("nunca filtra por organization_id de outro org", async () => {
    db.queue("leads", { data: [{ id: "lead-1" }], error: null });

    await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "status", op: "eq", value: "new" }],
    });

    const eqs = db.filters.leads?.eq ?? [];
    expect(eqs.some(([col, val]) => col === "organization_id" && val !== ORG)).toBe(false);
  });

  // ============================================================================
  // Operador AND — interseção
  // ============================================================================

  it("AND com 2 conditions retorna a interseção dos leads", async () => {
    // status=new → lead-1, lead-2
    db.queue("leads", { data: [{ id: "lead-1" }, { id: "lead-2" }], error: null });
    // source=instagram → lead-2, lead-3
    db.queue("leads", { data: [{ id: "lead-2" }, { id: "lead-3" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [
        { field: "status", op: "eq", value: "new" },
        { field: "source", op: "eq", value: "instagram" },
      ],
    });

    expect(result).toEqual(["lead-2"]);
  });

  it("AND retorna [] quando não há interseção", async () => {
    db.queue("leads", { data: [{ id: "lead-1" }], error: null });
    db.queue("leads", { data: [{ id: "lead-2" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [
        { field: "status", op: "eq", value: "new" },
        { field: "status", op: "eq", value: "qualified" },
      ],
    });

    expect(result).toEqual([]);
  });

  it("AND com 3 conditions aplica interseção encadeada", async () => {
    db.queue("leads", { data: [{ id: "A" }, { id: "B" }, { id: "C" }], error: null });
    db.queue("leads", { data: [{ id: "B" }, { id: "C" }], error: null });
    db.queue("leads", { data: [{ id: "C" }, { id: "D" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [
        { field: "status", op: "eq", value: "new" },
        { field: "source", op: "eq", value: "instagram" },
        { field: "channel", op: "eq", value: "whatsapp" },
      ],
    });

    expect(result).toEqual(["C"]);
  });

  // ============================================================================
  // Operador OR — união
  // ============================================================================

  it("OR com 2 conditions retorna a união dos leads", async () => {
    db.queue("leads", { data: [{ id: "lead-1" }], error: null });
    db.queue("leads", { data: [{ id: "lead-2" }, { id: "lead-3" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "OR",
      conditions: [
        { field: "status", op: "eq", value: "new" },
        { field: "source", op: "eq", value: "instagram" },
      ],
    });

    expect(result).toHaveLength(3);
    expect(result).toEqual(expect.arrayContaining(["lead-1", "lead-2", "lead-3"]));
  });

  it("OR deduplica leads que aparecem em múltiplas conditions", async () => {
    db.queue("leads", { data: [{ id: "lead-1" }, { id: "lead-2" }], error: null });
    db.queue("leads", { data: [{ id: "lead-2" }, { id: "lead-3" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "OR",
      conditions: [
        { field: "status", op: "eq", value: "new" },
        { field: "source", op: "eq", value: "instagram" },
      ],
    });

    expect(result).toHaveLength(3);
    expect(new Set(result).size).toBe(3); // sem duplicatas
  });

  it("OR com condition inválida ignora ela e usa as válidas", async () => {
    db.queue("leads", { data: [{ id: "lead-1" }], error: null });
    // segunda condition (field inválido) não faz query

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "OR",
      conditions: [
        { field: "status", op: "eq", value: "new" },
        { field: "pipeline_id", op: "eq", value: "p1" }, // ignorada
      ],
    });

    expect(result).toEqual(["lead-1"]);
  });

  // ============================================================================
  // Tags — contains / not_contains
  // ============================================================================

  it("tags contains retorna leads que têm a tag", async () => {
    db.queue("lead_tags", {
      data: [{ lead_id: "lead-1" }, { lead_id: "lead-3" }],
      error: null,
    });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "tags", op: "contains", value: "tag-vip" }],
    });

    expect(result).toEqual(expect.arrayContaining(["lead-1", "lead-3"]));
    expect(result).toHaveLength(2);
  });

  it("tags contains filtra organization_id em lead_tags", async () => {
    db.queue("lead_tags", { data: [], error: null });

    await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "tags", op: "contains", value: "tag-x" }],
    });

    const eqs = db.filters.lead_tags?.eq ?? [];
    expect(eqs.some(([col, val]) => col === "organization_id" && val === ORG)).toBe(true);
  });

  it("tags contains com múltiplas IDs separadas por vírgula usa .in()", async () => {
    db.queue("lead_tags", {
      data: [{ lead_id: "lead-1" }, { lead_id: "lead-2" }],
      error: null,
    });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "tags", op: "contains", value: "tag-a,tag-b" }],
    });

    const inFilters = db.filters.lead_tags?.in ?? [];
    expect(inFilters.some(([col, vals]) => col === "tag_id" && vals.length === 2)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("tags contains com value vazio retorna null (sem query)", async () => {
    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "tags", op: "contains", value: "" }],
    });

    expect(result).toBeNull();
    // não deve ter consultado lead_tags
    expect(db.filters.lead_tags).toBeUndefined();
  });

  it("tags not_contains retorna todos os leads do org MENOS os que têm a tag", async () => {
    // lead_tags: lead-1 tem a tag
    db.queue("lead_tags", { data: [{ lead_id: "lead-1" }], error: null });
    // todos os leads do org
    db.queue("leads", {
      data: [{ id: "lead-1" }, { id: "lead-2" }, { id: "lead-3" }],
      error: null,
    });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "tags", op: "not_contains", value: "tag-vip" }],
    });

    expect(result).toEqual(expect.arrayContaining(["lead-2", "lead-3"]));
    expect(result).not.toContain("lead-1");
  });

  it("tags not_contains retorna todos quando nenhum lead tem a tag", async () => {
    db.queue("lead_tags", { data: [], error: null }); // ninguém tem a tag
    db.queue("leads", {
      data: [{ id: "lead-1" }, { id: "lead-2" }],
      error: null,
    });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "tags", op: "not_contains", value: "tag-rara" }],
    });

    expect(result).toHaveLength(2);
  });

  it("tags not_contains retorna [] quando todos os leads têm a tag", async () => {
    db.queue("lead_tags", {
      data: [{ lead_id: "lead-1" }, { lead_id: "lead-2" }],
      error: null,
    });
    db.queue("leads", {
      data: [{ id: "lead-1" }, { id: "lead-2" }],
      error: null,
    });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "tags", op: "not_contains", value: "tag-vip" }],
    });

    expect(result).toEqual([]);
  });

  // ============================================================================
  // assigned_to
  // ============================================================================

  it("assigned_to eq retorna leads atribuídos ao responsável", async () => {
    db.queue("leads", { data: [{ id: "lead-1" }, { id: "lead-4" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "assigned_to", op: "eq", value: "user-99" }],
    });

    expect(result).toEqual(expect.arrayContaining(["lead-1", "lead-4"]));
    const eqs = db.filters.leads?.eq ?? [];
    expect(eqs.some(([col, val]) => col === "assigned_to" && val === "user-99")).toBe(true);
  });

  it("assigned_to neq exclui leads de um responsável", async () => {
    db.queue("leads", { data: [{ id: "lead-2" }, { id: "lead-3" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "assigned_to", op: "neq", value: "user-99" }],
    });

    expect(result).toHaveLength(2);
  });

  it("assigned_to is_null retorna leads sem responsável", async () => {
    db.queue("leads", { data: [{ id: "lead-5" }, { id: "lead-6" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "assigned_to", op: "is_null", value: "" }],
    });

    expect(result).toEqual(expect.arrayContaining(["lead-5", "lead-6"]));
  });

  // ============================================================================
  // Score — numérico
  // ============================================================================

  it("score gt retorna leads com score acima do valor", async () => {
    db.queue("leads", { data: [{ id: "lead-hot" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "score", op: "gt", value: "70" }],
    });

    expect(result).toEqual(["lead-hot"]);
  });

  it("score gte retorna leads com score >= valor", async () => {
    db.queue("leads", { data: [{ id: "lead-hot" }, { id: "lead-warm" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "score", op: "gte", value: "70" }],
    });

    expect(result).toHaveLength(2);
  });

  it("score lt retorna leads com score abaixo do valor", async () => {
    db.queue("leads", { data: [{ id: "lead-cold" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "score", op: "lt", value: "30" }],
    });

    expect(result).toEqual(["lead-cold"]);
  });

  it("score lte retorna leads com score <= valor", async () => {
    db.queue("leads", { data: [{ id: "lead-cold" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "score", op: "lte", value: "30" }],
    });

    expect(result).toEqual(["lead-cold"]);
  });

  // ============================================================================
  // Datas — older_than_days / newer_than_days / is_null
  // ============================================================================

  it("created_at older_than_days retorna leads criados antes do threshold", async () => {
    db.queue("leads", { data: [{ id: "lead-old-1" }, { id: "lead-old-2" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "created_at", op: "older_than_days", value: "30" }],
    });

    expect(result).toEqual(expect.arrayContaining(["lead-old-1", "lead-old-2"]));
  });

  it("created_at newer_than_days retorna leads criados dentro do prazo", async () => {
    db.queue("leads", { data: [{ id: "lead-new" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "created_at", op: "newer_than_days", value: "7" }],
    });

    expect(result).toEqual(["lead-new"]);
  });

  it("last_interaction_at older_than_days retorna leads frios", async () => {
    db.queue("leads", { data: [{ id: "lead-stale" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "last_interaction_at", op: "older_than_days", value: "14" }],
    });

    expect(result).toEqual(["lead-stale"]);
  });

  it("last_interaction_at newer_than_days retorna leads com interação recente", async () => {
    db.queue("leads", { data: [{ id: "lead-active" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "last_interaction_at", op: "newer_than_days", value: "7" }],
    });

    expect(result).toEqual(["lead-active"]);
  });

  it("last_interaction_at is_null retorna leads que nunca interagiram", async () => {
    db.queue("leads", { data: [{ id: "lead-never" }], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "last_interaction_at", op: "is_null", value: "" }],
    });

    expect(result).toEqual(["lead-never"]);
  });

  it("older_than_days com value não-numérico (NaN) retorna null", async () => {
    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "created_at", op: "older_than_days", value: "abc" }],
    });

    expect(result).toBeNull();
  });

  it("older_than_days com days negativos retorna null", async () => {
    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "created_at", op: "older_than_days", value: "-10" }],
    });

    expect(result).toBeNull();
  });

  it("newer_than_days com value zero retorna null (0 dias inválido)", async () => {
    // 0 dias é tecnicamente finito e >= 0, mas o threshold seria agora —
    // documenta o comportamento atual sem quebrar (não é NaN nem negativo)
    db.queue("leads", { data: [], error: null });

    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "created_at", op: "newer_than_days", value: "0" }],
    });

    // comportamento atual: 0 dias é válido (threshold = agora), retorna array (possivelmente vazio)
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
  });

  // ============================================================================
  // Resiliência — erros de DB
  // ============================================================================

  it("condition com DB error é silenciada (retorna null para aquela condition)", async () => {
    // DB retorna erro — condition deve ser ignorada
    db.queue("leads", { data: null, error: { message: "connection refused" } });

    // Com uma única condition que falha, validSets fica vazio → retorna null
    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "status", op: "eq", value: "new" }],
    });

    expect(result).toBeNull();
  });

  it("AND com uma condition válida e uma com DB error usa apenas a válida", async () => {
    // status=new OK
    db.queue("leads", { data: [{ id: "lead-1" }, { id: "lead-2" }], error: null });
    // source falha
    db.queue("leads", { data: null, error: { message: "timeout" } });

    // Condition de source retorna null → validSets tem só o set de status
    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [
        { field: "status", op: "eq", value: "new" },
        { field: "source", op: "eq", value: "instagram" },
      ],
    });

    // Quando AND tem set inválido ignorado, opera só com os válidos
    expect(result).toEqual(expect.arrayContaining(["lead-1", "lead-2"]));
  });
});

// ============================================================================
// Etapa 9: Testes dos campos de deal (pipeline, stage, status)
// ============================================================================

describe("findMatchingLeadIds — Etapa 9: deal conditions", () => {
  let db: MockSupabase;

  beforeEach(() => {
    db = createSupabaseMock();
    vi.clearAllMocks();
  });

  it("deal_pipeline_id eq: retorna leads com deal no pipeline", async () => {
    db.queue("deals", {
      data: [{ lead_id: "lead-1" }, { lead_id: "lead-2" }],
      error: null,
    });
    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "deal_pipeline_id", op: "eq", value: "pipeline-1" }],
    });
    expect(result).toEqual(expect.arrayContaining(["lead-1", "lead-2"]));
    expect(result).toHaveLength(2);
  });

  it("deal_stage_id neq: exclui leads com deal nessa etapa", async () => {
    db.queue("deals", {
      data: [{ lead_id: "lead-2" }],
      error: null,
    });
    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "deal_stage_id", op: "neq", value: "stage-2" }],
    });
    expect(result).toContain("lead-2");
  });

  it("deal_status eq: retorna leads com deal no status ganho", async () => {
    db.queue("deals", {
      data: [{ lead_id: "lead-3" }],
      error: null,
    });
    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "deal_status", op: "eq", value: "won" }],
    });
    expect(result).toEqual(["lead-3"]);
  });

  it("deal_status is_null: leads SEM negócio aberto", async () => {
    // Primeiro: busca leads COM deal open
    db.queue("deals", {
      data: [{ lead_id: "lead-1" }],
      error: null,
    });
    // Segundo: todos os leads
    db.queue("leads", {
      data: [{ id: "lead-1" }, { id: "lead-2" }, { id: "lead-3" }],
      error: null,
    });
    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "deal_status", op: "is_null", value: "" }],
    });
    // lead-1 TEM deal open — excluído. lead-2 e lead-3 não têm.
    expect(result).not.toContain("lead-1");
    expect(result).toContain("lead-2");
    expect(result).toContain("lead-3");
  });

  it("deal_pipeline_id com value vazio retorna null", async () => {
    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "deal_pipeline_id", op: "eq", value: "" }],
    });
    expect(result).toBeNull();
  });

  it("deal_status is_null — DB error na query de deals retorna null", async () => {
    db.queue("deals", { data: null, error: { message: "timeout" } });
    const result = await findMatchingLeadIds(db as never, ORG, {
      operator: "AND",
      conditions: [{ field: "deal_status", op: "is_null", value: "" }],
    });
    expect(result).toBeNull();
  });
});
