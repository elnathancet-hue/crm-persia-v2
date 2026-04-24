import {
  clampRagTopK,
  clampRecentMessagesCount,
  clampDebounceWindowMs,
  clampTokenThreshold,
  clampTurnThreshold,
  DEFAULT_GUARDRAILS,
  DEFAULT_MODEL,
  getPreset,
  isKnownModel,
  type AgentConfig,
  type AgentGuardrails,
  type AgentStage,
  type AgentStageTool,
  type AgentStatus,
  type AgentTool,
  type CreateAgentInput,
  type CreateStageInput,
  type ReorderStagesInput,
  type UpdateAgentInput,
  type UpdateStageInput,
} from "@persia/shared/ai-agent";
import { fromAny, type AgentDb } from "@/lib/ai-agent/db";
import { requireSuperadminForOrg } from "@/lib/auth";
import { auditFailure, auditLog } from "@/lib/audit";
import type { AdminClient } from "@/lib/supabase-admin";

export type AdminAgentActionContext = {
  admin: AdminClient;
  db: AgentDb;
  orgId: string;
  userId: string;
};

export async function requireAdminAgentOrg(orgId: string): Promise<AdminAgentActionContext> {
  const ctx = await requireSuperadminForOrg(orgId);
  return {
    ...ctx,
    db: ctx.admin,
  };
}

