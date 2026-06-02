// Etapa 3 — Testes do validador compartilhado de SegmentRules.
// Garante que o validador bloqueia regras inválidas client+server
// sem quebrar segmentos existentes ou válidos.

import { describe, expect, it } from "vitest";
import {
  validateSegmentRules,
  validateCondition,
  isCompleteCondition,
} from "@persia/shared/crm";
import type { SegmentRules } from "@persia/shared/crm";

describe("validateSegmentRules", () => {
  // ============================================================================
  // Casos inválidos — devem retornar valid: false
  // ============================================================================

  it("rejeita null", () => {
    const r = validateSegmentRules(null);
    expect(r.valid).toBe(false);
  });

  it("rejeita undefined", () => {
    const r = validateSegmentRules(undefined);
    expect(r.valid).toBe(false);
  });

  it("rejeita conditions vazio", () => {
    const r = validateSegmentRules({ operator: "AND", conditions: [] });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]).toMatch(/regra/i);
  });

  it("rejeita condition sem field", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ op: "eq", value: "new" }],
    });
    expect(r.valid).toBe(false);
  });

  it("rejeita field não permitido", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "pipeline_id", op: "eq", value: "p1" }],
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]).toMatch(/suportado/i);
  });

  it("rejeita op inválido para o campo", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "tags", op: "eq", value: "tag-1" }], // eq não existe em tags
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]).toMatch(/inv[áa]lido/i);
  });

  it("rejeita valor vazio quando op exige valor", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "status", op: "eq", value: "" }],
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]).toMatch(/valor/i);
  });

  it("rejeita score fora do range 0-100", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "score", op: "gt", value: "150" }],
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]).toMatch(/score/i);
  });

  it("rejeita score não-numérico", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "score", op: "gt", value: "abc" }],
    });
    expect(r.valid).toBe(false);
  });

  it("rejeita older_than_days com days < 1", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "created_at", op: "older_than_days", value: "0" }],
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors[0]).toMatch(/dias/i);
  });

  it("rejeita older_than_days com value NaN", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "created_at", op: "older_than_days", value: "nada" }],
    });
    expect(r.valid).toBe(false);
  });

  // ============================================================================
  // Casos válidos — devem retornar valid: true
  // ============================================================================

  it("aceita regra simples de status", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "status", op: "eq", value: "new" }],
    });
    expect(r.valid).toBe(true);
  });

  it("aceita regra de tags contains", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "tags", op: "contains", value: "tag-uuid-1" }],
    });
    expect(r.valid).toBe(true);
  });

  it("aceita tags not_contains", () => {
    const r = validateSegmentRules({
      operator: "OR",
      conditions: [{ field: "tags", op: "not_contains", value: "tag-uuid-2" }],
    });
    expect(r.valid).toBe(true);
  });

  it("aceita assigned_to is_null (sem valor)", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "assigned_to", op: "is_null", value: "" }],
    });
    expect(r.valid).toBe(true);
  });

  it("aceita last_interaction_at is_null", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "last_interaction_at", op: "is_null", value: "" }],
    });
    expect(r.valid).toBe(true);
  });

  it("aceita older_than_days com days >= 1", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "created_at", op: "older_than_days", value: "30" }],
    });
    expect(r.valid).toBe(true);
  });

  it("aceita score dentro do range", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "score", op: "gt", value: "70" }],
    });
    expect(r.valid).toBe(true);
  });

  it("aceita score = 0", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "score", op: "gte", value: "0" }],
    });
    expect(r.valid).toBe(true);
  });

  it("aceita múltiplas conditions válidas (AND)", () => {
    const rules: SegmentRules = {
      operator: "AND",
      conditions: [
        { field: "status", op: "eq", value: "new" },
        { field: "source", op: "eq", value: "instagram" },
        { field: "assigned_to", op: "is_null", value: "" },
      ],
    };
    const r = validateSegmentRules(rules);
    expect(r.valid).toBe(true);
  });

  it("aceita múltiplas conditions válidas (OR)", () => {
    const r = validateSegmentRules({
      operator: "OR",
      conditions: [
        { field: "tags", op: "contains", value: "tag-vip" },
        { field: "score", op: "gt", value: "80" },
      ],
    });
    expect(r.valid).toBe(true);
  });

  // ============================================================================
  // Comportamento com regras antigas (backward compat)
  // ============================================================================

  it("retorna erros quando regra antiga tem field desconhecido", () => {
    // Segmento antigo com field não suportado não deve quebrar — apenas inválido.
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [{ field: "custom_field_xyz", op: "eq", value: "foo" }],
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toHaveLength(1);
  });

  it("acumula erros de múltiplas conditions inválidas", () => {
    const r = validateSegmentRules({
      operator: "AND",
      conditions: [
        { field: "status", op: "eq", value: "" }, // valor vazio
        { field: "score", op: "gt", value: "999" }, // fora do range
      ],
    });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toHaveLength(2);
  });
});

// ============================================================================
// validateCondition
// ============================================================================

describe("validateCondition", () => {
  it("retorna [] para condition válida", () => {
    const errs = validateCondition({ field: "status", op: "eq", value: "new" });
    expect(errs).toHaveLength(0);
  });

  it("retorna erro para field ausente", () => {
    const errs = validateCondition({ op: "eq", value: "x" });
    expect(errs.length).toBeGreaterThan(0);
  });

  it("retorna erro para op ausente", () => {
    const errs = validateCondition({ field: "status", value: "new" });
    expect(errs.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// isCompleteCondition
// ============================================================================

describe("isCompleteCondition", () => {
  it("true para condition completa", () => {
    expect(isCompleteCondition({ field: "status", op: "eq", value: "new" })).toBe(true);
  });

  it("false para condition sem valor", () => {
    expect(isCompleteCondition({ field: "status", op: "eq", value: "" })).toBe(false);
  });

  it("true para is_null sem valor", () => {
    expect(isCompleteCondition({ field: "assigned_to", op: "is_null", value: "" })).toBe(true);
  });
});
