"use server";

import {
  AFTER_HOURS_MESSAGE_DEFAULT,
  AFTER_HOURS_MESSAGE_MAX_LENGTH,
  DEFAULT_GUARDRAILS,
  PAUSE_KEYWORDS_DEFAULT,
  RESUME_KEYWORDS_DEFAULT,
  clampAutoPauseMinutes,
  clampSplitDelaySeconds,
  clampSplitThresholdChars,
  getAgentTemplate,
  isAgentTemplateSlug,
  normalizeHumanizationConfig,
  sanitizeBusinessHours,
  sanitizeKeywordList,
  type AgentConfig,
  type AgentTemplate,
  type CreateAgentInput,
  type UpdateAgentInput,
} from "@persia/shared/ai-agent";
import type { AgentDb } from "@/lib/ai-agent/db";
import { revalidatePath } from "next/cache";
import { slugify } from "./utils";
import {
  getDefaultStopAgentTool,
  materializePresetTool,
} from "@/lib/ai-agent/tools/registry";
import { getPreset } from "@persia/shared/ai-agent";
import {
  assertAgentStatus,
  assertConfigBelongsToOrg,
  agentPaths,
  mergeGuardrails,
  normalizeAgentInput,
  normalizeAgentPatch,
  requireAgentRole,
} from "./utils";

export async function listAgents(): Promise<AgentConfig[]> {
  const { db, orgId } = await requireAgentRole("agent");
  const { data, error } = await db
    .from("agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentConfig[];
}

export async function getAgent(configId: string): Promise<AgentConfig | null> {
  const { db, orgId } = await requireAgentRole("agent");
  const { data, error } = await db
    .from("agent_configs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", configId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AgentConfig | null) ?? null;
}

export async function createAgent(input: CreateAgentInput): Promise<AgentConfig> {
  const { db, orgId } = await requireAgentRole("admin");
  const normalized = normalizeAgentInput(input);
  const guardrails = mergeGuardrails(DEFAULT_GUARDRAILS, normalized.guardrails);
  const newLeadStageId = await resolveNewLeadStageId(
    db,
    orgId,
    normalized.new_lead_stage_id,
  );
  const shouldBePrimary = await shouldCreateAsPrimary(db, orgId);

  const { data, error } = await db
    .from("agent_configs")
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
      // PR-FLOW-PIVOT (mai/2026): único valor aceito pelo CHECK
      // constraint da migration 054 é 'flow'. Fallback explícito
      // pra default seguro caso normalizeAgentInput regredisse.
      behavior_mode: normalized.behavior_mode ?? "flow",
      status: "draft",
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao criar agente");
  const config = data as AgentConfig;

  const defaultTool = getDefaultStopAgentTool({
    configId: config.id,
    organizationId: orgId,
  });
  const { error: toolError } = await db.from("agent_tools").insert(defaultTool);
  if (toolError) throw new Error(toolError.message);

  // Onboarding: se cliente escolheu um template (nao-blank), materializa
  // as stages pre-definidas. Falha aqui NAO desfaz o agente — o cliente
  // pode adicionar stages manualmente depois.
  if (input.template_slug && isAgentTemplateSlug(input.template_slug)) {
    const template = getAgentTemplate(input.template_slug);
    await applyTemplate(db, orgId, config, template);
  }

  for (const path of agentPaths()) revalidatePath(path);
  return config;
}

export async function updateAgent(
  configId: string,
  input: UpdateAgentInput,
): Promise<AgentConfig> {
  const { db, orgId } = await requireAgentRole("admin");
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
  if (patch.new_lead_stage_id !== undefined) {
    updates.new_lead_stage_id = await resolveNewLeadStageId(
      db,
      orgId,
      patch.new_lead_stage_id,
    );
  }
  if (patch.humanization_config !== undefined) {
    // PR-AI-AGENT-HUMAN-A: merge shallow com config existente normalizado.
    // Cliente pode mandar so pause_keywords (parcial) e mantemos
    // resume_keywords + auto_pause_minutes do servidor.
    const current = normalizeHumanizationConfig(
      (existing as AgentConfig & { humanization_config?: unknown })
        .humanization_config,
    );
    updates.humanization_config = {
      ...current,
      ...patch.humanization_config,
      // Re-normaliza pra garantir clamp + sanitize mesmo no merge.
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
      // PR B: split_* campos. Boolean cai num cast direto; numericos
      // passam pelo clamp pra rejeitar valores fora do range.
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
      // PR C: business_hours_* + after_hours_message. business_hours_timezone
      // nao e editavel pela UI cliente (hardcoded America/Sao_Paulo no
      // normalize), mas merge preserva caso admin tenha customizado.
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
      // PR-AGENT-INTEGRATION-1: handoff include summary
      handoff_include_summary:
        typeof patch.humanization_config.handoff_include_summary === "boolean"
          ? patch.humanization_config.handoff_include_summary
          : current.handoff_include_summary,
    };
  }
  if (patch.status !== undefined) updates.status = patch.status;

  const { data, error } = await db
    .from("agent_configs")
    .update(updates)
    .eq("organization_id", orgId)
    .eq("id", configId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao atualizar agente");
  for (const path of agentPaths(configId)) revalidatePath(path);
  return data as AgentConfig;
}

async function shouldCreateAsPrimary(db: AgentDb, orgId: string): Promise<boolean> {
  const { data, error } = await db
    .from("agent_configs")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !data;
}

async function resolveNewLeadStageId(
  db: AgentDb,
  orgId: string,
  stageId: string | null | undefined,
): Promise<string | null> {
  if (!stageId) return null;
  const { data, error } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", stageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Etapa inicial do CRM nao encontrada");
  return stageId;
}

// PR-AGENT-INTEGRATION-3 (mai/2026): seta um agente como principal da
// org. Idempotente: se ja era primary, no-op. Atomico via unique partial
// index — se concorrencia tentar setar 2 primary ao mesmo tempo, um dos
// inserts falha e cliente retenta. Estrategia:
//   1. UPDATE WHERE is_primary=true SET is_primary=false (zera o atual)
//   2. UPDATE WHERE id=target SET is_primary=true (escala o novo)
// Faz em transacao implicita via 2 calls. RLS garante org isolation.
export async function setPrimaryAgent(configId: string): Promise<AgentConfig> {
  const { db, orgId } = await requireAgentRole("admin");
  await assertConfigBelongsToOrg(db, orgId, configId);

  // Step 1: zera primary atual da org (se houver).
  const { error: clearError } = await db
    .from("agent_configs")
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("is_primary", true)
    .neq("id", configId);

  if (clearError) throw new Error(clearError.message);

  // Step 2: marca o alvo como primary.
  const { data, error } = await db
    .from("agent_configs")
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", configId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao definir principal");
  for (const path of agentPaths(configId)) revalidatePath(path);
  return data as AgentConfig;
}

