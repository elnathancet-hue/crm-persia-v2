"use server";

// AI Agent — flow CRUD (PR-FLOW-PIVOT PR 3, mai/2026).
//
// Server actions consumidas pelo FlowCanvas (canvas visual @xyflow/react)
// via DI da @persia/ai-agent-ui. CRM aplica requireRole("admin") porque
// editar flow muda o comportamento do agente — só admin+ deve fazer.
//
// Backlog #3 Auditoria (mai/2026): saveFlow agora suporta CAS optimistic
// locking via parametro `expectedVersion`. Quando passado, o UPDATE so
// ocorre se a row no DB ainda tem essa versao. Em caso de conflito
// (outro admin salvou primeiro), retorna shape `{ ok: false, conflict: ... }`
// pro caller mostrar modal de "recarregue antes de salvar". Endereca
// rodada 9 #3 do POST_CODEX_AUDIT — antes era last-write-wins
// silencioso, admin perdia edicoes sem aviso.

import { revalidatePath } from "next/cache";
import type { FlowConfig } from "@persia/shared/ai-agent";
import { normalizeFlowConfig } from "@persia/shared/ai-agent";
import { asAgentDb } from "@/lib/ai-agent/db";
import { loadFlowByConfigId } from "@/lib/ai-agent/flow/loader";
import { agentPaths, requireAgentRole } from "./utils";

export interface SaveFlowSuccess {
  ok: true;
  version: number;
}

export interface SaveFlowConflict {
  ok: false;
  conflict: true;
  expected_version: number;
  current_version: number;
}

export type SaveFlowResult = SaveFlowSuccess | SaveFlowConflict;

/**
 * Lê o flow_config de um agente. Retorna null quando o agente foi criado
 * via API sem template e ainda não tem flow — UI exibe canvas vazio com
 * dica de "arraste a primeira tarefa".
 *
 * Backlog #3 (mai/2026): retorna tambem a `version` corrente. Canvas
 * armazena pra passar como `expectedVersion` no saveFlow — CAS optimistic
 * locking detecta admins concorrentes que editaram entre o load e o save.
 */
export async function getFlow(
  configId: string,
): Promise<{ config: FlowConfig; version: number } | null> {
  const { supabase, orgId } = await requireAgentRole("agent");
  const db = asAgentDb(supabase);
  const flow = await loadFlowByConfigId(db, orgId, configId);
  if (!flow) return null;
  return { config: flow.config, version: flow.version };
}

/**
 * Persiste o flow_config (nodes + edges + viewport + enabled_tools).
 * Usa upsert por agent_config_id (UNIQUE constraint) — primeira chamada
 * insere, próximas atualizam. Incrementa version.
 *
 * Backlog #3 (mai/2026): CAS optimistic locking. Quando `expectedVersion`
 * e passado, UPDATE so prossegue se a row no DB ainda tem essa version.
 * Conflito retorna `{ ok: false, conflict: true }` em vez de jogar — UI
 * decide se mostra modal pedindo reload ou tenta merge.
 *
 * Backwards-compat: se `expectedVersion` for omitido, comportamento antigo
 * (last-write-wins). Necessario pra clients antigos que ainda nao foram
 * atualizados.
 *
 * Aplica normalizeFlowConfig antes de salvar pra blindar contra payload
 * malformado vindo do client.
 */
export async function saveFlow(
  configId: string,
  config: FlowConfig,
  expectedVersion?: number,
): Promise<SaveFlowResult> {
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

    // Backlog #3: CAS check. Se caller passou expectedVersion e ela
    // nao bate com a versao atual no DB, e conflito — outro admin
    // salvou entre o load do canvas e este save.
    if (
      expectedVersion !== undefined &&
      expectedVersion !== currentVersion
    ) {
      return {
        ok: false,
        conflict: true,
        expected_version: expectedVersion,
        current_version: currentVersion,
      };
    }

    const nextVersion = currentVersion + 1;
    // CAS no UPDATE: predicate `version = currentVersion` previne race
    // window EXTRA — mesmo com o check acima, outro admin pode salvar
    // ENTRE o SELECT da `existing` e este UPDATE. Postgres garante
    // atomicidade do UPDATE; ROW_COUNT=0 = perdeu a race.
    const { error: updateError, count } = await db
      .from("agent_flows")
      .update({
        nodes: normalized.nodes,
        edges: normalized.edges,
        viewport: normalized.viewport,
        enabled_tools: normalized.enabled_tools,
        version: nextVersion,
      }, { count: "exact" })
      .eq("organization_id", orgId)
      .eq("agent_config_id", configId)
      .eq("version", currentVersion);
    if (updateError) {
      throw new Error(`Falha ao salvar fluxo: ${updateError.message}`);
    }

    if (count === 0) {
      // Race-window perdida: outro UPDATE pegou primeiro. Refetch pra
      // reportar a versao real ao caller.
      const { data: refetched } = await db
        .from("agent_flows")
        .select("version")
        .eq("organization_id", orgId)
        .eq("agent_config_id", configId)
        .maybeSingle();
      const liveVersion = (refetched as { version?: number } | null)?.version ?? currentVersion;
      return {
        ok: false,
        conflict: true,
        expected_version: expectedVersion ?? currentVersion,
        current_version: liveVersion,
      };
    }

    for (const path of agentPaths(configId)) revalidatePath(path);
    return { ok: true, version: nextVersion };
  }

  // Caminho de INSERT (primeira vez). CAS nao se aplica — sem versao
  // anterior pra checar.
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
