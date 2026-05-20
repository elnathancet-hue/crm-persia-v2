// AI Agent — flow loader.
//
// PR-FLOW-PIVOT PR 2 (mai/2026): lê a row de `agent_flows` referente a um
// agent_config e devolve um `FlowConfig` normalizado (já passa pelo
// `normalizeFlowConfig` do shared, que descarta nodes/edges inválidos e
// preenche defaults). Single-row-per-config (UNIQUE em agent_config_id),
// então a função sempre retorna `null` ou exatamente 1 flow.
//
// PR-FLOW-PIVOT PR 11 (mai/2026): adiciona `loadFlowsByEntryTrigger`
// pra runtime de eventos CRM (stage transition, segment entry) descobrir
// quais flows escutam aquele tipo de gatilho. Usado por
// triggerAgentFlowsForStageEntry pra disparar flows proativos.

import type { FlowConfig, FlowEntryTrigger } from "@persia/shared/ai-agent";
import { findEntryNode, normalizeFlowConfig } from "@persia/shared/ai-agent";
import type { AgentDb } from "../db";

export interface LoadedFlow {
  /** UUID do agent_flows.id (não confundir com agent_config_id). */
  id: string;
  agent_config_id: string;
  organization_id: string;
  config: FlowConfig;
  version: number;
}

/**
 * Carrega o flow de um agente. Retorna `null` quando o agente ainda não
 * tem flow (ex: agente criado antes do template materializar flow_config
 * ou via API sem template). Runtime trata `null` como no-op (agente
 * "vazio").
 *
 * Defensive: usa normalizeFlowConfig pra tolerar JSONB corrompido. Nodes/
 * edges malformados são silenciosamente descartados (logs ficam pro
 * próximo PR — V1 prioriza não quebrar).
 */
export async function loadFlowByConfigId(
  db: AgentDb,
  orgId: string,
  configId: string,
): Promise<LoadedFlow | null> {
  const { data, error } = await db
    .from("agent_flows")
    .select("id, agent_config_id, organization_id, nodes, edges, viewport, enabled_tools, version")
    .eq("organization_id", orgId)
    .eq("agent_config_id", configId)
    .maybeSingle();

  if (error) {
    // Hotfix defensivo: se migration 054 não foi aplicada em prod (tabela
    // não existe), retorna null em vez de throw. UI mostra canvas vazio
    // com a dica de "arraste a primeira tarefa". Log fica pro admin notar
    // que precisa rodar `supabase db push`.
    const msg = error.message ?? "";
    if (
      /relation .*agent_flows.* does not exist/i.test(msg) ||
      /could not find the table/i.test(msg) ||
      msg.includes("PGRST205") // PostgREST table-not-found code
    ) {
      console.warn(
        "[flow-loader] agent_flows table missing — migration 054 pending?",
      );
      return null;
    }
    throw new Error(`Falha ao carregar flow: ${msg}`);
  }
  if (!data) return null;

  const row = data as {
    id: string;
    agent_config_id: string;
    organization_id: string;
    nodes: unknown;
    edges: unknown;
    viewport: unknown;
    enabled_tools: unknown;
    version: number;
  };

  return {
    id: row.id,
    agent_config_id: row.agent_config_id,
    organization_id: row.organization_id,
    version: row.version,
    config: normalizeFlowConfig({
      nodes: row.nodes,
      edges: row.edges,
      viewport: row.viewport,
      enabled_tools: row.enabled_tools,
    }),
  };
}

/**
 * PR-FLOW-PIVOT PR 11 (mai/2026): carrega TODOS os flows da org cujo
 * entry node tem `trigger === triggerType`. Usado por hooks de CRM
 * (stage transition, segment entry) pra descobrir quais agents devem
 * reagir ao evento.
 *
 * Performance: query única em agent_flows JOIN agent_configs (filtra
 * `status='active'`). V1 carrega o JSONB inteiro de cada flow e filtra
 * em JS após normalizeFlowConfig — orgs típicas têm ≤10 agents, custo
 * é desprezível. V2 pode indexar `entry_trigger` num column gerado se
 * necessário.
 *
 * Defensive: silencia falhas de table-missing (igual loadFlowByConfigId)
 * pra evitar derrubar caminho legacy quando migration 054 não rodou.
 */
export async function loadFlowsByEntryTrigger(
  db: AgentDb,
  orgId: string,
  triggerType: FlowEntryTrigger,
): Promise<LoadedFlow[]> {
  const { data, error } = await db
    .from("agent_flows")
    .select(
      "id, agent_config_id, organization_id, nodes, edges, viewport, enabled_tools, version, agent_configs!inner(status)",
    )
    .eq("organization_id", orgId)
    .eq("agent_configs.status", "active");

  if (error) {
    const msg = error.message ?? "";
    if (
      /relation .*agent_flows.* does not exist/i.test(msg) ||
      /could not find the table/i.test(msg) ||
      msg.includes("PGRST205")
    ) {
      return [];
    }
    throw new Error(`Falha ao carregar flows por trigger: ${msg}`);
  }
  if (!data) return [];

  const rows = data as Array<{
    id: string;
    agent_config_id: string;
    organization_id: string;
    nodes: unknown;
    edges: unknown;
    viewport: unknown;
    enabled_tools: unknown;
    version: number;
  }>;

  const out: LoadedFlow[] = [];
  for (const row of rows) {
    const config = normalizeFlowConfig({
      nodes: row.nodes,
      edges: row.edges,
      viewport: row.viewport,
      enabled_tools: row.enabled_tools,
    });
    const entry = findEntryNode(config);
    if (!entry) continue;
    if (entry.data.trigger !== triggerType) continue;
    out.push({
      id: row.id,
      agent_config_id: row.agent_config_id,
      organization_id: row.organization_id,
      version: row.version,
      config,
    });
  }
  return out;
}
