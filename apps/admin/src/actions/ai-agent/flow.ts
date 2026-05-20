"use server";

// AI Agent — flow CRUD (admin) — PR-FLOW-PIVOT PR 3 (mai/2026).
//
// Paridade com apps/crm/src/actions/ai-agent/flow.ts, mas usa
// requireSuperadminForOrg + fromAny (admin opera com service_role e
// org_id explícito vindo do contexto, não do cookie).

import { revalidatePath } from "next/cache";
import type { FlowConfig } from "@persia/shared/ai-agent";
import { normalizeFlowConfig } from "@persia/shared/ai-agent";
import { fromAny } from "@/lib/ai-agent/db";
import {
  agentPaths,
  assertConfigBelongsToOrg,
  auditAdminAgentAction,
  auditAdminAgentFailure,
  requireAdminAgentOrg,
} from "./utils";

export async function getFlow(
  orgId: string,
  configId: string,
): Promise<FlowConfig | null> {
  const { db } = await requireAdminAgentOrg(orgId);
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { data, error } = await fromAny(db, "agent_flows")
    .select("nodes, edges, viewport, enabled_tools")
    .eq("organization_id", orgId)
    .eq("agent_config_id", configId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar fluxo: ${error.message}`);
  if (!data) return null;
  return normalizeFlowConfig({
    nodes: (data as { nodes: unknown }).nodes,
    edges: (data as { edges: unknown }).edges,
    viewport: (data as { viewport: unknown }).viewport,
    enabled_tools: (data as { enabled_tools: unknown }).enabled_tools,
  });
}

export async function saveFlow(
  orgId: string,
  configId: string,
  config: FlowConfig,
): Promise<{ ok: true; version: number }> {
  const { db, userId } = await requireAdminAgentOrg(orgId);
  await assertConfigBelongsToOrg(db, orgId, configId);

  const normalized = normalizeFlowConfig(config);

  try {
    const { data: existing } = await fromAny(db, "agent_flows")
      .select("id, version")
      .eq("organization_id", orgId)
      .eq("agent_config_id", configId)
      .maybeSingle();

    let version: number;
    if (existing) {
      const currentVersion = (existing as { version: number }).version;
      version = currentVersion + 1;
      const { error } = await fromAny(db, "agent_flows")
        .update({
          nodes: normalized.nodes,
          edges: normalized.edges,
          viewport: normalized.viewport,
          enabled_tools: normalized.enabled_tools,
          version,
        })
        .eq("organization_id", orgId)
        .eq("agent_config_id", configId);
      if (error) throw new Error(error.message);
    } else {
      version = 1;
      const { error } = await fromAny(db, "agent_flows").insert({
        organization_id: orgId,
        agent_config_id: configId,
        nodes: normalized.nodes,
        edges: normalized.edges,
        viewport: normalized.viewport,
        enabled_tools: normalized.enabled_tools,
        version,
      });
      if (error) throw new Error(error.message);
    }

    await auditAdminAgentAction({
      userId,
      orgId,
      action: "admin_ai_agent_flow_save",
      entityType: "agent_flow",
      entityId: configId,
      metadata: {
        config_id: configId,
        version,
        node_count: normalized.nodes.length,
        edge_count: normalized.edges.length,
      },
    });

    for (const path of agentPaths(configId)) revalidatePath(path);
    return { ok: true, version };
  } catch (error) {
    await auditAdminAgentFailure({
      userId,
      orgId,
      action: "admin_ai_agent_flow_save",
      entityType: "agent_flow",
      entityId: configId,
      metadata: { config_id: configId },
      error,
    });
    throw error;
  }
}
