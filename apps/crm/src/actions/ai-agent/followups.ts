"use server";

import {
  clampFollowupDelayHours,
  FOLLOWUPS_MAX_PER_AGENT,
  FOLLOWUP_NAME_MAX_CHARS,
  FOLLOWUP_NAME_MIN_CHARS,
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

export async function createFollowup(
  input: CreateFollowupInput,
): Promise<AgentFollowup> {
  const { db, orgId } = await requireAgentRole("admin");

  const errors = validateFollowupInput(input);
  if (Object.keys(errors).length > 0) {
    throw new Error(
      errors.name || errors.template_id || errors.delay_hours || "Dados inválidos",
    );
  }

  // Cap por agente — evita criar 50 follow-ups que viram spam.
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

  // Confirma que template_id pertence a mesma org + ainda esta ativo.
  // Sem isso, cliente poderia setar template_id de outra org via DevTools
  // (RLS impede insert de qualquer jeito, mas erro daria 500 generico).
  const { data: tpl, error: tplError } = await db
    .from("agent_notification_templates")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("id", input.template_id)
    .maybeSingle();
  if (tplError) throw new Error(tplError.message);
  if (!tpl) throw new Error("Template não encontrado nesta organização");
  if ((tpl as { status?: string }).status !== "active") {
    throw new Error("Template selecionado não está ativo");
  }

  // Calcula próximo order_index — vai pro fim da lista.
  const { data: maxRows } = await db
    .from("agent_followups")
    .select("order_index")
    .eq("organization_id", orgId)
    .eq("config_id", input.config_id)
    .order("order_index", { ascending: false })
    .limit(1);
  const nextOrder = ((maxRows?.[0] as { order_index?: number } | undefined)?.order_index ?? -1) + 1;

  const { data, error } = await db
    .from("agent_followups")
    .insert({
      organization_id: orgId,
      config_id: input.config_id,
      name: input.name.trim().slice(0, FOLLOWUP_NAME_MAX_CHARS),
      template_id: input.template_id,
      delay_hours: clampFollowupDelayHours(input.delay_hours),
      is_enabled: input.is_enabled ?? true,
      order_index: nextOrder,
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

  // Carrega config_id pra revalidate path correto.
  const { data: existing, error: existingError } = await db
    .from("agent_followups")
    .select("config_id")
    .eq("organization_id", orgId)
    .eq("id", followupId)
    .maybeSingle();
  if (existingError || !existing) {
    throw new Error("Follow-up não encontrado");
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
    const { data: tpl } = await db
      .from("agent_notification_templates")
      .select("id, status")
      .eq("organization_id", orgId)
      .eq("id", input.template_id)
      .maybeSingle();
    if (!tpl) throw new Error("Template não encontrado nesta organização");
    if ((tpl as { status?: string }).status !== "active") {
      throw new Error("Template selecionado não está ativo");
    }
    updates.template_id = input.template_id;
  }

  if (input.delay_hours !== undefined) {
    updates.delay_hours = clampFollowupDelayHours(input.delay_hours);
  }
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
