"use server";

import { revalidatePath } from "next/cache";
import {
  buildNotificationToolName,
  getPreset,
  NOTIFICATION_PHONE_MAX_DIGITS,
  NOTIFICATION_PHONE_MIN_DIGITS,
  NOTIFICATION_TEMPLATE_BODY_MAX_LENGTH,
  NOTIFICATION_TEMPLATE_DESCRIPTION_MAX_CHARS,
  NOTIFICATION_TEMPLATE_DESCRIPTION_MIN_CHARS,
  NOTIFICATION_TEMPLATE_NAME_MAX_CHARS,
  NOTIFICATION_TEMPLATE_NAME_MIN_CHARS,
  NOTIFICATION_TEMPLATES_MAX_PER_AGENT,
  type AgentNotificationTemplate,
  type CreateNotificationTemplateInput,
  type NotificationTargetType,
  type UpdateNotificationTemplateInput,
} from "@persia/shared/ai-agent";
import type { AgentDb } from "@/lib/ai-agent/db";
import {
  agentPaths,
  assertConfigBelongsToOrg,
  requireAgentRole,
} from "./utils";

// Cada template registra um tool implicito sob o handler trigger_notification.
// Vamos manter agent_tools sincronizado em todas as 3 mutations (create,
// update, delete).
const TOOL_PRESET = getPreset("trigger_notification");

if (!TOOL_PRESET) {
  // Carrega no boot — garante que mudancas no preset sejam pegas em
  // typecheck/runtime sem trabalho adicional.
  throw new Error("Preset trigger_notification ausente");
}

// ============================================================================
// Listing
// ============================================================================

export async function listNotificationTemplates(
  configId: string,
): Promise<AgentNotificationTemplate[]> {
  const { db, orgId } = await requireAgentRole("agent");
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { data, error } = await db
    .from("agent_notification_templates")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentNotificationTemplate[];
}

// ============================================================================
// Create
// ============================================================================

export async function createNotificationTemplate(
  input: CreateNotificationTemplateInput,
): Promise<AgentNotificationTemplate> {
  const { db, orgId } = await requireAgentRole("admin");
  const normalized = normalizeCreateInput(input);
  await assertConfigBelongsToOrg(db, orgId, normalized.config_id);

  await assertTemplateLimit(db, orgId, normalized.config_id);

  const { data: template, error: templateError } = await db
    .from("agent_notification_templates")
    .insert({
      organization_id: orgId,
      config_id: normalized.config_id,
      name: normalized.name,
      description: normalized.description,
      target_type: normalized.target_type,
      target_address: normalized.target_address,
      body_template: normalized.body_template,
      status: "active",
    })
    .select("*")
    .single();

  if (templateError || !template) {
    throw new Error(
      templateError?.message ?? "Erro ao criar template de notificacao",
    );
  }

  const created = template as AgentNotificationTemplate;
  await syncToolForTemplate(db, orgId, created);

  for (const path of agentPaths(normalized.config_id)) revalidatePath(path);
  return created;
}

// ============================================================================
// Update
// ============================================================================

export async function updateNotificationTemplate(
  sourceId: string,
  input: UpdateNotificationTemplateInput,
): Promise<AgentNotificationTemplate> {
  const { db, orgId } = await requireAgentRole("admin");
  const existing = await assertTemplateBelongsToOrg(db, orgId, sourceId);
  const patch = normalizeUpdateInput(input);

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.target_type !== undefined) updates.target_type = patch.target_type;
  if (patch.target_address !== undefined) {
    updates.target_address = patch.target_address;
  }
  if (patch.body_template !== undefined) {
    updates.body_template = patch.body_template;
  }
  if (patch.status !== undefined) updates.status = patch.status;

  const { data: template, error: updateError } = await db
    .from("agent_notification_templates")
    .update(updates)
    .eq("organization_id", orgId)
    .eq("id", sourceId)
    .select("*")
    .single();

  if (updateError || !template) {
    throw new Error(
      updateError?.message ?? "Erro ao atualizar template",
    );
  }

  const updated = template as AgentNotificationTemplate;

  // Re-sync do tool. Se name mudou, precisa atualizar tool.name; se
  // status mudou, atualiza is_enabled; se description mudou, atualiza
  // tool.description. Mais simples: rebuild idempotente.
  const toolNameChanged =
    patch.name !== undefined && existing.name !== updated.name;
  await syncToolForTemplate(db, orgId, updated, {
    previousToolName: toolNameChanged ? existing.name : undefined,
  });

  for (const path of agentPaths(existing.config_id)) revalidatePath(path);
  return updated;
}

