"use server";

// Backlog #5 Auditoria (mai/2026): endereca rodada 2 #1 + #2 do
// POST_CODEX_AUDIT_AGENT_FLOW_353.md.
//
// Antes:
//   - createAgent do Admin nao chamava applyTemplate → agente nascia
//     sem agent_flows. Webhook chegava, executor disparava
//     flow_executor_no_flow, IA nunca respondia.
//   - updateAgent ignorava new_lead_stage_id e humanization_config —
//     UI compartilhada (@persia/ai-agent-ui) editava esses campos
//     achando que salvava, mas o server descartava silenciosamente.
//
// Agora: paridade plena com apps/crm/src/actions/ai-agent/configs.ts.
// Tools materializadas e applyAgentTemplate vivem em
// @persia/shared/ai-agent/template-materializer.ts pra evitar
// duplicacao entre CRM e Admin.

import {
  AFTER_HOURS_MESSAGE_DEFAULT,
  AFTER_HOURS_MESSAGE_MAX_LENGTH,
  DEFAULT_GUARDRAILS,
  PAUSE_KEYWORDS_DEFAULT,
  RESUME_KEYWORDS_DEFAULT,
  applyAgentTemplate,
  clampAutoPauseMinutes,
  clampSplitDelaySeconds,
  clampSplitThresholdChars,
  getAgentTemplate,
  getDefaultStopAgentTool,
  isAgentTemplateSlug,
  normalizeHumanizationConfig,
  sanitizeBusinessHours,
  sanitizeKeywordList,
  type AgentConfig,
  type CreateAgentInput,
  type UpdateAgentInput,
} from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import { fromAny } from "@/lib/ai-agent/db";
import {
  agentPaths,
  assertAgentStatus,
  assertConfigBelongsToOrg,
  auditAdminAgentAction,
  auditAdminAgentFailure,
  mergeGuardrails,
  normalizeAgentInput,
  normalizeAgentPatch,
  requireAdminAgentOrg,
} from "./utils";

export async function listAgents(orgId: string): Promise<AgentConfig[]> {
  const { db } = await requireAdminAgentOrg(orgId);
  const { data, error } = await fromAny(db, "agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentConfig[];
}

export async function getAgent(orgId: string, configId: string): Promise<AgentConfig | null> {
  const { db } = await requireAdminAgentOrg(orgId);
  const { data, error } = await fromAny(db, "agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", configId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentConfig | null) ?? null;
}

// Backlog #5 (mai/2026): helpers locais espelhando CRM (paridade rodada 2 #1).
async function shouldCreateAsPrimary(
  db: Awaited<ReturnType<typeof requireAdminAgentOrg>>["db"],
  orgId: string,
): Promise<boolean> {
  const { data, error } = await fromAny(db, "agent_configs")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !data;
}

async function resolveNewLeadStageId(
  db: Awaited<ReturnType<typeof requireAdminAgentOrg>>["db"],
  orgId: string,
  stageId: string | null | undefined,
): Promise<string | null> {
  if (!stageId) return null;
  const { data, error } = await fromAny(db, "pipeline_stages")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", stageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Etapa inicial do CRM nao encontrada");
  return stageId;
}

