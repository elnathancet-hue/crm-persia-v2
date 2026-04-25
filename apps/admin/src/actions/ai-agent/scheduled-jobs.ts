"use server";

import { revalidatePath } from "next/cache";
import {
  isValidCronShape,
  SCHEDULED_JOB_NAME_MAX_CHARS,
  SCHEDULED_JOB_NAME_MIN_CHARS,
  SCHEDULED_JOBS_MAX_PER_AGENT,
  validateLeadFilter,
  type AgentScheduledJob,
  type CreateScheduledJobInput,
  type LeadFilter,
  type UpdateScheduledJobInput,
} from "@persia/shared/ai-agent";
import { fromAny, type AgentDb } from "@/lib/ai-agent/db";
import {
  agentPaths,
  assertConfigBelongsToOrg,
  auditAdminAgentAction,
  auditAdminAgentFailure,
  requireAdminAgentOrg,
} from "./utils";

// ============================================================================
// Listing
// ============================================================================

export async function listScheduledJobs(
  orgId: string,
  configId: string,
): Promise<AgentScheduledJob[]> {
  const { db } = await requireAdminAgentOrg(orgId);
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { data, error } = await fromAny(db, "agent_scheduled_jobs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as AgentScheduledJob[];
}

// ============================================================================
// Create
// ============================================================================

export async function createScheduledJob(
  orgId: string,
  input: CreateScheduledJobInput,
): Promise<AgentScheduledJob> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const normalized = normalizeCreateInput(input);
    await assertConfigBelongsToOrg(db, orgId, normalized.config_id);
    await assertJobLimit(db, orgId, normalized.config_id);
    await assertTemplateBelongsToConfig(
      db,
      orgId,
      normalized.config_id,
      normalized.template_id,
    );

    const { data, error } = await fromAny(db, "agent_scheduled_jobs")
      .insert({
        organization_id: orgId,
        config_id: normalized.config_id,
        name: normalized.name,
        template_id: normalized.template_id,
        cron_expr: normalized.cron_expr,
        lead_filter: normalized.lead_filter,
        status: "active",
        next_run_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Erro ao criar agendamento");
    }

    const created = data as AgentScheduledJob;

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_scheduled_job_create",
      entityType: "agent_scheduled_job",
      entityId: created.id,
      metadata: {
        config_id: normalized.config_id,
        name: created.name,
        cron_expr: created.cron_expr,
      },
    });

    for (const path of agentPaths(normalized.config_id)) revalidatePath(path);
    return created;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_scheduled_job_create",
      entityType: "agent_scheduled_job",
      metadata: { config_id: input.config_id, name: input.name },
      error,
    });
    throw error;
  }
}

// ============================================================================
// Update
// ============================================================================

export async function updateScheduledJob(
  orgId: string,
  jobId: string,
  input: UpdateScheduledJobInput,
): Promise<AgentScheduledJob> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertJobBelongsToOrg(db, orgId, jobId);
    const patch = normalizeUpdateInput(input);

    if (patch.template_id !== undefined) {
      await assertTemplateBelongsToConfig(
        db,
        orgId,
        existing.config_id,
        patch.template_id,
      );
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.template_id !== undefined) {
      updates.template_id = patch.template_id;
    }
    if (patch.cron_expr !== undefined) {
      updates.cron_expr = patch.cron_expr;
      updates.next_run_at = new Date().toISOString();
    }
    if (patch.lead_filter !== undefined) {
      updates.lead_filter = patch.lead_filter;
    }
    if (patch.status !== undefined) {
      updates.status = patch.status;
      if (patch.status === "paused") {
        updates.next_run_at = null;
      } else if (patch.status === "active") {
        updates.next_run_at = new Date().toISOString();
      }
    }

    const { data, error } = await fromAny(db, "agent_scheduled_jobs")
      .update(updates)
      .eq("organization_id", orgId)
      .eq("id", jobId)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Erro ao atualizar agendamento");
    }

    const updated = data as AgentScheduledJob;

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_scheduled_job_update",
      entityType: "agent_scheduled_job",
      entityId: jobId,
      metadata: {
        config_id: existing.config_id,
        status_changed: patch.status !== undefined,
        cron_changed: patch.cron_expr !== undefined,
      },
    });

    for (const path of agentPaths(existing.config_id)) revalidatePath(path);
    return updated;
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_scheduled_job_update",
      entityType: "agent_scheduled_job",
      entityId: jobId,
      error,
    });
    throw error;
  }
}

