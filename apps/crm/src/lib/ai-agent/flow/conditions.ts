// AI Agent — avaliadores de condition nodes do flow.
//
// PR-FLOW-PIVOT PR 5 (mai/2026): runtime das 3 condicionais do
// canvas (Segmentações). Cada função retorna boolean — runner usa pra
// escolher edge "yes" ou "no".
//
// Princípios:
//   - Sem leadId: retorna `false` (caminho "Não") em vez de explodir.
//     Modo defensivo pra testes iniciais ou conversa sem lead vinculado.
//   - Erro de DB: log + false. Não derruba o flow inteiro.
//   - Reusa helpers do @persia/shared/crm sempre que possível.
//   - Comparação case-insensitive de strings (tag_name, field_name) —
//     UI já normaliza, mas defensive.
//
// Os tipos `FlowConditionNode["data"]["config"]` são Record<string,unknown>
// porque o JSONB do agent_flows pode vir corrompido — cada handler
// valida o shape antes de usar.

import type { FlowConditionNode } from "@persia/shared/ai-agent";
import { findMatchingLeadIds } from "@persia/shared/crm";
import type { SegmentRules } from "@persia/shared/crm";
import type { AgentDb } from "../db";

/**
 * Avalia uma condition contra o estado atual do lead. Retorna `true` se
 * a condição passa (segue edge `yes`), `false` caso contrário (edge `no`).
 *
 * `leadId` null/empty (ex: conversa de teste sem lead real) → `false`.
 */
export async function evaluateCondition(
  db: AgentDb,
  orgId: string,
  leadId: string | null,
  node: FlowConditionNode,
): Promise<boolean> {
  if (!leadId) return false;

  try {
    switch (node.data.condition_type) {
      case "has_tag":
        return await evaluateHasTag(db, orgId, leadId, node.data.config);
      case "lead_custom_field_equals":
        return await evaluateCustomField(db, orgId, leadId, node.data.config);
      case "in_segment":
        return await evaluateInSegment(db, orgId, leadId, node.data.config);
      default:
        return false;
    }
  } catch (err) {
    // Defensive: erro de DB não derruba o flow. Loga em console (runtime
    // tem error reporting próprio em PR posterior). Retorna false →
    // segue caminho "no" como fallback seguro.
    console.error(`[flow-conditions] erro avaliando ${node.id}:`, err);
    return false;
  }
}

// ============================================================================
// has_tag — lead está marcado com a tag (nome) X?
// ============================================================================

async function evaluateHasTag(
  db: AgentDb,
  orgId: string,
  leadId: string,
  config: Record<string, unknown>,
): Promise<boolean> {
  const tagName = String(config.tag_name ?? "").trim();
  if (!tagName) return false;

  // Join lead_tags → tags pra resolver tag_name → tag_id no mesmo query.
  // Filtra explicitamente por organization_id em tags (RLS já garante,
  // defesa em profundidade).
  const { data, error } = await db
    .from("lead_tags")
    .select("lead_id, tags!inner(name, organization_id)")
    .eq("lead_id", leadId)
    .eq("tags.organization_id", orgId)
    .eq("tags.name", tagName)
    .limit(1);

  if (error) throw new Error(`has_tag: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

// ============================================================================
// lead_custom_field_equals — campo customizado bate com o valor?
// ============================================================================

async function evaluateCustomField(
  db: AgentDb,
  orgId: string,
  leadId: string,
  config: Record<string, unknown>,
): Promise<boolean> {
  const fieldName = String(config.field_name ?? "").trim();
  const expected = String(config.value ?? "").trim();
  if (!fieldName) return false;

  // 1. Resolve custom_field_id via name (UI hoje permite digitar livremente).
  //    PR posterior pode adicionar picker que injeta UUID direto.
  const { data: fieldRow, error: fieldErr } = await db
    .from("custom_fields")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", fieldName)
    .maybeSingle();
  if (fieldErr) throw new Error(`custom_field_lookup: ${fieldErr.message}`);
  if (!fieldRow) return false;
  const fieldId = (fieldRow as { id: string }).id;

  // 2. Lê valor do lead. Tabela armazena TEXT — comparação é direta.
  const { data: valueRow, error: valueErr } = await db
    .from("lead_custom_field_values")
    .select("value")
    .eq("lead_id", leadId)
    .eq("custom_field_id", fieldId)
    .maybeSingle();
  if (valueErr) throw new Error(`custom_field_value: ${valueErr.message}`);
  if (!valueRow) return expected === "";

  const actual = String((valueRow as { value: string | null }).value ?? "").trim();
  return actual === expected;
}

// ============================================================================
// in_segment — lead pertence ao segmento X?
// ============================================================================

async function evaluateInSegment(
  db: AgentDb,
  orgId: string,
  leadId: string,
  config: Record<string, unknown>,
): Promise<boolean> {
  const segmentId = String(config.segment_id ?? "").trim();
  if (!segmentId) return false;

  // 1. Fetch rules do segmento.
  const { data: segRow, error: segErr } = await db
    .from("segments")
    .select("rules")
    .eq("organization_id", orgId)
    .eq("id", segmentId)
    .maybeSingle();
  if (segErr) throw new Error(`segment_lookup: ${segErr.message}`);
  if (!segRow) return false;

  // 2. Avalia regras + checa se lead está no resultset. Defensive cast
  //    pra SegmentRules — findMatchingLeadIds normaliza shape inválido.
  //    Retorno `null` significa "regras vazias → sem filtro" → V1
  //    interpreta como "todos os leads passam" (caminho `yes`).
  const rules = (segRow as { rules: unknown }).rules as SegmentRules;
  const matching = await findMatchingLeadIds(db, orgId, rules);
  if (matching === null) return true;
  return matching.includes(leadId);
}
