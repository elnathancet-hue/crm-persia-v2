"use server";

import { WEBHOOK_SECRET_MIN_LENGTH, getPreset } from "@persia/shared/ai-agent";
import type {
  AgentTool,
  CreateCustomWebhookToolInput,
  CreateToolFromPresetInput,
  CreateToolInput,
  NativeHandlerName,
  UpdateToolInput,
} from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import {
  assertHostnameAllowed,
  getWebhookAllowlistDomains,
  parseAndValidateWebhookUrl,
  resolvePublicIps,
} from "@/lib/ai-agent/webhook-caller";
import { materializePresetTool } from "@/lib/ai-agent/tools/registry";
import {
  agentPaths,
  assertConfigBelongsToOrg,
  assertToolBelongsToOrg,
  requireAgentRole,
} from "./utils";

// PR-AGENT-INTEGRATION-2 (mai/2026): PR5/PR7/PR8 liberados ate aqui.
// stop_agent (PR1), add_tag/transfer_* (PR3), trigger_notification/
// schedule_event (PR7), send_audio (PR5), send_media/move_pipeline_stage/
// create_appointment/list-cancel-reschedule (PR8).
const ENABLED_PRESET_PRS = new Set(["PR1", "PR3", "PR5", "PR7", "PR8"]);

type ValidatedToolPayload =
  | {
      execution_mode: "native";
      name: string;
      description: string;
      input_schema: CreateToolInput["input_schema"];
      native_handler: NonNullable<CreateToolInput["native_handler"]>;
      webhook_url: null;
      webhook_secret: null;
      is_enabled: boolean;
    }
  | {
      execution_mode: "n8n_webhook";
      name: string;
      description: string;
      input_schema: CreateToolInput["input_schema"];
      native_handler: null;
      webhook_url: string;
      webhook_secret: string;
      is_enabled: boolean;
    };

export async function listToolsForAgent(configId: string): Promise<AgentTool[]> {
  const { db, orgId } = await requireAgentRole("agent");
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { data, error } = await db
    .from("agent_tools")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentTool[];
}

export async function createToolFromPreset(
  input: CreateToolFromPresetInput,
): Promise<AgentTool> {
  const { db, orgId } = await requireAgentRole("admin");
  await assertConfigBelongsToOrg(db, orgId, input.config_id);

  const preset = getPreset(input.handler);
  if (!preset) throw new Error("Preset de ferramenta nao encontrado");
  if (!ENABLED_PRESET_PRS.has(preset.shipped_in_pr)) {
    throw new Error(`Ferramenta disponivel apenas em ${preset.shipped_in_pr}`);
  }

  const { data: existing, error: existingError } = await db
    .from("agent_tools")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", input.config_id)
    .eq("native_handler", input.handler)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing) return existing as AgentTool;

  const { data, error } = await db
    .from("agent_tools")
    .insert(
      materializePresetTool({
        configId: input.config_id,
        organizationId: orgId,
        preset,
      }),
    )
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao criar ferramenta");
  for (const path of agentPaths(input.config_id)) revalidatePath(path);
  return data as AgentTool;
}