// ============================================================================
// Delete
// ============================================================================

export async function deleteNotificationTemplate(
  sourceId: string,
): Promise<void> {
  const { db, orgId } = await requireAgentRole("admin");
  const existing = await assertTemplateBelongsToOrg(db, orgId, sourceId);

  // Apaga o tool implicito antes — assim, se a delete da template falhar,
  // o admin ainda pode tentar de novo. Cascata via FK do agent_tools nao
  // se aplica aqui (sao tabelas independentes).
  await deleteToolForTemplate(db, orgId, existing.config_id, existing.name);

  const { error } = await db
    .from("agent_notification_templates")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", sourceId);

  if (error) throw new Error(error.message);

  for (const path of agentPaths(existing.config_id)) revalidatePath(path);
}

// ============================================================================
// Tool sync helpers
// ============================================================================

async function syncToolForTemplate(
  db: AgentDb,
  orgId: string,
  template: AgentNotificationTemplate,
  options: { previousToolName?: string } = {},
): Promise<void> {
  const newToolName = buildNotificationToolName(template.name);
  const previousToolName = options.previousToolName
    ? buildNotificationToolName(options.previousToolName)
    : null;

  // Se o nome mudou, apaga o tool antigo (a junction agent_stage_tools
  // referencia tool_id, entao essa exclusao perde a permissao por
  // etapa — admin precisa habilitar de novo no editor de etapa).
  if (previousToolName && previousToolName !== newToolName) {
    await deleteToolByName(db, orgId, template.config_id, previousToolName);
  }

  // Verifica se ja existe um tool com o nome novo. Se sim, atualiza;
  // se nao, insere.
  const { data: existing } = await db
    .from("agent_tools")
    .select("id")
    .eq("organization_id", orgId)
    .eq("config_id", template.config_id)
    .eq("name", newToolName)
    .maybeSingle();

  const toolPayload = {
    organization_id: orgId,
    config_id: template.config_id,
    name: newToolName,
    description: template.description,
    input_schema: TOOL_PRESET!.input_schema,
    execution_mode: "native" as const,
    native_handler: "trigger_notification" as const,
    webhook_url: null,
    webhook_secret: null,
    is_enabled: template.status === "active",
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await db
      .from("agent_tools")
      .update(toolPayload)
      .eq("organization_id", orgId)
      .eq("id", (existing as { id: string }).id);
    if (error) {
      throw new Error(`Erro ao atualizar tool da notificacao: ${error.message}`);
    }
  } else {
    const { error } = await db.from("agent_tools").insert(toolPayload);
    if (error) {
      throw new Error(`Erro ao registrar tool da notificacao: ${error.message}`);
    }
  }
}

async function deleteToolForTemplate(
  db: AgentDb,
  orgId: string,
  configId: string,
  templateName: string,
): Promise<void> {
  const toolName = buildNotificationToolName(templateName);
  await deleteToolByName(db, orgId, configId, toolName);
}

async function deleteToolByName(
  db: AgentDb,
  orgId: string,
  configId: string,
  toolName: string,
): Promise<void> {
  const { error } = await db
    .from("agent_tools")
    .delete()
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .eq("name", toolName);
  if (error) {
    throw new Error(`Erro ao remover tool da notificacao: ${error.message}`);
  }
}

// ============================================================================
// Validation helpers
// ============================================================================

async function assertTemplateBelongsToOrg(
  db: AgentDb,
  orgId: string,
  sourceId: string,
): Promise<AgentNotificationTemplate> {
  const { data, error } = await db
    .from("agent_notification_templates")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", sourceId)
    .maybeSingle();
  if (error || !data) throw new Error("Template nao encontrado");
  return data as AgentNotificationTemplate;
}

async function assertTemplateLimit(
  db: AgentDb,
  orgId: string,
  configId: string,
): Promise<void> {
  const { count, error } = await db
    .from("agent_notification_templates")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("config_id", configId);
  if (error) throw new Error(error.message);
  if ((count ?? 0) >= NOTIFICATION_TEMPLATES_MAX_PER_AGENT) {
    throw new Error(
      `Limite de ${NOTIFICATION_TEMPLATES_MAX_PER_AGENT} templates por agente atingido`,
    );
  }
}

