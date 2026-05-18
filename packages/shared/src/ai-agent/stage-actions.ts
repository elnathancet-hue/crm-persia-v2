// AI Agent — auto-actions disparadas ao entrar na etapa.
//
// PR-AI-AGENT-STAGE-ACTION-CONFIG (mai/2026) — base estrutural da
// Opcao C do plano A+C. Migration 049 adiciona:
//   - agent_stages.action_config JSONB
//   - agent_conversations.actions_executed JSONB
//
// Este modulo define o discriminated union das acoes + helpers de
// validacao/normalizacao. Runtime (PR 4) le destes tipos pra disparar
// handlers nativos quando a conversa entra numa etapa.
//
// Por que JSONB e nao colunas tipadas:
// - Acao tem shape variavel por tipo (add_tag != send_media)
// - Lista variavel (0..N por etapa)
// - Coexistencia com etapas que NAO usam (campo default '{}')
//
// Padrao de discriminated union igual a outras estruturas JSONB
// (humanization_config, entry_conditions): runtime SEMPRE normaliza
// via normalizeStageActionConfig antes de usar.

// ============================================================================
// Discriminated union — cada acao tem um `type` que define o resto
// ============================================================================

export interface StageActionAddTag {
  type: "add_tag";
  /** Nome EXATO de uma tag existente da org. */
  tag_name: string;
}

export interface StageActionMovePipelineStage {
  type: "move_pipeline_stage";
  /** Nome EXATO da etapa do funil do lead. */
  stage_name: string;
  /** Justificativa logada no historico do lead. */
  reason?: string;
}

export interface StageActionSendMedia {
  type: "send_media";
  /** Slug do automation_tools (Biblioteca de midia). */
  slug: string;
  /** Legenda opcional (max 500 chars). */
  caption?: string;
}

export interface StageActionTriggerNotification {
  type: "trigger_notification";
  /** Nome EXATO do template configurado pro agente. */
  template_name: string;
  /** Variaveis customizadas {{custom.*}}. */
  custom?: Record<string, string>;
}

export interface StageActionTransferToUser {
  type: "transfer_to_user";
  /** Nome OU email do membro da equipe. */
  user: string;
  reason?: string;
}

export interface StageActionTransferToAgent {
  type: "transfer_to_agent";
  /** Nome EXATO do agente alvo (mesmo padrao do PR 1). */
  target_agent_name: string;
  reason?: string;
}

export interface StageActionStopAgent {
  type: "stop_agent";
  reason?: string;
}

/** Discriminated union: extender adicionando tipo + helper de validacao. */
export type StageAutoAction =
  | StageActionAddTag
  | StageActionMovePipelineStage
  | StageActionSendMedia
  | StageActionTriggerNotification
  | StageActionTransferToUser
  | StageActionTransferToAgent
  | StageActionStopAgent;

export type StageAutoActionType = StageAutoAction["type"];

/** Tipos suportados — usado por UI pra mostrar dropdown de acoes. */
export const STAGE_AUTO_ACTION_TYPES: ReadonlyArray<StageAutoActionType> = [
  "add_tag",
  "move_pipeline_stage",
  "send_media",
  "trigger_notification",
  "transfer_to_user",
  "transfer_to_agent",
  "stop_agent",
] as const;

// ============================================================================
// Shape do JSONB inteiro
// ============================================================================

export interface StageActionConfig {
  /**
   * Acoes que disparam AUTOMATICAMENTE quando a conversa entra nesta
   * etapa pela primeira vez. Ordem importa — handlers executam em
   * sequencia.
   *
   * Idempotencia: agent_conversations.actions_executed[] guarda o
   * stage_id apos primeiro disparo; runtime nao re-executa.
   */
  auto_actions: StageAutoAction[];
}

export const STAGE_ACTION_CONFIG_DEFAULT: StageActionConfig = {
  auto_actions: [],
};

// ============================================================================
// Normalize — defensive parsing do JSONB
// ============================================================================

const MAX_AUTO_ACTIONS_PER_STAGE = 10;
const MAX_REASON_LENGTH = 500;
const MAX_CAPTION_LENGTH = 500;
const MAX_TAG_NAME_LENGTH = 80;
const MAX_SLUG_LENGTH = 120;
const MAX_STAGE_NAME_LENGTH = 120;
const MAX_TEMPLATE_NAME_LENGTH = 120;
const MAX_USER_LENGTH = 200;
const MAX_AGENT_NAME_LENGTH = 200;
const MAX_CUSTOM_KEYS = 10;
const MAX_CUSTOM_KEY_LENGTH = 40;
const MAX_CUSTOM_VALUE_LENGTH = 200;

function isStringNonEmpty(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function trimToMax(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, max);
}

