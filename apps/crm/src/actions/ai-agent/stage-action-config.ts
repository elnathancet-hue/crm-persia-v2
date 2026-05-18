"use server";

import type { StageActionConfig } from "@persia/shared/ai-agent";
import { normalizeStageActionConfig } from "@persia/shared/ai-agent";
import { requireAgentRole } from "./utils";

// PR-AI-AGENT-STAGE-ACTIONS-UI (mai/2026): server actions pra UI de
// "Acoes por etapa" (PR 5 do plano A+C). 2 endpoints:
//
// 1. getStageActionCatalogs() — dados pros pickers (tag picker, stage
//    picker, etc). Diferente de tool-catalogs.ts (que monta strings pro
//    LLM), aqui retorna objetos estruturados pra UI.
//
// 2. updateStageActionConfig(stageId, config) — persiste mudancas via
//    normalizeStageActionConfig (descarta itens invalidos).

// ============================================================================
// Catalogos pra UI
// ============================================================================

export interface StageActionCatalogs {
  tags: Array<{ name: string; description: string | null; color: string | null }>;
  members: Array<{ name: string; email: string | null }>;
  /** Outros agentes ativos (exclui o atual via param). */
  agents: Array<{ id: string; name: string; description: string | null }>;
  /** Etapas do Kanban agrupadas por pipeline (cliente pode ter varios). */
  kanbanPipelines: Array<{
    id: string;
    name: string;
    stages: Array<{ name: string; outcome: "em_andamento" | "falha" | "bem_sucedido" }>;
  }>;
  /** Midia da Biblioteca (automation_tools ativas). */
  media: Array<{ slug: string; name: string; category: string }>;
  /** Templates de notificacao do agente (config_id filtra). */
  notificationTemplates: Array<{ name: string; description: string | null }>;
  /** Tipos de agendamento (PR 2). */
  appointmentTypes: Array<{ slug: string; name: string; duration_minutes: number }>;
}

export async function getStageActionCatalogs(
  configId: string,
): Promise<StageActionCatalogs> {
  const { db, orgId } = await requireAgentRole("admin");

  // Paralelo — 7 queries independentes
  const [
    tagsRes,
    membersRes,
    profilesRes,
    agentsRes,
    pipelinesRes,
    pipelineStagesRes,
    mediaRes,
    templatesRes,
    appointmentTypesRes,
  ] = await Promise.all([
    db
      .from("tags")
      .select("name, description, color")
      .eq("organization_id", orgId)
      .order("name", { ascending: true }),
    db
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("is_active", true),
    // profiles e fetch em duas fases (membership -> profiles).
    // Vamos colocar um placeholder que sera substituido apos members.
    Promise.resolve({ data: null, error: null }),
    db
      .from("agent_configs")
      .select("id, name, description")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .neq("id", configId)
      .order("name", { ascending: true }),
    db
      .from("pipelines")
      .select("id, name")
      .eq("organization_id", orgId)
      .order("name", { ascending: true }),
    db
      .from("pipeline_stages")
      .select("name, outcome, pipeline_id, sort_order")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true }),
    db
      .from("automation_tools")
      .select("slug, name, category")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .not("slug", "is", null)
      .order("name", { ascending: true }),
    db
      .from("agent_notification_templates")
      .select("name, description")
      .eq("organization_id", orgId)
      .eq("config_id", configId)
      .eq("status", "active")
      .order("name", { ascending: true }),
    db
      .from("agenda_services")
      .select("slug, name, duration_minutes")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .not("slug", "is", null)
      .order("name", { ascending: true }),
  ]);

  // Resolve profiles dos members em uma segunda fase
  const memberRows = (membersRes.data ?? []) as Array<{ user_id?: string | null }>;
  const memberIds = memberRows
    .map((m) => m.user_id)
    .filter((id): id is string => Boolean(id));

  let memberProfiles: Array<{ full_name: string | null; email: string | null }> = [];
  if (memberIds.length > 0) {
    const { data } = await db
      .from("profiles")
      .select("id, full_name, email")
      .in("id", memberIds);
    memberProfiles = ((data ?? []) as Array<{
      id: string;
      full_name?: string | null;
      email?: string | null;
    }>).map((p) => ({
      full_name: p.full_name ?? null,
      email: p.email ?? null,
    }));
  }
  // Ignored unused var warning — placeholder ate refator
  void profilesRes;

  // Monta kanbanPipelines agrupando stages por pipeline
  const pipelines = (pipelinesRes.data ?? []) as Array<{ id: string; name: string }>;
  const stagesAll = (pipelineStagesRes.data ?? []) as Array<{
    name: string;
    outcome: "em_andamento" | "falha" | "bem_sucedido";
    pipeline_id: string;
  }>;
  const stagesByPipeline = new Map<string, typeof stagesAll>();
  for (const s of stagesAll) {
    const list = stagesByPipeline.get(s.pipeline_id) ?? [];
    list.push(s);
    stagesByPipeline.set(s.pipeline_id, list);
  }

  return {
    tags: ((tagsRes.data ?? []) as Array<{
      name: string;
      description?: string | null;
      color?: string | null;
    }>).map((t) => ({
      name: t.name,
      description: t.description ?? null,
      color: t.color ?? null,
    })),
    members: memberProfiles
      .filter((p) => p.full_name || p.email)
      .map((p) => ({
        name: p.full_name?.trim() || p.email?.trim() || "Sem nome",
        email: p.email ?? null,
      })),
    agents: ((agentsRes.data ?? []) as Array<{
      id: string;
      name: string;
      description?: string | null;
    }>).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description ?? null,
    })),
    kanbanPipelines: pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      stages: (stagesByPipeline.get(p.id) ?? []).map((s) => ({
        name: s.name,
        outcome: s.outcome,
      })),
    })),
    media: ((mediaRes.data ?? []) as Array<{
      slug?: string | null;
      name?: string | null;
      category?: string | null;
    }>)
      .filter((m): m is { slug: string; name: string; category: string } =>
        Boolean(m.slug && m.name),
      )
      .map((m) => ({
        slug: m.slug,
        name: m.name,
        category: m.category ?? "outro",
      })),
    notificationTemplates: ((templatesRes.data ?? []) as Array<{
      name: string;
      description?: string | null;
    }>).map((t) => ({
      name: t.name,
      description: t.description ?? null,
    })),
    appointmentTypes: ((appointmentTypesRes.data ?? []) as Array<{
      slug?: string | null;
      name?: string | null;
      duration_minutes?: number | null;
    }>)
      .filter((t): t is { slug: string; name: string; duration_minutes: number } =>
        Boolean(t.slug && t.name && typeof t.duration_minutes === "number"),
      )
      .map((t) => ({
        slug: t.slug,
        name: t.name,
        duration_minutes: t.duration_minutes,
      })),
  };
}

// ============================================================================
// Persist
// ============================================================================

export async function updateStageActionConfig(
  stageId: string,
  config: StageActionConfig,
): Promise<{ ok: true; sanitized: StageActionConfig }> {
  const { db, orgId } = await requireAgentRole("admin");

  // Defensive normalize — descarta itens invalidos antes de gravar.
  const sanitized = normalizeStageActionConfig(config);

  const { error } = await db
    .from("agent_stages")
    .update({ action_config: sanitized })
    .eq("id", stageId)
    .eq("organization_id", orgId);

  if (error) throw new Error(error.message);
  return { ok: true, sanitized };
}