export async function createAgent(
  orgId: string,
  input: CreateAgentInput,
): Promise<AgentConfig> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const normalized = normalizeAgentInput(input);
    const guardrails = mergeGuardrails(DEFAULT_GUARDRAILS, normalized.guardrails);
    // Backlog #5 (mai/2026): paridade com CRM — resolve stage_id e
    // calcula is_primary do agente novo.
    const newLeadStageId = await resolveNewLeadStageId(
      db,
      orgId,
      normalized.new_lead_stage_id,
    );
    const shouldBePrimary = await shouldCreateAsPrimary(db, orgId);

    const { data, error } = await fromAny(db, "agent_configs")
      .insert({
        organization_id: orgId,
        name: normalized.name,
        description: normalized.description ?? null,
        scope_type: normalized.scope_type,
        scope_id: normalized.scope_id ?? null,
        model: normalized.model,
        system_prompt: normalized.system_prompt,
        guardrails,
        debounce_window_ms: normalized.debounce_window_ms,
        context_summary_turn_threshold: normalized.context_summary_turn_threshold,
        context_summary_token_threshold: normalized.context_summary_token_threshold,
        context_summary_recent_messages: normalized.context_summary_recent_messages,
        handoff_notification_enabled: normalized.handoff_notification_enabled ?? false,
        handoff_notification_target_type: normalized.handoff_notification_target_type ?? null,
        handoff_notification_target_address: normalized.handoff_notification_target_address ?? null,
        handoff_notification_template: normalized.handoff_notification_template ?? null,
        calendar_connection_id: normalized.calendar_connection_id ?? null,
        new_lead_stage_id: newLeadStageId,
        is_primary: shouldBePrimary,
        // PR-FLOW-PIVOT (mai/2026): unico valor aceito pelo CHECK constraint
        // da migration 054 e 'flow'.
        behavior_mode: normalized.behavior_mode ?? "flow",
        status: "draft",
      })
      .select("*")
      .single();

    if (error || !data) throw new Error(error?.message || "Erro ao criar agente");
    const config = data as AgentConfig;

    // Seed tool stop_agent (defualt sempre criado).
    const { error: toolError } = await fromAny(db, "agent_tools").insert(
      getDefaultStopAgentTool({ configId: config.id, organizationId: orgId }),
    );
    if (toolError) throw new Error(toolError.message);

    // Backlog #5 (mai/2026): aplica template (blank default) → materializa
    // agent_flows + tools nativas + seeds opcionais. Espelha CRM.
    const templateSlug =
      input.template_slug && isAgentTemplateSlug(input.template_slug)
        ? input.template_slug
        : "blank";
    const template = getAgentTemplate(templateSlug);
    await applyAgentTemplate({ db, orgId, config, template });

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_create",
      entityType: "agent_config",
      entityId: config.id,
      metadata: { name: config.name, template_slug: templateSlug, is_primary: shouldBePrimary },
    });

    for (const path of agentPaths()) revalidatePath(path);
    return config;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_create",
      entityType: "agent_config",
      metadata: { name: input.name },
      error,
    });
    throw error;
  }
}