function normalizeCreateInput(
  input: CreateNotificationTemplateInput,
): CreateNotificationTemplateInput {
  if (!input.config_id) throw new Error("config_id e obrigatorio");

  const name = input.name?.trim();
  validateName(name);

  const description = input.description?.trim();
  validateDescription(description);

  const targetType = validateTargetType(input.target_type);
  const targetAddress = validateTargetAddress(targetType, input.target_address);
  const body = validateBody(input.body_template);

  return {
    config_id: input.config_id,
    name: name as string,
    description: description as string,
    target_type: targetType,
    target_address: targetAddress,
    body_template: body,
  };
}

function normalizeUpdateInput(input: UpdateNotificationTemplateInput): {
  name?: string;
  description?: string;
  target_type?: NotificationTargetType;
  target_address?: string;
  body_template?: string;
  status?: "active" | "archived";
} {
  const out: ReturnType<typeof normalizeUpdateInput> = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    validateName(name);
    out.name = name;
  }
  if (input.description !== undefined) {
    const description = input.description.trim();
    validateDescription(description);
    out.description = description;
  }
  if (input.target_type !== undefined) {
    out.target_type = validateTargetType(input.target_type);
  }
  if (input.target_address !== undefined) {
    // Se target_type vem no patch, valida o par; senao, valida com tipo
    // generico (assume phone). Nao da pra evitar — a regra depende de
    // ambos.
    const type = out.target_type ?? "phone";
    out.target_address = validateTargetAddress(type, input.target_address);
  }
  if (input.body_template !== undefined) {
    out.body_template = validateBody(input.body_template);
  }
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "archived") {
      throw new Error("Status invalido");
    }
    out.status = input.status;
  }

  return out;
}

function validateName(name: string | undefined): asserts name is string {
  if (!name || name.length < NOTIFICATION_TEMPLATE_NAME_MIN_CHARS) {
    throw new Error(
      `Nome muito curto (min ${NOTIFICATION_TEMPLATE_NAME_MIN_CHARS})`,
    );
  }
  if (name.length > NOTIFICATION_TEMPLATE_NAME_MAX_CHARS) {
    throw new Error(
      `Nome muito longo (max ${NOTIFICATION_TEMPLATE_NAME_MAX_CHARS})`,
    );
  }
}

function validateDescription(
  description: string | undefined,
): asserts description is string {
  if (
    !description ||
    description.length < NOTIFICATION_TEMPLATE_DESCRIPTION_MIN_CHARS
  ) {
    throw new Error(
      `Descricao muito curta (min ${NOTIFICATION_TEMPLATE_DESCRIPTION_MIN_CHARS}). Descreva quando o agente deve usar esse template.`,
    );
  }
  if (description.length > NOTIFICATION_TEMPLATE_DESCRIPTION_MAX_CHARS) {
    throw new Error(
      `Descricao muito longa (max ${NOTIFICATION_TEMPLATE_DESCRIPTION_MAX_CHARS})`,
    );
  }
}

function validateTargetType(type: unknown): NotificationTargetType {
  if (type === "phone" || type === "group") return type;
  throw new Error('target_type deve ser "phone" ou "group"');
}

function validateTargetAddress(
  type: NotificationTargetType,
  address: string | undefined,
): string {
  const trimmed = address?.trim();
  if (!trimmed) throw new Error("Destino e obrigatorio");
  if (type === "phone") {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < NOTIFICATION_PHONE_MIN_DIGITS) {
      throw new Error(
        `Telefone tem menos que ${NOTIFICATION_PHONE_MIN_DIGITS} digitos`,
      );
    }
    if (digits.length > NOTIFICATION_PHONE_MAX_DIGITS) {
      throw new Error(
        `Telefone tem mais que ${NOTIFICATION_PHONE_MAX_DIGITS} digitos`,
      );
    }
    return digits;
  }
  // group: aceita JID em qualquer formato; runtime trata. Validamos so
  // tamanho minimo (qualquer JID tem mais que 5 chars).
  if (trimmed.length < 5) {
    throw new Error("JID do grupo invalido");
  }
  return trimmed;
}

function validateBody(body: string | undefined): string {
  const trimmed = body?.trim();
  if (!trimmed) throw new Error("Corpo do template e obrigatorio");
  if (trimmed.length > NOTIFICATION_TEMPLATE_BODY_MAX_LENGTH) {
    throw new Error(
      `Corpo muito longo (max ${NOTIFICATION_TEMPLATE_BODY_MAX_LENGTH})`,
    );
  }
  return trimmed;
}