// ============================================================================
// Delete
// ============================================================================

export async function deleteScheduledJob(
  orgId: string,
  jobId: string,
): Promise<void> {
  const { db, userId } = await requireAdminAgentOrg(orgId);

  try {
    const existing = await assertJobBelongsToOrg(db, orgId, jobId);
    const { error } = await fromAny(db, "agent_scheduled_jobs")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", jobId);
    if (error) throw new Error(error.message);

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_scheduled_job_delete",
      entityType: "agent_scheduled_job",
      entityId: jobId,
      metadata: { config_id: existing.config_id, name: existing.name },
    });

    for (const path of agentPaths(existing.config_id)) revalidatePath(path);
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_scheduled_job_delete",
      entityType: "agent_scheduled_job",
      entityId: jobId,
      error,
    });
    throw error;
  }
}

// ============================================================================
// Helpers (mirror)
// ============================================================================

async function assertJobBelongsToOrg(
  db: AgentDb,
  orgId: string,
  jobId: string,
): Promise<AgentScheduledJob> {
  const { data, error } = await fromAny(db, "agent_scheduled_jobs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) throw new Error("Agendamento nao encontrado");
  return data as AgentScheduledJob;
}

async function assertJobLimit(
  db: AgentDb,
  orgId: string,
  configId: string,
): Promise<void> {
  const { count, error } = await fromAny(db, "agent_scheduled_jobs")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("config_id", configId);
  if (error) throw new Error(error.message);
  if ((count ?? 0) >= SCHEDULED_JOBS_MAX_PER_AGENT) {
    throw new Error(
      `Limite de ${SCHEDULED_JOBS_MAX_PER_AGENT} agendamentos por agente atingido`,
    );
  }
}

async function assertTemplateBelongsToConfig(
  db: AgentDb,
  orgId: string,
  configId: string,
  templateId: string,
): Promise<void> {
  const { data, error } = await fromAny(db, "agent_notification_templates")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .eq("id", templateId)
    .maybeSingle();
  if (error || !data) {
    throw new Error("Template nao encontrado para este agente");
  }
  if ((data as { status: string }).status !== "active") {
    throw new Error("Template esta arquivado. Reative-o antes de agendar.");
  }
}

function normalizeCreateInput(
  input: CreateScheduledJobInput,
): CreateScheduledJobInput {
  if (!input.config_id) throw new Error("config_id e obrigatorio");
  if (!input.template_id) throw new Error("template_id e obrigatorio");
  const name = input.name?.trim();
  validateName(name);
  const cron = validateCron(input.cron_expr);
  validateLeadFilter(input.lead_filter);
  return {
    config_id: input.config_id,
    name: name as string,
    template_id: input.template_id,
    cron_expr: cron,
    lead_filter: input.lead_filter,
  };
}

function normalizeUpdateInput(input: UpdateScheduledJobInput): {
  name?: string;
  template_id?: string;
  cron_expr?: string;
  lead_filter?: LeadFilter;
  status?: "active" | "paused";
} {
  const out: ReturnType<typeof normalizeUpdateInput> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    validateName(name);
    out.name = name;
  }
  if (input.template_id !== undefined) {
    if (!input.template_id) throw new Error("template_id nao pode ficar vazio");
    out.template_id = input.template_id;
  }
  if (input.cron_expr !== undefined) {
    out.cron_expr = validateCron(input.cron_expr);
  }
  if (input.lead_filter !== undefined) {
    validateLeadFilter(input.lead_filter);
    out.lead_filter = input.lead_filter;
  }
  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "paused") {
      throw new Error("Status invalido");
    }
    out.status = input.status;
  }
  return out;
}

function validateName(name: string | undefined): asserts name is string {
  if (!name || name.length < SCHEDULED_JOB_NAME_MIN_CHARS) {
    throw new Error(
      `Nome muito curto (min ${SCHEDULED_JOB_NAME_MIN_CHARS})`,
    );
  }
  if (name.length > SCHEDULED_JOB_NAME_MAX_CHARS) {
    throw new Error(
      `Nome muito longo (max ${SCHEDULED_JOB_NAME_MAX_CHARS})`,
    );
  }
}

function validateCron(expr: string | undefined): string {
  const trimmed = expr?.trim();
  if (!trimmed) throw new Error("Expressao cron e obrigatoria");
  if (!isValidCronShape(trimmed)) {
    throw new Error(
      "Expressao cron invalida — use 5 campos (ex: '0 9 * * *')",
    );
  }
  return trimmed;
}
