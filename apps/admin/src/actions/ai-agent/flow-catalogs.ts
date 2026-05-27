"use server";

// AI Agent — catálogos pros pickers do NodeConfigSheet (admin).
//
// PR-FLOW-PIVOT PR 4 (mai/2026): paridade com CRM flow-catalogs.ts.
// Usa service_role + requireAdminAgentOrg + audit log. Org_id vem
// explícito do contexto (cookie de impersonation).

import { fromAny } from "@/lib/ai-agent/db";
import { listPipelines, listTags, listStagesForOrg } from "@persia/shared/crm";
import type { Pipeline, Stage, Tag } from "@persia/shared/crm";
import type {
  FlowCatalogs,
  FlowCatalogAgent,
  FlowCatalogAgendaService,
  FlowCatalogNotificationTemplate,
} from "@persia/ai-agent-ui";
import { assertConfigBelongsToOrg, requireAdminAgentOrg } from "./utils";

// Re-export pros consumers que importam desta action.
export type { FlowCatalogs } from "@persia/ai-agent-ui";

export async function getFlowCatalogs(
  orgId: string,
  configId: string,
): Promise<FlowCatalogs> {
  const { db } = await requireAdminAgentOrg(orgId);
  await assertConfigBelongsToOrg(db, orgId, configId);
  const ctx = { db, orgId };

  const [
    tagsRes,
    pipelinesRes,
    stagesRes,
    templatesRes,
    agendaRes,
    membersRes,
    agentsRes,
    segmentsRes,
    customFieldsRes,
  ] = await Promise.allSettled([
    listTags(ctx, { orderBy: "name" }),
    // Backlog #5 Auditoria (mai/2026): rodada 2 #3 — admin precisa
    // resolver pipeline_name no catalogo de stages pra UX consistente
    // com CRM. Antes retornava string vazia.
    listPipelines(ctx),
    listStagesForOrg(ctx),
    fromAny(db, "agent_notification_templates")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("config_id", configId)
      .order("name", { ascending: true }),
    fromAny(db, "agenda_services")
      .select("id, name, slug, duration_minutes")
      .eq("organization_id", orgId)
      .order("name", { ascending: true }),
    fromAny(db, "organization_members")
      .select("user_id, profile:profiles(full_name, email)")
      .eq("organization_id", orgId)
      .eq("is_active", true),
    fromAny(db, "agent_configs")
      .select("id, name")
      .eq("organization_id", orgId)
      .neq("id", configId)
      .eq("status", "active")
      .order("name", { ascending: true }),
    fromAny(db, "segments")
      .select("id, name")
      .eq("organization_id", orgId)
      .order("name", { ascending: true }),
    fromAny(db, "custom_fields")
      .select("id, name, field_key, field_type")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true }),
  ]);

  const pipelinesById = new Map(
    pipelinesRes.status === "fulfilled"
      ? (pipelinesRes.value as Pipeline[]).map((p) => [p.id, p.name])
      : [],
  );

  return {
    tags:
      tagsRes.status === "fulfilled"
        ? (tagsRes.value as Tag[]).map((t) => ({
            id: t.id,
            name: t.name,
            color: t.color ?? null,
          }))
        : [],
    pipeline_stages:
      stagesRes.status === "fulfilled"
        ? (stagesRes.value as Stage[]).map((s) => ({
            id: s.id,
            name: s.name,
            pipeline_id: s.pipeline_id,
            pipeline_name: pipelinesById.get(s.pipeline_id) ?? "",
          }))
        : [],
    notification_templates:
      templatesRes.status === "fulfilled" && !templatesRes.value.error
        ? ((templatesRes.value.data ?? []) as FlowCatalogNotificationTemplate[])
        : [],
    agenda_services:
      agendaRes.status === "fulfilled" && !agendaRes.value.error
        ? ((agendaRes.value.data ?? []) as FlowCatalogAgendaService[])
        : [],
    members:
      membersRes.status === "fulfilled" && !membersRes.value.error
        ? ((membersRes.value.data ?? []) as Array<{
            user_id: string;
            profile: { full_name: string | null; email: string | null } | null;
          }>).map((m) => ({
            user_id: m.user_id,
            name: m.profile?.full_name ?? m.profile?.email ?? "Sem nome",
            email: m.profile?.email ?? null,
          }))
        : [],
    other_agents:
      agentsRes.status === "fulfilled" && !agentsRes.value.error
        ? ((agentsRes.value.data ?? []) as FlowCatalogAgent[])
        : [],
    segments:
      segmentsRes.status === "fulfilled" && !segmentsRes.value.error
        ? ((segmentsRes.value.data ?? []) as Array<{ id: string; name: string }>)
        : [],
    custom_fields:
      customFieldsRes.status === "fulfilled" && !customFieldsRes.value.error
        ? ((customFieldsRes.value.data ?? []) as Array<{
            id: string;
            name: string;
            field_key: string;
            field_type: string;
          }>)
        : [],
  };
}