export async function auditAdminAgentAction(params: {
  userId: string;
  orgId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await auditLog({
    userId: params.userId,
    orgId: params.orgId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    metadata: {
      ...(params.metadata ?? {}),
      performed_by_superadmin_id: params.userId,
      acting_as_org_id: params.orgId,
    },
  });
}

export async function auditAdminAgentFailure(params: {
  userId: string;
  orgId: string;
  action: string;
  error: unknown;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await auditFailure({
    userId: params.userId,
    orgId: params.orgId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    metadata: {
      ...(params.metadata ?? {}),
      performed_by_superadmin_id: params.userId,
      acting_as_org_id: params.orgId,
    },
    error: params.error,
  });
}

export function normalizeAgentInput(input: CreateAgentInput): CreateAgentInput {
  const model = input.model || DEFAULT_MODEL;
  if (!isKnownModel(model)) {
    throw new Error("Modelo de IA não permitido");
  }

  const name = input.name?.trim();
  if (!name) throw new Error("Nome do agente é obrigatório");

  const systemPrompt = input.system_prompt?.trim();
  if (!systemPrompt) throw new Error("Prompt do agente é obrigatório");

  const handoff = normalizeHandoffConfig({
    enabled: input.handoff_notification_enabled,
    target_type: input.handoff_notification_target_type,
    target_address: input.handoff_notification_target_address,
    template: input.handoff_notification_template,
  });

  return {
    name,
    description: input.description?.trim() || undefined,
    scope_type: input.scope_type,
    scope_id: input.scope_id || undefined,
    model,
    system_prompt: systemPrompt,
    guardrails: input.guardrails,
    debounce_window_ms: clampDebounceWindowMs(input.debounce_window_ms),
    context_summary_turn_threshold: clampTurnThreshold(input.context_summary_turn_threshold),
    context_summary_token_threshold: clampTokenThreshold(input.context_summary_token_threshold),
    context_summary_recent_messages: clampRecentMessagesCount(input.context_summary_recent_messages),
    handoff_notification_enabled: handoff.enabled,
    handoff_notification_target_type: handoff.target_type,
    handoff_notification_target_address: handoff.target_address,
    handoff_notification_template: handoff.template,
  };
}

export function normalizeAgentPatch(
  input: UpdateAgentInput,
  current?: Pick<
    AgentConfig,
    | "handoff_notification_enabled"
    | "handoff_notification_target_type"
    | "handoff_notification_target_address"
    | "handoff_notification_template"
  >,
): UpdateAgentInput {
  const patch: UpdateAgentInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Nome do agente é obrigatório");
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.scope_type !== undefined) patch.scope_type = input.scope_type;
  if (input.scope_id !== undefined) patch.scope_id = input.scope_id || undefined;
  if (input.model !== undefined) {
    if (!isKnownModel(input.model)) throw new Error("Modelo de IA não permitido");
    patch.model = input.model;
  }
  if (input.system_prompt !== undefined) {
    const systemPrompt = input.system_prompt.trim();
    if (!systemPrompt) throw new Error("Prompt do agente é obrigatório");
    patch.system_prompt = systemPrompt;
  }
  if (input.guardrails !== undefined) patch.guardrails = input.guardrails;
  if (input.debounce_window_ms !== undefined) {
    patch.debounce_window_ms = clampDebounceWindowMs(input.debounce_window_ms);
  }
  if (input.context_summary_turn_threshold !== undefined) {
    patch.context_summary_turn_threshold = clampTurnThreshold(input.context_summary_turn_threshold);
  }
  if (input.context_summary_token_threshold !== undefined) {
    patch.context_summary_token_threshold = clampTokenThreshold(input.context_summary_token_threshold);
  }
  if (input.context_summary_recent_messages !== undefined) {
    patch.context_summary_recent_messages = clampRecentMessagesCount(input.context_summary_recent_messages);
  }

  const handoffPatch = normalizeHandoffPatch(input, current);
  if (handoffPatch.handoff_notification_enabled !== undefined) {
    patch.handoff_notification_enabled = handoffPatch.handoff_notification_enabled;
  }
  if (handoffPatch.handoff_notification_target_type !== undefined) {
    patch.handoff_notification_target_type = handoffPatch.handoff_notification_target_type;
  }
  if (handoffPatch.handoff_notification_target_address !== undefined) {
    patch.handoff_notification_target_address = handoffPatch.handoff_notification_target_address;
  }
  if (handoffPatch.handoff_notification_template !== undefined) {
    patch.handoff_notification_template = handoffPatch.handoff_notification_template;
  }

  if (input.status !== undefined) patch.status = input.status;
  return patch;
}

export function normalizeStageInput(input: CreateStageInput): CreateStageInput {
  const situation = input.situation?.trim();
  if (!situation) throw new Error("Situação da etapa é obrigatória");

  const instruction = input.instruction?.trim();
  if (!instruction) throw new Error("Instrução da etapa é obrigatória");

  return {
    situation,
    instruction,
    transition_hint: input.transition_hint?.trim() || undefined,
    rag_enabled: input.rag_enabled ?? false,
    rag_top_k: input.rag_top_k !== undefined ? clampRagTopK(input.rag_top_k) : undefined,
    order_index: input.order_index,
    slug: input.slug?.trim() || slugify(situation),
  };
}

export function normalizeStagePatch(input: UpdateStageInput): UpdateStageInput {
  const patch: UpdateStageInput = {};
  if (input.situation !== undefined) {
    const situation = input.situation.trim();
    if (!situation) throw new Error("Situação da etapa é obrigatória");
    patch.situation = situation;
  }
  if (input.instruction !== undefined) {
    const instruction = input.instruction.trim();
    if (!instruction) throw new Error("Instrução da etapa é obrigatória");
    patch.instruction = instruction;
  }
  if (input.transition_hint !== undefined) {
    patch.transition_hint = input.transition_hint.trim() || undefined;
  }
  if (input.rag_enabled !== undefined) patch.rag_enabled = input.rag_enabled;
  if (input.rag_top_k !== undefined) patch.rag_top_k = clampRagTopK(input.rag_top_k);
  if (input.order_index !== undefined) patch.order_index = input.order_index;
  if (input.slug !== undefined) patch.slug = input.slug.trim() || undefined;
  return patch;
}

export function mergeGuardrails(
  current: AgentGuardrails | null | undefined,
  patch: Partial<AgentGuardrails> | null | undefined,
): AgentGuardrails {
  return {
    ...DEFAULT_GUARDRAILS,
    ...(current ?? {}),
    ...(patch ?? {}),
  };
}

export function assertAgentStatus(status: AgentStatus | undefined): void {
  if (!status) return;
  if (!["draft", "active", "paused"].includes(status)) {
    throw new Error("Status de agente inválido");
  }
}

export async function assertConfigBelongsToOrg(
  db: AgentDb,
  orgId: string,
  configId: string,
): Promise<AgentConfig> {
  const { data, error } = await fromAny(db, "agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", configId)
    .maybeSingle();

  if (error || !data) throw new Error("Agente não encontrado");
  return data as AgentConfig;
}

export async function assertStageBelongsToOrg(
  db: AgentDb,
  orgId: string,
  stageId: string,
): Promise<AgentStage> {
  const { data, error } = await fromAny(db, "agent_stages")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", stageId)
    .maybeSingle();

  if (error || !data) throw new Error("Etapa não encontrada");
  return data as AgentStage;
}

export async function assertToolBelongsToOrg(
  db: AgentDb,
  orgId: string,
  toolId: string,
): Promise<AgentTool> {
  const { data, error } = await fromAny(db, "agent_tools")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", toolId)
    .maybeSingle();

  if (error || !data) throw new Error("Ferramenta não encontrada");
  return data as AgentTool;
}

export async function upsertStageToolRow(
  db: AgentDb,
  orgId: string,
  stageId: string,
  toolId: string,
  isEnabled: boolean,
): Promise<AgentStageTool> {
  const { data, error } = await fromAny(db, "agent_stage_tools")
    .upsert({
      organization_id: orgId,
      stage_id: stageId,
      tool_id: toolId,
      is_enabled: isEnabled,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao salvar permissão da ferramenta");
  return data as AgentStageTool;
}

export function validateReorder(input: ReorderStagesInput): ReorderStagesInput {
  if (!input.config_id) throw new Error("config_id é obrigatório");
  if (!Array.isArray(input.stage_ids) || input.stage_ids.length === 0) {
    throw new Error("stage_ids é obrigatório");
  }
  return input;
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "stage";
}

export function agentPaths(configId?: string): string[] {
  const paths = ["/automations/agents"];
  if (configId) paths.push(`/automations/agents/${configId}`);
  return paths;
}

export function getDefaultStopAgentToolSeed(params: {
  configId: string;
  organizationId: string;
}): Omit<AgentTool, "id" | "created_at" | "updated_at"> {
  const preset = getPreset("stop_agent");
  if (!preset) throw new Error("Preset stop_agent não encontrado");

  return {
    config_id: params.configId,
    organization_id: params.organizationId,
    name: preset.name,
    description: preset.description,
    input_schema: preset.input_schema,
    execution_mode: "native",
    native_handler: preset.handler,
    webhook_url: null,
    webhook_secret: null,
    is_enabled: true,
  };
}

function normalizeHandoffConfig(input: {
  enabled: unknown;
  target_type: unknown;
  target_address: unknown;
  template: unknown;
}): {
  enabled: boolean;
  target_type: "phone" | "group" | null;
  target_address: string | null;
  template: string | null;
} {
  const enabled = Boolean(input.enabled);
  const targetType = normalizeHandoffTargetType(input.target_type) ?? null;
  const rawAddress =
    typeof input.target_address === "string" ? input.target_address.trim() : "";
  const template = normalizeHandoffTemplate(input.template) ?? null;

  if (!enabled) {
    return {
      enabled: false,
      target_type: null,
      target_address: null,
      template,
    };
  }

  if (!targetType || !rawAddress) {
    throw new Error("Configure o destino da notificação antes de ativar");
  }

  return {
    enabled: true,
    target_type: targetType,
    target_address: normalizeHandoffTargetAddress(targetType, rawAddress),
    template,
  };
}

function normalizeHandoffPatch(
  input: UpdateAgentInput,
  current?: Pick<
    AgentConfig,
    | "handoff_notification_enabled"
    | "handoff_notification_target_type"
    | "handoff_notification_target_address"
    | "handoff_notification_template"
  >,
): Partial<UpdateAgentInput> {
  const hasRelevantField =
    input.handoff_notification_enabled !== undefined ||
    input.handoff_notification_target_type !== undefined ||
    input.handoff_notification_target_address !== undefined ||
    input.handoff_notification_template !== undefined;

  if (!hasRelevantField) return {};

  const effective = normalizeHandoffConfig({
    enabled:
      input.handoff_notification_enabled ??
      current?.handoff_notification_enabled ??
      false,
    target_type:
      input.handoff_notification_target_type !== undefined
        ? input.handoff_notification_target_type
        : current?.handoff_notification_target_type ?? null,
    target_address:
      input.handoff_notification_target_address !== undefined
        ? input.handoff_notification_target_address
        : current?.handoff_notification_target_address ?? null,
    template:
      input.handoff_notification_template !== undefined
        ? input.handoff_notification_template
        : current?.handoff_notification_template ?? null,
  });

  return {
    handoff_notification_enabled:
      current?.handoff_notification_enabled === effective.enabled ? undefined : effective.enabled,
    handoff_notification_target_type:
      current?.handoff_notification_target_type === effective.target_type
        ? undefined
        : effective.target_type,
    handoff_notification_target_address:
      current?.handoff_notification_target_address === effective.target_address
        ? undefined
        : effective.target_address,
    handoff_notification_template:
      (current?.handoff_notification_template ?? null) === (effective.template ?? null)
        ? undefined
        : effective.template,
  };
}

function normalizeHandoffTargetType(value: unknown): "phone" | "group" | null {
  return value === "phone" || value === "group" ? value : null;
}

function normalizeHandoffTargetAddress(
  targetType: "phone" | "group",
  rawAddress: string,
): string {
  if (targetType === "phone") {
    const digits = rawAddress.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      throw new Error("Telefone da notificação deve ter entre 10 e 15 dígitos");
    }
    return digits;
  }

  const normalized = rawAddress.trim();
  if (!normalized) throw new Error("Destino do grupo é obrigatório");
  if (normalized.length > 128) throw new Error("Destino do grupo é inválido");
  return normalized;
}

function normalizeHandoffTemplate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > 1500) {
    throw new Error("Template da notificação deve ter no máximo 1500 caracteres");
  }
  return normalized;
}
