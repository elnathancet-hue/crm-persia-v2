"use server";

// AI Agent — flow CRUD (PR-FLOW-PIVOT PR 3, mai/2026).
//
// Server actions consumidas pelo FlowCanvas (canvas visual @xyflow/react)
// via DI da @persia/ai-agent-ui. CRM aplica requireRole("admin") porque
// editar flow muda o comportamento do agente — só admin+ deve fazer.

import { revalidatePath } from "next/cache";
import type { FlowConfig } from "@persia/shared/ai-agent";
import { normalizeFlowConfig } from "@persia/shared/ai-agent";
import { asAgentDb } from "@/lib/ai-agent/db";
import { loadFlowByConfigId } from "@/lib/ai-agent/flow/loader";
import { agentPaths, requireAgentRole } from "./utils";

/**
 * Lê o flow_config de um agente. Retorna null quando o agente foi criado
 * via API sem template e ainda não tem flow — UI exibe canvas vazio com
 * dica de "arraste a primeira tarefa".
 */
export async function getFlow(configId: string): Promise<FlowConfig | null> {
  const { supabase, orgId } = await requireAgentRole("agent");
  const db = asAgentDb(supabase);
  const flow = await loadFlowByConfigId(db, orgId, configId);
  return flow ? flow.config : null;
}

/**
 * Persiste o flow_config (nodes + edges + viewport + enabled_tools).
 * Usa upsert por agent_config_id (UNIQUE constraint) — primeira chamada
 * insere, próximas atualizam. Incrementa version (optimistic locking
 * leve — V1 sem CAS, conflict resolution é "last write wins").
 *
 * Aplica normalizeFlowConfig antes de salvar pra blindar contra payload
 * malformado vindo do client.
 */
export async function saveFlow(
  configId: string,
  config: FlowConfig,
): Promise<{ ok: true; version: number }> {
  const { supabase, orgId } = await requireAgentRole("admin");
  const db = asAgentDb(supabase);

  // Confere que o agent_config pertence à org (defesa contra IDOR).
  const { data: agentConfig, error: configError } = await db
    .from("agent_configs")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", configId)
    .maybeSingle();
  if (configError || !agentConfig) {
    throw new Error("Agente não encontrado");
  }

  const normalized = normalizeFlowConfig(config);

  // Tenta UPDATE primeiro (rows existentes); se ninguém atualizou, INSERT.
  // upsert nativo não está sendo usado porque o agent_flows tem trigger
  // de updated_at que precisa preservar created_at.
  const { data: existing } = await db
    .from("agent_flows")
    .select("id, version")
    .eq("organization_id", orgId)
    .eq("agent_config_id", configId)
    .maybeSingle();

  if (existing) {
    const currentVersion = (existing as { version: number }).version;
    const nextVersion = currentVersion + 1;
    const { error: updateError } = await db
      .from("agent_flows")
      .update({
        nodes: normalized.nodes,
        edges: normalized.edges,
        viewport: normalized.viewport,
        enabled_tools: normalized.enabled_tools,
        version: nextVersion,
      })
      .eq("organization_id", orgId)
      .eq("agent_config_id", configId);
    if (updateError) {
      throw new Error(`Falha ao salvar fluxo: ${updateError.message}`);
    }
    for (const path of agentPaths(configId)) revalidatePath(path);
    return { ok: true, version: nextVersion };
  }

  const { error: insertError } = await db.from("agent_flows").insert({
    organization_id: orgId,
    agent_config_id: configId,
    nodes: normalized.nodes,
    edges: normalized.edges,
    viewport: normalized.viewport,
    enabled_tools: normalized.enabled_tools,
    version: 1,
  });
  if (insertError) {
    throw new Error(`Falha ao criar fluxo: ${insertError.message}`);
  }
  for (const path of agentPaths(configId)) revalidatePath(path);
  return { ok: true, version: 1 };
}