export async function deleteAgent(configId: string): Promise<void> {
  const { db, orgId } = await requireAgentRole("admin");
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { error } = await db
    .from("agent_configs")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", configId);

  if (error) throw new Error(error.message);
  for (const path of agentPaths()) revalidatePath(path);
}

// ============================================================================
// applyTemplate — PR-AI-AGENT-TEMPLATE-FULL-STACK (mai/2026)
// ----------------------------------------------------------------------------
// Materializa um template novo (v2 com seed_tags / appointment_types /
// notification_templates / humanization / stages v2 com action_type +
// auto_actions). Templates antigos (so com stages basicas) continuam
// funcionando — campos novos sao todos opcionais.
//
// Estrategia "best-effort": falha em qualquer parte loga + segue. O
// agente foi criado; cliente pode editar/recriar recursos faltantes
// manualmente. Melhor que rollback total.
// ============================================================================
async function applyTemplate(
  db: AgentDb,
  orgId: string,
  config: AgentConfig,
  template: AgentTemplate,
): Promise<void> {
  // 1. Atualiza humanization_config se o template define. behavior_mode
  // é fixo 'flow' pós-PR-FLOW-PIVOT (mai/2026).
  const configPatch: Record<string, unknown> = {};
  if (template.humanization_config) {
    configPatch.humanization_config = normalizeHumanizationConfig(
      template.humanization_config,
    );
  }
  if (Object.keys(configPatch).length > 0) {
    const { error } = await db
      .from("agent_configs")
      .update(configPatch)
      .eq("id", config.id)
      .eq("organization_id", orgId);
    if (error) {
      console.error("[applyTemplate] failed to patch config:", error.message);
    }
  }

  // 2. Seed de tags na org (idempotente — unique constraint em (org_id, name)).
  // Tag existente mantem cor original (NAO sobrescreve).
  //
  // PR-AI-AGENT-TEMPLATE-SCHEMA-FIX (mai/2026): tabela tags (migration
  // 001) so tem id/organization_id/name/color/created_at — NAO tem
  // description. Removido daqui pra evitar 'column not found'.
  if (template.seed_tags && template.seed_tags.length > 0) {
    for (const tag of template.seed_tags) {
      const { data: existing } = await db
        .from("tags")
        .select("id")
        .eq("organization_id", orgId)
        .eq("name", tag.name)
        .maybeSingle();
      if (existing) continue;
      const { error } = await db.from("tags").insert({
        organization_id: orgId,
        name: tag.name,
        color: tag.color ?? "#6366f1",
      });
      if (error) {
        console.error(`[applyTemplate] seed tag "${tag.name}" failed:`, error.message);
      }
    }
  }

  // 3. Seed de tipos de agendamento (agenda_services) — idempotente por slug.
  if (template.seed_appointment_types && template.seed_appointment_types.length > 0) {
    for (const t of template.seed_appointment_types) {
      const slug = slugify(t.name);
      const { data: existing } = await db
        .from("agenda_services")
        .select("id")
        .eq("organization_id", orgId)
        .eq("slug", slug)
        .maybeSingle();
      if (existing) continue;
      const { error } = await db.from("agenda_services").insert({
        organization_id: orgId,
        slug,
        name: t.name,
        description: t.description ?? null,
        duration_minutes: t.duration_minutes,
        default_channel: t.default_channel ?? null,
        default_location: t.default_location ?? null,
        default_meeting_url: t.default_meeting_url ?? null,
      });
      if (error) {
        console.error(
          `[applyTemplate] seed appointment_type "${t.name}" failed:`,
          error.message,
        );
      }
    }
  }

  // 4. Seed de templates de notificacao (escopados ao config recem-criado).
  //
  // PR-AI-AGENT-TEMPLATE-SCHEMA-FIX (mai/2026): schema real da tabela
  // (migration 023):
  //   - body_template (NAO body)
  //   - description NOT NULL com CHECK char_length BETWEEN 10 AND 500
  //   - target_address NOT NULL com CHECK BETWEEN 5 AND 80
  //   - name CHECK BETWEEN 3 AND 60
  //
  // target_address: como o cliente ainda nao configurou destinatario,
  // usa placeholder "0000000000" (10 chars, dentro do range). Cliente
  // troca pelo numero real via UI antes de testar.
  const PLACEHOLDER_TARGET = "0000000000";
  if (
    template.seed_notification_templates &&
    template.seed_notification_templates.length > 0
  ) {
    const rows = template.seed_notification_templates.map((t) => {
      // description CHECK 10-500. Garante minimo 10 chars com fallback.
      const description = t.description?.trim() || `Notificacao do template ${t.name}`;
      return {
        organization_id: orgId,
        config_id: config.id,
        name: t.name,
        description: description.length < 10
          ? `${description} (configure pra completar)`
          : description,
        target_type: "phone",
        target_address: t.target_address?.trim() || PLACEHOLDER_TARGET,
        body_template: t.body,
        status: "active",
      };
    });
    const { error } = await db.from("agent_notification_templates").insert(rows);
    if (error) {
      console.error("[applyTemplate] seed notification_templates failed:", error.message);
    }
  }

  // 5. PR-FLOW-PIVOT (mai/2026): seed do agent_flows. Se o template
  // define `flow_config` explícito, usa direto. Senão, cria flow mínimo
  // com 1 node de entrada + 1 node IA usando o system_prompt do template.
  // Tools nativas (todas exceto transfer_to_stage que não existe mais)
  // ficam disponíveis na enabled_tools — UI canvas refina depois.
  // PR-FLOW-PIVOT PR 7 (mai/2026): seed da tool emit_event. Permite a
  // IA avançar pelos handles nomeados das instructions[] do node IA.
  // Sem isso, LLM não tem a tool exposta no API call → handles ficam
  // desconectados.
  const emitEventPreset = getPreset("emit_event");
  let emitEventToolId: string | null = null;
  if (emitEventPreset) {
    const emitEventTool = materializePresetTool({
      configId: config.id,
      organizationId: orgId,
      preset: emitEventPreset,
    });
    const { data: insertedEmit, error: emitErr } = await db
      .from("agent_tools")
      .insert(emitEventTool)
      .select("id")
      .maybeSingle();
    if (emitErr) {
      console.error(
        "[applyTemplate] failed to seed emit_event tool:",
        emitErr.message,
      );
    } else {
      emitEventToolId = (insertedEmit as { id?: string } | null)?.id ?? null;
    }
  }

  // Keep default AI node prompt empty: template.system_prompt is already
  // stored in agent_configs.system_prompt. Duplicating it here makes later
  // Configuracoes edits look ignored because the Flow node keeps a stale copy.
  const flowConfig = template.flow_config ?? {
    nodes: [
      {
        id: "entry-1",
        type: "entry",
        position: { x: 0, y: 0 },
        data: {
          label: "Conversa iniciada",
          trigger: "conversation_started",
        },
      },
      {
        id: "ai-1",
        type: "ai_agent",
        position: { x: 280, y: 0 },
        data: {
          label: template.label,
          system_prompt: "",
          instructions: [],
        },
      },
    ],
    edges: [
      {
        id: "edge-entry-ai",
        source: "entry-1",
        target: "ai-1",
        sourceHandle: "default",
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    enabled_tools: emitEventToolId ? [emitEventToolId] : [],
  };

  const { error: flowError } = await db.from("agent_flows").insert({
    agent_config_id: config.id,
    organization_id: orgId,
    nodes: flowConfig.nodes,
    edges: flowConfig.edges,
    viewport: flowConfig.viewport,
    enabled_tools: flowConfig.enabled_tools,
    version: 1,
  });
  if (flowError) {
    console.error("[applyTemplate] failed to seed agent_flows:", flowError.message);
  }
}

