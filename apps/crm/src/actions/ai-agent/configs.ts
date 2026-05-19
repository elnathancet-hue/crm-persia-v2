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
  getPreset,
  isAgentTemplateSlug,
  normalizeHumanizationConfig,
  normalizeStageActionConfig,
  sanitizeBusinessHours,
  sanitizeKeywordList,
  type AgentConfig,
  type AgentTemplate,
  type CreateAgentInput,
  type NativeHandlerName,
  type UpdateAgentInput,
} from "@persia/shared/ai-agent";
import type { AgentDb } from "@/lib/ai-agent/db";
import { revalidatePath } from "next/cache";
import { slugify } from "./utils";
import {
  getDefaultStopAgentTool,
  materializePresetTool,
} from "@/lib/ai-agent/tools/registry";
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
      // PR-AGENT-INTEGRATION-4: behavior_mode. Default 'stages' (retrocompat
      // — quando wizard antigo nao passa nada). Wizard novo passa 'actions'.
      behavior_mode: normalized.behavior_mode ?? "stages",
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
  // 1. Atualiza humanization_config + behavior_mode se o template define.
  // (Esses campos nao foram passados no INSERT inicial porque o normalize
  // do input nao espera default vindo de template.)
  const configPatch: Record<string, unknown> = {};
  if (template.behavior_mode) {
    configPatch.behavior_mode = template.behavior_mode;
  }
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

  // 5. Stages — agora com action_type + action_config. Stages antigas
  // (sem esses campos) continuam funcionando: action_type fica null
  // e action_config '{}' (default da migration 049).
  if (template.stages.length > 0) {
    const stageRows = template.stages.map((stage, index) => ({
      organization_id: orgId,
      config_id: config.id,
      situation: stage.situation,
      instruction: stage.instruction,
      transition_hint: stage.transition_hint ?? null,
      rag_enabled: false,
      rag_top_k: 3,
      order_index: index,
      slug: slugify(stage.situation),
      // Novos campos opcionais (PR-AGENT-INTEGRATION-4 e PR3 do A+C)
      action_type: stage.action_type ?? null,
      action_config: stage.auto_actions
        ? normalizeStageActionConfig({ auto_actions: stage.auto_actions })
        : {},
    }));
    const { data: insertedStages, error: stagesError } = await db
      .from("agent_stages")
      .insert(stageRows)
      .select("id, slug");
    if (stagesError) {
      console.error("[applyTemplate] failed to seed stages:", stagesError.message);
      return;
    }

    // 6. PR-AI-AGENT-TEMPLATE-SEED-TOOLS (mai/2026): materializa tools
    // nativas necessarias e linka em agent_stage_tools (is_enabled=true)
    // em todas as stages. Sem isso, o LLM nao via as tools no API call
    // e nao chamava add_tag/create_appointment/etc — auto_actions
    // disparariam OK quando entrava em etapa, mas IA nao tinha capacidade
    // de chamar por iniciativa.
    //
    // Stop agent ja foi criado fora do applyTemplate (linha 99). Aqui
    // adicionamos as outras tools nativas que o Consultor template usa.
    const stageIds = ((insertedStages ?? []) as Array<{ id: string }>)
      .map((s) => s.id)
      .filter(Boolean);

    // Coleta tools referenciadas pelas auto_actions (runtime PRECISA
    // delas, mesmo se template.tool_handlers omitir). Set evita duplicar.
    const toolHandlers = new Set<NativeHandlerName>();
    for (const stage of template.stages) {
      for (const action of stage.auto_actions ?? []) {
        // O type da auto_action coincide com o native_handler equivalente.
        toolHandlers.add(action.type as NativeHandlerName);
        // PR2 (mai/2026): pra on_tool_success funcionar, a tool gatilho
        // tem que estar na allowlist da etapa (senao a IA nao consegue
        // chama-la). Garantimos isso aqui mesmo se a tool gatilho nao
        // aparece como action.type em nenhum outro stage.
        if (action.trigger === "on_tool_success" && action.on_tool_success_of) {
          toolHandlers.add(action.on_tool_success_of as NativeHandlerName);
        }
      }
    }

    if (template.tool_handlers && template.tool_handlers.length > 0) {
      // Refactor single-stage (mai/2026): template define allowlist
      // EXPLICITA. Pula a heuristica default (transfer_to_user, transfer_to_agent,
      // cancel/reschedule, transfer_to_stage) — usa exatamente o set
      // declarado + tools referenciadas por auto_actions ja coletadas acima.
      for (const handler of template.tool_handlers) {
        toolHandlers.add(handler);
      }
    } else {
      // Heuristica default (retrocompat com templates legados sem tool_handlers).
      if (template.seed_appointment_types && template.seed_appointment_types.length > 0) {
        toolHandlers.add("create_appointment");
        toolHandlers.add("list_lead_appointments");
        toolHandlers.add("cancel_appointment");
        toolHandlers.add("reschedule_appointment");
      }
      // transfer_to_user e sempre util pra escalation manual
      toolHandlers.add("transfer_to_user");
      // FIX BUG #8 (mai/2026): transfer_to_stage e VITAL pra funis com
      // mais de 1 etapa — sem essa tool a IA fica presa na etapa inicial
      // e faz qualificacao/apresentacao/agendamento todos inline.
      if (template.stages.length > 1) {
        toolHandlers.add("transfer_to_stage");
      }
      // transfer_to_agent pra orquestracao multi-agente (recepcao -> vendas).
      toolHandlers.add("transfer_to_agent");
    }
    // stop_agent ja foi criado fora do applyTemplate — pular pra nao duplicar
    toolHandlers.delete("stop_agent");

    const toolsToCreate = [...toolHandlers]
      .map((handler) => {
        const preset = getPreset(handler);
        if (!preset) return null;
        return materializePresetTool({
          configId: config.id,
          organizationId: orgId,
          preset,
        });
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    if (toolsToCreate.length > 0) {
      const { data: createdTools, error: toolsError } = await db
        .from("agent_tools")
        .insert(toolsToCreate)
        .select("id, native_handler");
      if (toolsError) {
        console.error("[applyTemplate] failed to seed tools:", toolsError.message);
      } else if (createdTools && stageIds.length > 0) {
        // 7. Linka todas as tools criadas em TODAS as stages com
        // is_enabled=true. Cliente pode restringir depois via UI
        // (StageSheet > Ferramentas).
        const allTools = createdTools as Array<{ id: string; native_handler: string }>;
        // Tambem inclui stop_agent (criado fora do applyTemplate)
        const { data: stopAgentRow } = await db
          .from("agent_tools")
          .select("id")
          .eq("config_id", config.id)
          .eq("native_handler", "stop_agent")
          .maybeSingle();
        const allToolIds = [
          ...allTools.map((t) => t.id),
          ...(stopAgentRow ? [(stopAgentRow as { id: string }).id] : []),
        ];

        const stageToolRows: Array<Record<string, unknown>> = [];
        for (const stageId of stageIds) {
          for (const toolId of allToolIds) {
            stageToolRows.push({
              stage_id: stageId,
              tool_id: toolId,
              organization_id: orgId,
              is_enabled: true,
            });
          }
        }
        if (stageToolRows.length > 0) {
          const { error: junctionError } = await db
            .from("agent_stage_tools")
            .insert(stageToolRows);
          if (junctionError) {
            console.error(
              "[applyTemplate] failed to seed agent_stage_tools:",
              junctionError.message,
            );
          }
        }
      }
    }
  }
}

