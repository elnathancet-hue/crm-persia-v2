import {
  clampRagTopK,
  clampRecentMessagesCount,
  clampDebounceWindowMs,
  clampTokenThreshold,
  clampTurnThreshold,
  DEFAULT_GUARDRAILS,
  DEFAULT_MODEL,
  type AgentStageTool,
  isKnownModel,
  type AgentConfig,
  type AgentGuardrails,
  type AgentStage,
  type AgentTool,
  type AgentStatus,
  type CreateAgentInput,
  type CreateStageInput,
  type ReorderStagesInput,
  type UpdateAgentInput,
  type UpdateStageInput,
} from "@persia/shared/ai-agent";
import type { OrgRole } from "@/lib/auth";
import { requireRole } from "@/lib/auth";
import { asAgentDb, type AgentDb } from "@/lib/ai-agent/db";
import {
  normalizeHandoffTargetAddress,
  normalizeHandoffTargetType,
  normalizeHandoffTemplate,
} from "@/lib/ai-agent/handoff-notification";

export type AgentActionContext = Awaited<ReturnType<typeof requireRole>> & {
  db: AgentDb;
};

export async function requireAgentRole(minRole: OrgRole): Promise<AgentActionContext> {
  const ctx = await requireRole(minRole);
  return {
    ...ctx,
    db: asAgentDb(ctx.supabase as never),
  };
}

export function normalizeAgentInput(input: CreateAgentInput): CreateAgentInput {
  const model = input.model || DEFAULT_MODEL;
  if (!isKnownModel(model)) {
    throw new Error("Modelo de IA nao permitido");
  }

  const name = input.name?.trim();
  if (!name) throw new Error("Nome do agente e obrigatorio");

  const systemPrompt = input.system_prompt?.trim();
  if (!systemPrompt) throw new Error("Prompt do agente e obrigatorio");

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
    calendar_connection_id: input.calendar_connection_id ?? null,
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
    if (!name) throw new Error("Nome do agente e obrigatorio");
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.scope_type !== undefined) patch.scope_type = input.scope_type;
  if (input.scope_id !== undefined) patch.scope_id = input.scope_id || undefined;
  if (input.model !== undefined) {
    if (!isKnownModel(input.model)) throw new Error("Modelo de IA nao permitido");
    patch.model = input.model;
  }
  if (input.system_prompt !== undefined) {
    const systemPrompt = input.system_prompt.trim();
    if (!systemPrompt) throw new Error("Prompt do agente e obrigatorio");
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
  if (input.calendar_connection_id !== undefined) {
    patch.calendar_connection_id = input.calendar_connection_id;
  }
  if (input.status !== undefined) patch.status = input.status;
  return patch;
}

export function normalizeStageInput(input: CreateStageInput): CreateStageInput {
  const situation = input.situation?.trim();
  if (!situation) throw new Error("Situacao da etapa e obrigatoria");

  const instruction = input.instruction?.trim();
  if (!instruction) throw new Error("Instrucao da etapa e obrigatoria");

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
    if (!situation) throw new Error("Situacao da etapa e obrigatoria");
    patch.situation = situation;
  }
  if (input.instruction !== undefined) {
    const instruction = input.instruction.trim();
    if (!instruction) throw new Error("Instrucao da etapa e obrigatoria");
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
    throw new Error("Status de agente invalido");
  }
}

export async function assertConfigBelongsToOrg(
  db: AgentDb,
  orgId: string,
  configId: string,
): Promise<AgentConfig> {
  const { data, error } = await db
    .from("agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", configId)
    .maybeSingle();
  if (error || !data) throw new Error("Agente nao encontrado");
  return data as AgentConfig;
}

export async function assertStageBelongsToOrg(
  db: AgentDb,
  orgId: string,
  stageId: string,
): Promise<AgentStage> {
  const { data, error } = await db
    .from("agent_stages")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", stageId)
    .maybeSingle();
  if (error || !data) throw new Error("Etapa nao encontrada");
  return data as AgentStage;
}

export async function assertToolBelongsToOrg(
  db: AgentDb,
  orgId: string,
  toolId: string,
): Promise<AgentTool> {
  const { data, error } = await db
    .from("agent_tools")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", toolId)
    .maybeSingle();
  if (error || !data) throw new Error("Ferramenta nao encontrada");
  return data as AgentTool;
}

export async function upsertStageToolRow(
  db: AgentDb,
  orgId: string,
  stageId: string,
  toolId: string,
  isEnabled: boolean,
): Promise<AgentStageTool> {
  const { data, error } = await db
    .from("agent_stage_tools")
    .upsert({
      organization_id: orgId,
      stage_id: stageId,
      tool_id: toolId,
      is_enabled: isEnabled,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao salvar permissao da ferramenta");
  return data as AgentStageTool;
}

export function validateReorder(input: ReorderStagesInput): ReorderStagesInput {
  if (!input.config_id) throw new Error("config_id e obrigatorio");
  if (!Array.isArray(input.stage_ids) || input.stage_ids.length === 0) {
    throw new Error("stage_ids e obrigatorio");
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
    throw new Error("Configure o destino da notificacao antes de ativar");
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
