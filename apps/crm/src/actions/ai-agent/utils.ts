import {
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
  };
}

export function normalizeAgentPatch(input: UpdateAgentInput): UpdateAgentInput {
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
