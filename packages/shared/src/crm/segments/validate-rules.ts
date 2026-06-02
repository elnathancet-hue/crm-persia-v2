// validate-rules.ts — validador compartilhado de SegmentRules.
//
// Etapa 3 do roadmap de segmentação. Usado tanto no client (feedback
// imediato no ConditionBuilder) quanto no server action (defesa em
// profundidade — nunca confia apenas no client).
//
// Contrato:
//   - validateSegmentRules(rules) → { valid: true } | { valid: false; errors: string[] }
//   - isCompleteCondition(cond) → boolean  (útil pra highlight visual)
//
// Invariantes garantidas:
//   - Campos permitidos: ALLOWED_FIELDS (allowlist contra injection).
//   - Operadores válidos por campo: ALLOWED_OPS.
//   - Valor obrigatório quando operador não é is_null.
//   - Número válido pra score e pra days (older/newer_than_days).
//   - Regras antigas inválidas abrem em modo "precisa revisar" sem quebrar.

import type { SegmentRules, SegmentCondition } from "../types";

// Espelha DIRECT_FIELDS + DATE_FIELDS + DEAL_FIELDS + tags do match-leads.ts.
const ALLOWED_FIELDS = new Set([
  "status",
  "source",
  "channel",
  "score",
  "tags",
  "assigned_to",
  "created_at",
  "last_interaction_at",
  // Etapa 9: campos via tabela deals.
  "deal_pipeline_id",
  "deal_stage_id",
  "deal_status",
]);

const ALLOWED_OPS: Record<string, Set<string>> = {
  status: new Set(["eq", "neq"]),
  source: new Set(["eq", "neq"]),
  channel: new Set(["eq"]),
  score: new Set(["gt", "gte", "lt", "lte"]),
  tags: new Set(["contains", "not_contains"]),
  assigned_to: new Set(["eq", "neq", "is_null"]),
  created_at: new Set(["older_than_days", "newer_than_days"]),
  last_interaction_at: new Set(["older_than_days", "newer_than_days", "is_null"]),
  // Etapa 9: campos de deal.
  deal_pipeline_id: new Set(["eq", "neq"]),
  deal_stage_id: new Set(["eq", "neq"]),
  deal_status: new Set(["eq", "neq", "is_null"]),
};

// Operadores que NÃO exigem valor (sem input de valor na UI).
const OPS_WITHOUT_VALUE = new Set(["is_null"]);

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

/**
 * Valida o shape completo de um SegmentRules.
 * Retorna { valid: true } se tudo OK, ou { valid: false; errors } com
 * mensagens legíveis pra exibir na UI ou logar no server.
 */
export function validateSegmentRules(
  rules: SegmentRules | null | undefined,
): ValidationResult {
  if (!rules) {
    return { valid: false, errors: ["Regras ausentes"] };
  }

  if (!Array.isArray(rules.conditions) || rules.conditions.length === 0) {
    return { valid: false, errors: ["Adicione pelo menos uma regra"] };
  }

  const errors: string[] = [];
  let index = 0;

  for (const cond of rules.conditions) {
    index++;
    const prefix = `Regra ${index}`;
    const condErrors = validateCondition(cond, prefix);
    errors.push(...condErrors);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

/**
 * Valida uma condition individual. Retorna mensagens de erro (vazio = OK).
 * Útil pra highlight visual de linha incompleta no builder.
 */
export function validateCondition(
  cond: SegmentCondition,
  prefix = "Regra",
): string[] {
  const errors: string[] = [];

  const field = typeof cond.field === "string" ? cond.field : null;
  const op = typeof cond.op === "string" ? cond.op : null;
  const value =
    typeof cond.value === "string"
      ? cond.value
      : cond.value == null
        ? ""
        : String(cond.value);

  if (!field) {
    errors.push(`${prefix}: campo obrigatório`);
    return errors; // sem field, não tem mais o que validar
  }

  if (!ALLOWED_FIELDS.has(field)) {
    errors.push(`${prefix}: campo "${field}" não é suportado`);
    return errors;
  }

  if (!op) {
    errors.push(`${prefix}: operador obrigatório`);
    return errors;
  }

  const allowedOps = ALLOWED_OPS[field];
  if (!allowedOps || !allowedOps.has(op)) {
    errors.push(`${prefix}: operador "${op}" inválido para o campo "${field}"`);
    return errors;
  }

  // Operadores sem valor (is_null) — value deve ser vazio ou ausente.
  if (OPS_WITHOUT_VALUE.has(op)) {
    return errors; // sem mais validações
  }

  // Valor obrigatório a partir daqui.
  if (!value.trim()) {
    errors.push(`${prefix}: valor é obrigatório`);
    return errors;
  }

  // Validações numéricas.
  if (field === "score") {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      errors.push(`${prefix}: score deve ser um número`);
    } else if (num < 0 || num > 100) {
      errors.push(`${prefix}: score deve estar entre 0 e 100`);
    }
  }

  if (op === "older_than_days" || op === "newer_than_days") {
    const days = Number(value);
    if (!Number.isFinite(days) || days < 1) {
      errors.push(`${prefix}: número de dias deve ser >= 1`);
    }
  }

  return errors;
}

/**
 * Verifica se uma condition tem todos os campos mínimos preenchidos.
 * Útil pra highlight visual "incompleto" no builder sem bloquear input.
 */
export function isCompleteCondition(cond: SegmentCondition): boolean {
  return validateCondition(cond).length === 0;
}
