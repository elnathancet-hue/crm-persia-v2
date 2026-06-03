"use server";

import {
  clampFollowupDelayHours,
  FOLLOWUP_DEFAULT_SEND_WINDOW_END,
  FOLLOWUP_DEFAULT_SEND_WINDOW_START,
  FOLLOWUP_MESSAGE_MAX_CHARS,
  FOLLOWUPS_MAX_PER_AGENT,
  FOLLOWUP_NAME_MAX_CHARS,
  FOLLOWUP_NAME_MIN_CHARS,
  isValidFollowupWindow,
  normalizeFollowupWindowTime,
  validateFollowupInput,
  type AgentFollowup,
  type CreateFollowupInput,
  type UpdateFollowupInput,
} from "@persia/shared/ai-agent";
import { revalidatePath } from "next/cache";
import { agentPaths, requireAgentRole } from "./utils";

export async function listFollowups(configId: string): Promise<AgentFollowup[]> {
  const { db, orgId } = await requireAgentRole("agent");
  const { data, error } = await db
    .from("agent_followups")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("order_index", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentFollowup[];
}

export async function createFollowup(input: CreateFollowupInput): Promise<AgentFollowup> {
  const { db, orgId } = await requireAgentRole("admin");

  const errors = validateFollowupInput(input);
  if (Object.keys(errors).length > 0) {
    throw new Error(
      errors.name ||
        errors.message_text ||
        errors.template_id ||
        errors.delay_hours ||
        errors.send_window ||
        "Dados invalidos",
    );
  }

  const { count, error: countError } = await db
    .from("agent_followups")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("config_id", input.config_id);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) >= FOLLOWUPS_MAX_PER_AGENT) {
    throw new Error(
      `Limite de ${FOLLOWUPS_MAX_PER_AGENT} follow-ups por agente atingido. Remova um antes de criar outro.`,
    );
  }

  const createTemplateId = input.template_id ?? null;
  if (createTemplateId) {
    await assertActiveTemplate(db, orgId, createTemplateId);
  }

  const { data: maxRows } = await db
    .from("agent_followups")
    .select("order_index")
    .eq("organization_id", orgId)
    .eq("config_id", input.config_id)
    .order("order_index", { ascending: false })
    .limit(1);
  const nextOrder =
    ((maxRows?.[0] as { order_index?: number } | undefined)?.order_index ?? -1) + 1;

  const { data, error } = await db
    .from("agent_followups")
    .insert({
      organization_id: orgId,
      config_id: input.config_id,
      name: input.name.trim().slice(0, FOLLOWUP_NAME_MAX_CHARS),
      template_id: createTemplateId,
      message_text:
        input.message_text?.trim().slice(0, FOLLOWUP_MESSAGE_MAX_CHARS) || null,
      delay_hours: clampFollowupDelayHours(input.delay_hours),
      is_enabled: input.is_enabled ?? true,
      order_index: nextOrder,
      send_window_start: normalizeFollowupWindowTime(
        input.send_window_start ?? FOLLOWUP_DEFAULT_SEND_WINDOW_START,
      ),
      send_window_end: normalizeFollowupWindowTime(
        input.send_window_end ?? FOLLOWUP_DEFAULT_SEND_WINDOW_END,
      ),
      require_ai_active: true,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao criar follow-up");

  for (const path of agentPaths(input.config_id)) revalidatePath(path);
  return data as AgentFollowup;
}

export async function updateFollowup(
  followupId: string,
  input: UpdateFollowupInput,
): Promise<AgentFollowup> {
  const { db, orgId } = await requireAgentRole("admin");

  const { data: existing, error: existingError } = await db
    .from("agent_followups")
    .select("config_id, send_window_start, send_window_end")
    .eq("organization_id", orgId)
    .eq("id", followupId)
    .maybeSingle();
  if (existingError || !existing) {
    throw new Error("Follow-up nao encontrado");
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < FOLLOWUP_NAME_MIN_CHARS || name.length > FOLLOWUP_NAME_MAX_CHARS) {
      throw new Error(
        `Nome deve ter entre ${FOLLOWUP_NAME_MIN_CHARS} e ${FOLLOWUP_NAME_MAX_CHARS} caracteres`,
      );
    }
    updates.name = name;
  }

  if (input.template_id !== undefined) {
    const updateTemplateId = input.template_id ?? null;
    if (updateTemplateId) {
      await assertActiveTemplate(db, orgId, updateTemplateId);
    }
    updates.template_id = updateTemplateId;
  }

  if (input.message_text !== undefined) {
    const messageText = input.message_text?.trim() ?? "";
    if (messageText.length > FOLLOWUP_MESSAGE_MAX_CHARS) {
      throw new Error(`Mensagem deve ter no maximo ${FOLLOWUP_MESSAGE_MAX_CHARS} caracteres`);
    }
    updates.message_text = messageText || null;
  }

  if (input.delay_hours !== undefined) {
    updates.delay_hours = clampFollowupDelayHours(input.delay_hours);
  }

  if (input.send_window_start !== undefined || input.send_window_end !== undefined) {
    const start = normalizeFollowupWindowTime(
      input.send_window_start ??
        (existing as { send_window_start?: string | null }).send_window_start ??
        FOLLOWUP_DEFAULT_SEND_WINDOW_START,
    );
    const end = normalizeFollowupWindowTime(
      input.send_window_end ??
        (existing as { send_window_end?: string | null }).send_window_end ??
        FOLLOWUP_DEFAULT_SEND_WINDOW_END,
    );
    if (!isValidFollowupWindow(start, end)) {
      throw new Error("A janela de envio deve ter inicio menor que o fim");
    }
    updates.send_window_start = start;
    updates.send_window_end = end;
  }

  if (input.require_ai_active !== undefined) updates.require_ai_active = true;
  if (input.is_enabled !== undefined) updates.is_enabled = input.is_enabled;
  if (input.order_index !== undefined) updates.order_index = input.order_index;

  const { data, error } = await db
    .from("agent_followups")
    .update(updates)
    .eq("organization_id", orgId)
    .eq("id", followupId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message || "Erro ao atualizar follow-up");

  const configId = (existing as { config_id: string }).config_id;
  for (const path of agentPaths(configId)) revalidatePath(path);
  return data as AgentFollowup;
}

export async function deleteFollowup(followupId: string): Promise<void> {
  const { db, orgId } = await requireAgentRole("admin");

  const { data: existing } = await db
    .from("agent_followups")
    .select("config_id")
    .eq("organization_id", orgId)
    .eq("id", followupId)
    .maybeSingle();

  const { error } = await db
    .from("agent_followups")
    .delete()
    .eq("organization_id", orgId)
    .eq("id", followupId);

  if (error) throw new Error(error.message);

  if (existing) {
    const configId = (existing as { config_id: string }).config_id;
    for (const path of agentPaths(configId)) revalidatePath(path);
  }
}

export async function toggleFollowup(
  followupId: string,
  isEnabled: boolean,
): Promise<AgentFollowup> {
  return updateFollowup(followupId, { is_enabled: isEnabled });
}

async function assertActiveTemplate(
  db: { from: (table: string) => any },
  orgId: string,
  templateId: string,
): Promise<void> {
  const { data: tpl, error } = await db
    .from("agent_notification_templates")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!tpl) throw new Error("Template nao encontrado nesta organizacao");
  if ((tpl as { status?: string }).status !== "active") {
    throw new Error("Template selecionado nao esta ativo");
  }
}
