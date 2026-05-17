// AI Agent — entry conditions (PR 3/6 da serie "Costurar integracoes
// CRM/Agenda/Agente", mai/2026).
//
// Cada organizacao tem 1 agente principal (is_primary=true). Quando
// chega a primeira msg de um lead, o executor avalia as conditions de
// CADA agente secundario (is_primary=false). Primeiro match (OR logic,
// ordenado por priority desc) "rouba" a conversa pro secundario, que
// fica responsavel pela conversa daqui em diante (stickiness via
// agent_conversations.config_id).
//
// Se nenhum secundario bate, principal responde como fallback.

export const ENTRY_CONDITION_TYPES = [
  "tag_match",
  "segment_match",
  "message_contains",
  "pipeline_stage_match",
  "lead_status_match",
] as const;

export type EntryConditionType = (typeof ENTRY_CONDITION_TYPES)[number];

export interface EntryConditionTagMatch {
  tag_name: string;
}

export interface EntryConditionSegmentMatch {
  segment_id: string;
}

export interface EntryConditionMessageContains {
  keyword: string;
}

export interface EntryConditionPipelineStageMatch {
  stage_id: string;
}

export interface EntryConditionLeadStatusMatch {
  status: string;
}

// Discriminated union em runtime — cada row guarda { type, value } e a
// validacao acontece no parse (validateConditionValue abaixo).
export type EntryConditionValue =
  | EntryConditionTagMatch
  | EntryConditionSegmentMatch
  | EntryConditionMessageContains
  | EntryConditionPipelineStageMatch
  | EntryConditionLeadStatusMatch;

export interface AgentEntryCondition {
  id: string;
  organization_id: string;
  agent_config_id: string;
  condition_type: EntryConditionType;
  condition_value: EntryConditionValue;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface CreateEntryConditionInput {
  agent_config_id: string;
  condition_type: EntryConditionType;
  condition_value: EntryConditionValue;
  priority?: number;
}

export interface UpdateEntryConditionInput {
  condition_type?: EntryConditionType;
  condition_value?: EntryConditionValue;
  priority?: number;
}

// ============================================================================
// Lead state (snapshot pra avaliacao das conditions)
// ============================================================================

export interface LeadStateForRouting {
  /** Tags ativas do lead, normalizadas (lowercase + trim). */
  tags: string[];
  /** Segments ids onde o lead participa. */
  segment_ids: string[];
  /** Pipeline stage atual do lead (`leads.stage_id`), ou null. */
  pipeline_stage_id: string | null;
  /** `leads.status`, ou null. */
  status: string | null;
}

// ============================================================================
// Validation + evaluation
// ============================================================================

export function isValidConditionValue(
  type: EntryConditionType,
  value: unknown,
): value is EntryConditionValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  switch (type) {
    case "tag_match":
      return typeof v.tag_name === "string" && v.tag_name.trim().length > 0;
    case "segment_match":
      return typeof v.segment_id === "string" && v.segment_id.trim().length > 0;
    case "message_contains":
      return typeof v.keyword === "string" && v.keyword.trim().length > 0;
    case "pipeline_stage_match":
      return typeof v.stage_id === "string" && v.stage_id.trim().length > 0;
    case "lead_status_match":
      return typeof v.status === "string" && v.status.trim().length > 0;
  }
}

function matchesCondition(
  condition: Pick<AgentEntryCondition, "condition_type" | "condition_value">,
  leadState: LeadStateForRouting,
  messageText: string,
): boolean {
  const { condition_type, condition_value } = condition;
  if (!isValidConditionValue(condition_type, condition_value)) return false;

  switch (condition_type) {
    case "tag_match": {
      const target = (condition_value as EntryConditionTagMatch).tag_name
        .trim()
        .toLowerCase();
      return leadState.tags.includes(target);
    }
    case "segment_match": {
      const target = (condition_value as EntryConditionSegmentMatch).segment_id;
      return leadState.segment_ids.includes(target);
    }
    case "message_contains": {
      const keyword = (condition_value as EntryConditionMessageContains).keyword
        .trim()
        .toLowerCase();
      return messageText.toLowerCase().includes(keyword);
    }
    case "pipeline_stage_match": {
      const target = (condition_value as EntryConditionPipelineStageMatch)
        .stage_id;
      return leadState.pipeline_stage_id === target;
    }
    case "lead_status_match": {
      const target = (condition_value as EntryConditionLeadStatusMatch).status
        .trim()
        .toLowerCase();
      return (leadState.status ?? "").toLowerCase() === target;
    }
  }
}

/**
 * Avalia as conditions de um agente com OR logic — basta UMA bater.
 * Conditions invalidas sao ignoradas (defensive parse).
 */
export function evaluateEntryConditions(
  conditions: ReadonlyArray<
    Pick<AgentEntryCondition, "condition_type" | "condition_value">
  >,
  leadState: LeadStateForRouting,
  messageText: string,
): boolean {
  for (const condition of conditions) {
    if (matchesCondition(condition, leadState, messageText)) return true;
  }
  return false;
}

/**
 * Dado um conjunto de agentes secundarios + suas conditions, encontra
 * o primeiro que bate. Ordenacao: priority desc, created_at asc (ordem
 * estavel). Retorna null se nenhum match.
 *
 * Caller agrupa conditions por agent_config_id e passa pra ca.
 */
export function pickSecondaryAgent<
  TAgent extends { id: string },
>(
  candidates: ReadonlyArray<{
    agent: TAgent;
    conditions: ReadonlyArray<
      Pick<AgentEntryCondition, "condition_type" | "condition_value" | "priority" | "created_at">
    >;
  }>,
  leadState: LeadStateForRouting,
  messageText: string,
): TAgent | null {
  // Agrupa max priority por agente pra ordenar. Se um agente tem 3
  // conditions, usa a maior priority dele.
  const sorted = candidates
    .map((c) => {
      const maxPriority = c.conditions.reduce(
        (acc, cond) => Math.max(acc, cond.priority),
        Number.NEGATIVE_INFINITY,
      );
      const minCreatedAt = c.conditions.reduce(
        (acc, cond) =>
          acc && acc <= cond.created_at ? acc : cond.created_at,
        "",
      );
      return { ...c, maxPriority, minCreatedAt };
    })
    .filter((c) => c.conditions.length > 0)
    .sort((a, b) => {
      if (a.maxPriority !== b.maxPriority) {
        return b.maxPriority - a.maxPriority; // desc
      }
      return a.minCreatedAt.localeCompare(b.minCreatedAt); // asc
    });

  for (const candidate of sorted) {
    if (evaluateEntryConditions(candidate.conditions, leadState, messageText)) {
      return candidate.agent;
    }
  }
  return null;
}