export async function createCustomTool(input: CreateToolInput): Promise<AgentTool> {
  const { db, orgId } = await requireAgentRole("admin");
  await assertConfigBelongsToOrg(db, orgId, input.config_id);

  const validated = await validateToolPayload(db, orgId, input);

  const { data, error } = await db
    .from("agent_tools")
    .insert({
      organization_id: orgId,
      config_id: input.config_id,
      ...validated,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao criar ferramenta");
  for (const path of agentPaths(input.config_id)) revalidatePath(path);
  return data as AgentTool;
}

export async function createCustomWebhookTool(
  input: CreateCustomWebhookToolInput,
): Promise<AgentTool> {
  return createCustomTool({
    ...input,
    execution_mode: "n8n_webhook",
  });
}

export async function updateTool(toolId: string, input: UpdateToolInput): Promise<AgentTool> {
  const { db, orgId } = await requireAgentRole("admin");
  const existing = await assertToolBelongsToOrg(db, orgId, toolId);

  const nextState: CreateToolInput = {
    config_id: existing.config_id,
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    input_schema: input.input_schema ?? existing.input_schema,
    execution_mode: input.execution_mode ?? existing.execution_mode,
    native_handler:
      input.native_handler !== undefined
        ? input.native_handler ?? undefined
        : existing.native_handler ?? undefined,
    webhook_url:
      input.webhook_url !== undefined
        ? input.webhook_url ?? undefined
        : existing.webhook_url ?? undefined,
    webhook_secret:
      input.webhook_secret !== undefined
        ? input.webhook_secret ?? undefined
        : existing.webhook_secret ?? undefined,
    is_enabled: input.is_enabled ?? existing.is_enabled,
  };
  const validated = await validateToolPayload(db, orgId, nextState);

  const updates: Record<string, unknown> = {
    ...validated,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from("agent_tools")
    .update(updates)
    .eq("organization_id", orgId)
    .eq("id", toolId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao atualizar ferramenta");
  for (const path of agentPaths(existing.config_id)) revalidatePath(path);
  return data as AgentTool;
}

// PR-AGENT-INTEGRATION-2 (mai/2026): toggle por handler nativo. Cria
// a tool se nao existe (via materializePresetTool, com is_enabled=true),
// ou atualiza is_enabled se ja existe. Idempotente: chamadas repetidas
// nao duplicam. Desligar so seta is_enabled=false — nao deleta pra
// preservar config (descricao, schema) caso cliente reative.
export async function setNativeToolEnabled(input: {
  config_id: string;
  handler: NativeHandlerName;
  enabled: boolean;
}): Promise<AgentTool> {
  const { db, orgId } = await requireAgentRole("admin");
  await assertConfigBelongsToOrg(db, orgId, input.config_id);

  const preset = getPreset(input.handler);
  if (!preset) throw new Error("Preset de ferramenta nao encontrado");
  if (!ENABLED_PRESET_PRS.has(preset.shipped_in_pr)) {
    throw new Error(`Ferramenta disponivel apenas em ${preset.shipped_in_pr}`);
  }

  const { data: existing, error: existingError } = await db
    .from("agent_tools")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", input.config_id)
    .eq("native_handler", input.handler)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  if (existing) {
    // Update existente — so muda is_enabled (preserva customizacoes).
    const { data, error } = await db
      .from("agent_tools")
      .update({
        is_enabled: input.enabled,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("id", (existing as AgentTool).id)
      .select("*")
      .single();

    if (error || !data) throw new Error(error?.message || "Erro ao atualizar");
    for (const path of agentPaths(input.config_id)) revalidatePath(path);
    return data as AgentTool;
  }

  // Cria nova com is_enabled vindo do toggle. Se cliente liga e depois
  // desliga, evita criar e ja deixar enabled=false (raro mas defensivo).
  const { data, error } = await db
    .from("agent_tools")
    .insert({
      ...materializePresetTool({
        configId: input.config_id,
        organizationId: orgId,
        preset,
      }),
      is_enabled: input.enabled,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao criar");
  for (const path of agentPaths(input.config_id)) revalidatePath(path);
  return data as AgentTool;
}

export async function deleteTool(toolId: string): Promise<void> {
  const { db, orgId } = await requireAgentRole("admin");
  const existing = await assertToolBelongsToOrg(db, orgId, toolId);

  const { error } = await db
    .from("agent_tools")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", toolId);

  if (error) throw new Error(error.message);
  for (const path of agentPaths(existing.config_id)) revalidatePath(path);
}

// PR-FLOW-PIVOT (mai/2026): setStageTool + listStageTools removidos.
// Allowlist de tools migra pra agent_flows.enabled_tools (global por flow).
// Adapters do ai-agent-ui não chamam mais esses métodos.

async function validateToolPayload(
  db: Awaited<ReturnType<typeof requireAgentRole>>["db"],
  orgId: string,
  input: CreateToolInput,
): Promise<ValidatedToolPayload> {
  const name = input.name.trim();
  if (!name) throw new Error("Nome da ferramenta e obrigatorio");

  const description = input.description.trim();
  if (!description) throw new Error("Descricao da ferramenta e obrigatoria");

  if (input.execution_mode === "native") {
    if (!input.native_handler) {
      throw new Error("native_handler e obrigatorio para tools nativos");
    }

    return {
      execution_mode: "native",
      name,
      description,
      input_schema: input.input_schema,
      native_handler: input.native_handler,
      webhook_url: null,
      webhook_secret: null,
      is_enabled: input.is_enabled ?? true,
    };
  }

  const webhookUrl = input.webhook_url?.trim() ?? "";
  const webhookSecret = input.webhook_secret?.trim() ?? "";
  if (webhookSecret.length < WEBHOOK_SECRET_MIN_LENGTH) {
    throw new Error(`webhook_secret precisa ter ao menos ${WEBHOOK_SECRET_MIN_LENGTH} caracteres`);
  }

  const parsedUrl = parseAndValidateWebhookUrl(webhookUrl);
  const allowlist = await loadWebhookAllowlist(db, orgId);
  assertHostnameAllowed(parsedUrl.hostname, allowlist);
  await resolvePublicIps(parsedUrl.hostname);

  return {
    execution_mode: "n8n_webhook",
    name,
    description,
    input_schema: input.input_schema,
    native_handler: null,
    webhook_url: parsedUrl.toString(),
    webhook_secret: webhookSecret,
    is_enabled: input.is_enabled ?? true,
  };
}

async function loadWebhookAllowlist(
  db: Awaited<ReturnType<typeof requireAgentRole>>["db"],
  orgId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return getWebhookAllowlistDomains(data?.settings);
}