function sanitizeCustom(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (count >= MAX_CUSTOM_KEYS) break;
    if (typeof k !== "string" || k.length === 0 || k.length > MAX_CUSTOM_KEY_LENGTH) continue;
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CUSTOM_VALUE_LENGTH) continue;
    out[k] = trimmed;
    count++;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Sanitiza uma acao individual. Retorna null se invalida (tipo
 * desconhecido, campos obrigatorios faltando, etc). UI deve validar
 * antes de salvar — esta funcao e a defesa final pre-runtime.
 */
export function sanitizeStageAutoAction(raw: unknown): StageAutoAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const type = obj.type;

  switch (type) {
    case "add_tag": {
      if (!isStringNonEmpty(obj.tag_name, MAX_TAG_NAME_LENGTH)) return null;
      return { type: "add_tag", tag_name: obj.tag_name.trim() };
    }
    case "move_pipeline_stage": {
      if (!isStringNonEmpty(obj.stage_name, MAX_STAGE_NAME_LENGTH)) return null;
      const reason = trimToMax(obj.reason, MAX_REASON_LENGTH);
      return {
        type: "move_pipeline_stage",
        stage_name: obj.stage_name.trim(),
        ...(reason ? { reason } : {}),
      };
    }
    case "send_media": {
      if (!isStringNonEmpty(obj.slug, MAX_SLUG_LENGTH)) return null;
      const caption = trimToMax(obj.caption, MAX_CAPTION_LENGTH);
      return {
        type: "send_media",
        slug: obj.slug.trim(),
        ...(caption ? { caption } : {}),
      };
    }
    case "trigger_notification": {
      if (!isStringNonEmpty(obj.template_name, MAX_TEMPLATE_NAME_LENGTH)) return null;
      const custom = sanitizeCustom(obj.custom);
      return {
        type: "trigger_notification",
        template_name: obj.template_name.trim(),
        ...(custom ? { custom } : {}),
      };
    }
    case "transfer_to_user": {
      if (!isStringNonEmpty(obj.user, MAX_USER_LENGTH)) return null;
      const reason = trimToMax(obj.reason, MAX_REASON_LENGTH);
      return {
        type: "transfer_to_user",
        user: obj.user.trim(),
        ...(reason ? { reason } : {}),
      };
    }
    case "transfer_to_agent": {
      if (!isStringNonEmpty(obj.target_agent_name, MAX_AGENT_NAME_LENGTH)) return null;
      const reason = trimToMax(obj.reason, MAX_REASON_LENGTH);
      return {
        type: "transfer_to_agent",
        target_agent_name: obj.target_agent_name.trim(),
        ...(reason ? { reason } : {}),
      };
    }
    case "stop_agent": {
      const reason = trimToMax(obj.reason, MAX_REASON_LENGTH);
      return {
        type: "stop_agent",
        ...(reason ? { reason } : {}),
      };
    }
    default:
      return null;
  }
}

/**
 * Normaliza o JSONB inteiro lido do DB. Sempre retorna shape valido,
 * mesmo se o raw veio malformado ou ausente.
 *
 * - Acoes invalidas sao DESCARTADAS silenciosamente (defensive — runtime
 *   nao quebra por config corrompida; UI deveria ter rejeitado antes).
 * - Limita a 10 acoes por etapa (evita config absurda).
 * - Preserva ordem (importa pra ordem de execucao).
 */
export function normalizeStageActionConfig(raw: unknown): StageActionConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...STAGE_ACTION_CONFIG_DEFAULT, auto_actions: [] };
  }
  const obj = raw as Record<string, unknown>;
  const rawActions = Array.isArray(obj.auto_actions) ? obj.auto_actions : [];

  const sanitized: StageAutoAction[] = [];
  for (const item of rawActions) {
    if (sanitized.length >= MAX_AUTO_ACTIONS_PER_STAGE) break;
    const action = sanitizeStageAutoAction(item);
    if (action) sanitized.push(action);
  }

  return { auto_actions: sanitized };
}

// ============================================================================
// Idempotencia helpers — actions_executed
// ============================================================================

/** Le array de stage_ids do JSONB. Defensive contra valores corrompidos. */
export function normalizeActionsExecuted(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** True se as acoes da etapa ja dispararam pra esta conversa. */
export function hasActionsBeenExecuted(
  executed: ReadonlyArray<string>,
  stageId: string,
): boolean {
  return executed.includes(stageId);
}

/** Adiciona stage_id ao array (idempotente). Retorna novo array. */
export function markActionsExecuted(
  executed: ReadonlyArray<string>,
  stageId: string,
): string[] {
  if (executed.includes(stageId)) return [...executed];
  return [...executed, stageId];
}
