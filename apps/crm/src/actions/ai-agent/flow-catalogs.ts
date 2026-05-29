"use server";

// AI Agent — catálogos pros pickers do NodeConfigSheet.
//
// PR-FLOW-PIVOT PR 4 (mai/2026): consolidação de listas que os modais
// de edição precisam pra que o cliente NUNCA digite IDs/slugs livres.
// Toda config dos action nodes vira "selecione da lista". Uma única
// server action carrega tudo (tags + pipeline stages + templates +
// agenda + membros + outros agentes) em paralelo.
//
// V1 não inclui: media library (automation_tools), segments,
// lead_custom_fields. Entram em PRs posteriores quando esses
// pickers ficarem necessários.
//
// mai/2026: media_library agora incluida. Bug em prod — cliente
// colava URL completa da API no campo "Slug da midia" da action
// send_media, runtime nao encontrava e midia nao era enviada.
// Picker resolve.

import { asAgentDb } from "@/lib/ai-agent/db";
import { listPipelines, listTags, listStagesForOrg } from "@persia/shared/crm";
import type { Pipeline, Stage, Tag } from "@persia/shared/crm";
import type {
  FlowCatalogs,
  FlowCatalogAgent,
  FlowCatalogAgendaService,
  FlowCatalogMedia,
  FlowCatalogNotificationTemplate,
} from "@persia/ai-agent-ui";
import { requireAgentRole } from "./utils";

// Re-export pros consumers que importam direto desta action.
export type { FlowCatalogs } from "@persia/ai-agent-ui";

/**
 * Carrega todos os catálogos de uma vez (paralelo). Server retorna
 * shape estável; UI mapeia 1:1 nos selects do NodeConfigSheet.
 *
 * Defensive: cada query falha INDIVIDUALMENTE (log + array vazio).
 * Modal continua abrindo mesmo se 1 catálogo quebrar (ex: org sem
 * agenda configurada).
 */
export async function getFlowCatalogs(configId: string): Promise<FlowCatalogs> {
  const { supabase, orgId } = await requireAgentRole("agent");
  const db = asAgentDb(supabase);
  const ctx = { db, orgId };

  // Roda tudo em paralelo. Promise.allSettled garante que 1 falha
  // não derruba os outros.
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
    mediaRes,
  ] = await Promise.allSettled([
    listTags(ctx, { orderBy: "name" }),
    listPipelines(ctx),
    listStagesForOrg(ctx),
    db
      .from("agent_notification_templates")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("config_id", configId)
      .order("name", { ascending: true }),
    db
      .from("agenda_services")
      .select("id, name, slug, duration_minutes")
      .eq("organization_id", orgId)
      .order("name", { ascending: true }),
    db
      .from("organization_members")
      .select("user_id, profile:profiles(full_name, email)")
      .eq("organization_id", orgId)
      .eq("is_active", true),
    db
      .from("agent_configs")
      .select("id, name")
      .eq("organization_id", orgId)
      .neq("id", configId)
      .eq("status", "active")
      .order("name", { ascending: true }),
    db
      .from("segments")
      .select("id, name")
      .eq("organization_id", orgId)
      .order("name", { ascending: true }),
    db
      .from("custom_fields")
      .select("id, name, field_key, field_type")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true }),
    db
      .from("automation_tools")
      .select("id, slug, name, file_type, category")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .not("slug", "is", null)
      .order("name", { ascending: true }),
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
    media_library:
      mediaRes.status === "fulfilled" && !mediaRes.value.error
        ? ((mediaRes.value.data ?? []) as Array<{
            id: string;
            slug: string | null;
            name: string;
            file_type: string;
            category: string;
          }>)
            // Defensive: filtra fora qualquer row que escapou do
            // `.not("slug", "is", null)` (concorrencia com toggle
            // is_active, schema migration etc).
            .filter((m): m is FlowCatalogMedia => typeof m.slug === "string" && m.slug.length > 0)
        : [],
  };
}
