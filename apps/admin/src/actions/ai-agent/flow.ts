"use server";

// AI Agent — flow CRUD (admin) — PR-FLOW-PIVOT PR 3 (mai/2026).
//
// Paridade com apps/crm/src/actions/ai-agent/flow.ts, mas usa
// requireSuperadminForOrg + fromAny (admin opera com service_role e
// org_id explícito vindo do contexto, não do cookie).
//
// Backlog #3 Auditoria (mai/2026): saveFlow ganha `expectedVersion` +
// retorno discriminado pra CAS optimistic locking. Endereca rodada 9 #3
// — paridade com CRM (apps/crm/src/actions/ai-agent/flow.ts).

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

export interface FlowImpactPreview {
  affected_conversations: number;
  at_risk_node_ids: string[];
  total_live_conversations: number;
}

export async function getFlow(
  orgId: string,
  configId: string,
): Promise<{ config: FlowConfig; version: number } | null> {
  const { db } = await requireAdminAgentOrg(orgId);
  await assertConfigBelongsToOrg(db, orgId, configId);

  const { data, error } = await fromAny(db, "agent_flows")
    .select("nodes, edges, viewport, enabled_tools, version")
    .eq("organization_id", orgId)
    .eq("agent_config_id", configId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar fluxo: ${error.message}`);
  if (!data) return null;
  const row = data as {
    nodes: unknown;
    edges: unknown;
    viewport: unknown;
    enabled_tools: unknown;
    version: number;
  };
  return {
    config: normalizeFlowConfig({
      nodes: row.nodes,
      edges: row.edges,
      viewport: row.viewport,
      enabled_tools: row.enabled_tools,
    }),
    version: row.version,
  };
}

export type AdminSaveFlowResult =
  | { ok: true; version: number }
  | {
      ok: false;
      conflict: true;
      expected_version: number;
      current_version: number;
    };

export async function saveFlow(
  orgId: string,
  configId: string,
  config: FlowConfig,
  expectedVersion?: number,
): Promise<AdminSaveFlowResult> {
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

      // Backlog #3: CAS check pre-UPDATE. Conflito = outro admin salvou
      // entre o load do canvas e este save.
      if (
        expectedVersion !== undefined &&
        expectedVersion !== currentVersion
      ) {
        await auditAdminAgentFailure({
          userId,
          orgId,
          action: "admin_ai_agent_flow_save",
          entityType: "agent_flow",
          entityId: configId,
          metadata: {
            config_id: configId,
            reason: "version_conflict",
            expected_version: expectedVersion,
            current_version: currentVersion,
          },
          error: new Error("version_conflict"),
        });
        return {
          ok: false,
          conflict: true,
          expected_version: expectedVersion,
          current_version: currentVersion,
        };
      }

      version = currentVersion + 1;
      const { error, count } = await fromAny(db, "agent_flows")
        .update(
          {
            nodes: normalized.nodes,
            edges: normalized.edges,
            viewport: normalized.viewport,
            enabled_tools: normalized.enabled_tools,
            version,
          },
          { count: "exact" },
        )
        .eq("organization_id", orgId)
        .eq("agent_config_id", configId)
        .eq("version", currentVersion);
      if (error) throw new Error(error.message);

      if (count === 0) {
        // Race entre SELECT da `existing` e este UPDATE — outro update
        // pegou primeiro. Refetch pra reportar version atual ao caller.
        const { data: refetched } = await fromAny(db, "agent_flows")
          .select("version")
          .eq("organization_id", orgId)
          .eq("agent_config_id", configId)
          .maybeSingle();
        const liveVersion =
          (refetched as { version?: number } | null)?.version ?? currentVersion;
        return {
          ok: false,
          conflict: true,
          expected_version: expectedVersion ?? currentVersion,
          current_version: liveVersion,
        };
      }
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

/**
 * Backlog #4 Auditoria (mai/2026): paridade com apps/crm/src/actions/ai-agent/flow.ts.
 * Endereca rodada 9 #1 + #5 — admin precisa ver impacto antes de salvar
 * flow que ja tem conversas vivas. Read-only, sem audit log porque nao
 * altera estado (so reporta).
 */
export async function previewFlowImpact(
  orgId: string,
  configId: string,
  config: FlowConfig,
): Promise<FlowImpactPreview> {
  const { db } = await requireAdminAgentOrg(orgId);
  await assertConfigBelongsToOrg(db, orgId, configId);

  const normalized = normalizeFlowConfig(config);
  const nodeIdsInNewConfig = new Set(normalized.nodes.map((n) => n.id));

  const { data: liveConvs, error: convError } = await fromAny(db, "agent_conversations")
    .select("current_node_id")
    .eq("organization_id", orgId)
    .eq("config_id", configId)
    .not("current_node_id", "is", null);

  if (convError) {
    throw new Error(`Falha ao analisar impacto: ${convError.message}`);
  }

  const rows = (liveConvs ?? []) as Array<{ current_node_id: string }>;
  const atRiskSet = new Set<string>();
  for (const row of rows) {
    if (!nodeIdsInNewConfig.has(row.current_node_id)) {
      atRiskSet.add(row.current_node_id);
    }
  }

  const affectedCount = rows.filter(
    (r) => !nodeIdsInNewConfig.has(r.current_node_id),
  ).length;

  return {
    affected_conversations: affectedCount,
    at_risk_node_ids: Array.from(atRiskSet),
    total_live_conversations: rows.length,
  };
}