export async function updateAgent(
  orgId: string,
  configId: string,
  input: UpdateAgentInput,
): Promise<AgentConfig> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertConfigBelongsToOrg(db, orgId, configId);
    const patch = normalizeAgentPatch(input, existing);
    assertAgentStatus(patch.status);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.description !== undefined) updates.description = patch.description || null;
    if (patch.scope_type !== undefined) updates.scope_type = patch.scope_type;
    if (patch.scope_id !== undefined) updates.scope_id = patch.scope_id ?? null;
    if (patch.model !== undefined) updates.model = patch.model;
    if (patch.system_prompt !== undefined) updates.system_prompt = patch.system_prompt;
    if (patch.guardrails !== undefined) {
      updates.guardrails = mergeGuardrails(existing.guardrails, patch.guardrails);
    }
    if (patch.debounce_window_ms !== undefined) {
      updates.debounce_window_ms = patch.debounce_window_ms;
    }
    if (patch.context_summary_turn_threshold !== undefined) {
      updates.context_summary_turn_threshold = patch.context_summary_turn_threshold;
    }
    if (patch.context_summary_token_threshold !== undefined) {
      updates.context_summary_token_threshold = patch.context_summary_token_threshold;
    }
    if (patch.context_summary_recent_messages !== undefined) {
      updates.context_summary_recent_messages = patch.context_summary_recent_messages;
    }
    if (patch.handoff_notification_enabled !== undefined) {
      updates.handoff_notification_enabled = patch.handoff_notification_enabled;
    }
    if (patch.handoff_notification_target_type !== undefined) {
      updates.handoff_notification_target_type = patch.handoff_notification_target_type;
    }
    if (patch.handoff_notification_target_address !== undefined) {
      updates.handoff_notification_target_address = patch.handoff_notification_target_address;
    }
    if (patch.handoff_notification_template !== undefined) {
      updates.handoff_notification_template = patch.handoff_notification_template;
    }
    if (patch.calendar_connection_id !== undefined) {
      updates.calendar_connection_id = patch.calendar_connection_id;
    }
    // Backlog #5 (mai/2026): new_lead_stage_id + humanization_config patches
    // estavam ausentes — UI compartilhada editava sem salvar (rodada 2 #2).
    if (patch.new_lead_stage_id !== undefined) {
      updates.new_lead_stage_id = await resolveNewLeadStageId(
        db,
        orgId,
        patch.new_lead_stage_id,
      );
    }
    if (patch.humanization_config !== undefined) {
      // Merge shallow com config existente normalizado — cliente pode mandar
      // so pause_keywords (parcial) e mantemos resto do servidor.
      const current = normalizeHumanizationConfig(
        (existing as AgentConfig & { humanization_config?: unknown })
          .humanization_config,
      );
      updates.humanization_config = {
        ...current,
        ...patch.humanization_config,
        pause_keywords: sanitizeKeywordList(
          patch.humanization_config.pause_keywords ?? current.pause_keywords,
          PAUSE_KEYWORDS_DEFAULT,
        ),
        resume_keywords: sanitizeKeywordList(
          patch.humanization_config.resume_keywords ?? current.resume_keywords,
          RESUME_KEYWORDS_DEFAULT,
        ),
        auto_pause_minutes: clampAutoPauseMinutes(
          patch.humanization_config.auto_pause_minutes ?? current.auto_pause_minutes,
        ),
        split_enabled:
          typeof patch.humanization_config.split_enabled === "boolean"
            ? patch.humanization_config.split_enabled
            : current.split_enabled,
        split_threshold_chars: clampSplitThresholdChars(
          patch.humanization_config.split_threshold_chars ??
            current.split_threshold_chars,
        ),
        split_delay_seconds: clampSplitDelaySeconds(
          patch.humanization_config.split_delay_seconds ??
            current.split_delay_seconds,
        ),
        business_hours_enabled:
          typeof patch.humanization_config.business_hours_enabled === "boolean"
            ? patch.humanization_config.business_hours_enabled
            : current.business_hours_enabled,
        business_hours: sanitizeBusinessHours(
          patch.humanization_config.business_hours ?? current.business_hours,
        ),
        after_hours_message: (() => {
          const raw =
            patch.humanization_config.after_hours_message ??
            current.after_hours_message;
          if (typeof raw !== "string" || raw.trim().length === 0) {
            return AFTER_HOURS_MESSAGE_DEFAULT;
          }
          return raw.trim().slice(0, AFTER_HOURS_MESSAGE_MAX_LENGTH);
        })(),
        handoff_include_summary:
          typeof patch.humanization_config.handoff_include_summary === "boolean"
            ? patch.humanization_config.handoff_include_summary
            : current.handoff_include_summary,
      };
    }
    if (patch.status !== undefined) updates.status = patch.status;
    if (patch.message_templates !== undefined) updates.message_templates = patch.message_templates;
    if (patch.validation_config !== undefined) updates.validation_config = patch.validation_config;
    if (patch.structured_sources !== undefined) updates.structured_sources = patch.structured_sources;

    const { data, error } = await fromAny(db, "agent_configs")
      .update(updates)
      .eq("organization_id", orgId)
      .eq("id", configId)
      .select("*")
      .single();

    if (error || !data) throw new Error(error?.message || "Erro ao atualizar agente");

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_update",
      entityType: "agent_config",
      entityId: configId,
      metadata: { fields: Object.keys(updates) },
    });

    for (const path of agentPaths(configId)) revalidatePath(path);
    return data as AgentConfig;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_update",
      entityType: "agent_config",
      entityId: configId,
      metadata: { fields: Object.keys(input) },
      error,
    });
    throw error;
  }
}

// PR-AGENT-INTEGRATION-3 (mai/2026): paridade com CRM. Zera primary
// atual da org + marca alvo. Atomico via unique partial index.
export async function setPrimaryAgent(
  orgId: string,
  configId: string,
): Promise<AgentConfig> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    await assertConfigBelongsToOrg(db, orgId, configId);

    const { error: clearError } = await fromAny(db, "agent_configs")
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("is_primary", true)
      .neq("id", configId);
    if (clearError) throw new Error(clearError.message);

    const { data, error } = await fromAny(db, "agent_configs")
      .update({ is_primary: true, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("id", configId)
      .select("*")
      .single();

    if (error || !data) throw new Error(error?.message || "Erro");

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_set_primary",
      entityType: "agent_config",
      entityId: configId,
    });

    for (const path of agentPaths(configId)) revalidatePath(path);
    return data as AgentConfig;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_set_primary",
      entityType: "agent_config",
      entityId: configId,
      error,
    });
    throw error;
  }
}

export async function deleteAgent(orgId: string, configId: string): Promise<void> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    await assertConfigBelongsToOrg(db, orgId, configId);

    const { error } = await fromAny(db, "agent_configs")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", configId);

    if (error) throw new Error(error.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_delete",
      entityType: "agent_config",
      entityId: configId,
    });

    for (const path of agentPaths()) revalidatePath(path);
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_delete",
      entityType: "agent_config",
      entityId: configId,
      error,
    });
    throw error;
  }
}
