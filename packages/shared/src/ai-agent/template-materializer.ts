// AI Agent — template materializer (shared CRM/Admin).
//
// Backlog #5 Auditoria (mai/2026): extraido de apps/crm/src/actions/ai-agent/configs.ts
// pra resolver paridade Admin/CRM (rodada 2 #1, #2, #3).
//
// Antes, applyTemplate vivia so no CRM — admin creating agentes nao
// chamava nada disso, resultava em agente sem agent_flows + sem tools
// seed + sem tags/appointment_types/notification_templates.
//
// Agora ambos os apps importam a mesma logica. O `db` e generico
// (DbClient minimal interface) — tanto AgentDb do CRM quanto o
// supabase wrapped do Admin via fromAny conformam.
//
// Side-effecty (faz INSERT/UPDATE em multiplas tabelas) — diferente
// do padrao usual de shared/, mas justificado porque a logica
// semantica e identica entre apps. Manter so em CRM forcaria
// duplicacao no Admin.

import type {
  AgentConfig,
  AgentTool,
  NativeHandlerName,
} from "./types";
import type { AgentTemplate } from "./agent-templates";
import { getPreset, type NativeToolPreset } from "./tool-presets";
import { normalizeHumanizationConfig } from "./humanization";

// ============================================================================
// Tool preset materializers (puros — extraidos de CRM tools/registry.ts)
// ============================================================================

export function materializePresetTool(params: {
  configId: string;
  organizationId: string;
  preset: NativeToolPreset;
}): Omit<AgentTool, "id" | "created_at" | "updated_at"> {
  return {
    config_id: params.configId,
    organization_id: params.organizationId,
    name: params.preset.name,
    description: params.preset.description,
    input_schema: params.preset.input_schema,
    execution_mode: "native",
    native_handler: params.preset.handler,
    webhook_url: null,
    webhook_secret: null,
    is_enabled: true,
  };
}

export function getDefaultStopAgentTool(params: {
  configId: string;
  organizationId: string;
}): Omit<AgentTool, "id" | "created_at" | "updated_at"> {
  const preset = getPreset("stop_agent");
  if (!preset) {
    throw new Error("Missing native tool preset for stop_agent");
  }
  return materializePresetTool({ ...params, preset });
}

// ============================================================================
// Generic DB shape — basta ter .from(table) com chains tipicos do Supabase
// ============================================================================

/**
 * Cliente de DB minimal aceito pelo materializer. Ambos `AgentDb` do CRM
 * (typed) e o resultado de `fromAny(db, table)` do Admin conformam.
 * Tipagem permissiva intencional — implementacoes sao testadas no nivel
 * da chamada original (CRM/Admin).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = { from: (table: string) => any };

function slugifyForMaterializer(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ============================================================================
// applyAgentTemplate — orquestra seed de tags, appointment_types,
// notification_templates, tools nativas, emit_event e agent_flows.
// ============================================================================

/**
 * Materializa um template em recursos da org. Estrategia "best-effort":
 * falha em qualquer parte loga + segue. O agente foi criado; cliente
 * pode editar/recriar recursos faltantes manualmente. Melhor que
 * rollback total.
 */
export async function applyAgentTemplate(params: {
  db: DbClient;
  orgId: string;
  config: AgentConfig;
  template: AgentTemplate;
}): Promise<void> {
  const { db, orgId, config, template } = params;

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
      console.error("[applyAgentTemplate] failed to patch config:", error.message);
    }
  }

  // 2. Seed de tags (idempotente — unique constraint em (org_id, name)).
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
        console.error(
          `[applyAgentTemplate] seed tag "${tag.name}" failed:`,
          error.message,
        );
      }
    }
  }

  // 3. Seed de tipos de agendamento (idempotente por slug).
  if (template.seed_appointment_types && template.seed_appointment_types.length > 0) {
    for (const t of template.seed_appointment_types) {
      const slug = slugifyForMaterializer(t.name);
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
          `[applyAgentTemplate] seed appointment_type "${t.name}" failed:`,
          error.message,
        );
      }
    }
  }

  // 4. Seed de templates de notificacao (escopados ao config recem-criado).
  const PLACEHOLDER_TARGET = "0000000000";
  if (
    template.seed_notification_templates &&
    template.seed_notification_templates.length > 0
  ) {
    const rows = template.seed_notification_templates.map((t: { name: string; description?: string | null; target_address?: string | null; body: string }) => {
      const description = t.description?.trim() || `Notificacao do template ${t.name}`;
      return {
        organization_id: orgId,
        config_id: config.id,
        name: t.name,
        description:
          description.length < 10
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
      console.error(
        "[applyAgentTemplate] seed notification_templates failed:",
        error.message,
      );
    }
  }

  // 5. Seed da tool emit_event + criacao do agent_flows.
  const emitEventPreset = getPreset("emit_event" as NativeHandlerName);
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
        "[applyAgentTemplate] failed to seed emit_event tool:",
        emitErr.message,
      );
    } else {
      emitEventToolId = (insertedEmit as { id?: string } | null)?.id ?? null;
    }
  }

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

  // PR-6 Auditoria (mai/2026): garante emit_event no enabled_tools quando
  // template tem AI node com instructions[] (handles nomeados).
  const aiNodesWithInstructions = (flowConfig.nodes ?? []).some(
    (node: { type: string; data?: { instructions?: Array<unknown> } | unknown }) => {
      if (node.type !== "ai_agent") return false;
      const data = node.data as { instructions?: Array<unknown> } | undefined;
      return (data?.instructions?.length ?? 0) > 0;
    },
  );
  const enabledTools = [...(flowConfig.enabled_tools ?? [])];
  if (
    aiNodesWithInstructions &&
    emitEventToolId &&
    !enabledTools.includes(emitEventToolId)
  ) {
    enabledTools.push(emitEventToolId);
  }

  const { error: flowError } = await db.from("agent_flows").insert({
    agent_config_id: config.id,
    organization_id: orgId,
    nodes: flowConfig.nodes,
    edges: flowConfig.edges,
    viewport: flowConfig.viewport,
    enabled_tools: enabledTools,
    version: 1,
  });
  if (flowError) {
    console.error(
      "[applyAgentTemplate] failed to seed agent_flows:",
      flowError.message,
    );
  }
}
