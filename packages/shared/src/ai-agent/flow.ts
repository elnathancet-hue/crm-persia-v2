// AI Agent — modelo de Flow (canvas visual via @xyflow/react).
//
// PR-FLOW-PIVOT (mai/2026): substitui o modelo antigo de stages lineares
// + auto_actions por etapa por um GRAFO. O fluxo é o cérebro do agente —
// IA vira UM node entre vários (entrada, ações, condicionais). Cliente
// desenha as garantias operacionais como linhas visuais; runtime emite
// eventos quando IA chama tools e segue edges deterministicamente.
//
// Mata os bugs #7/#8 da arquitetura anterior (IA "esquecia" de chamar
// transfer_to_stage ou alucinava "agendei" sem create_appointment): aqui
// a IA só precisa chamar a tool, o flow garante o resto via edges.
//
// Migração 054 cria a tabela agent_flows (1 row por agent_config) com
// nodes/edges/viewport/enabled_tools JSONB. Este módulo define:
//   - Discriminated union FlowNode (entry | ai_agent | action | condition)
//   - FlowEdge (handle nomeado no source pra branching)
//   - FlowConfig (top-level shape persistido)
//   - Helpers de normalização + defensive parsing do JSONB

import type { NativeHandlerName } from "./types";

// ============================================================================
// Tipos de nó — discriminated union por `type`
// ============================================================================

export type FlowNodeType = "entry" | "ai_agent" | "action" | "condition";

/**
 * Posição no canvas (coords em px). React Flow trabalha em float.
 */
export interface FlowNodePosition {
  x: number;
  y: number;
}

/**
 * Campos comuns a todos os nodes. React Flow exige `{id, type, position,
 * data}` — alinhamos com o contrato deles pra reuso direto.
 */
interface FlowNodeBase {
  /** UUID gerado client-side (React Flow exige string ID estável). */
  id: string;
  type: FlowNodeType;
  position: FlowNodePosition;
}

// ----------------------------------------------------------------------------
// Node: Entry — gatilho de início do flow
// ----------------------------------------------------------------------------
// PR-FLOW-PIVOT PR 10 (mai/2026): 4 tipos de gatilho de entrada, paridade
// com o flow.json do Jordan Moura (Humana Saúde):
//   - conversation_started: primeira mensagem do lead (V1 — funcional)
//   - keyword_match: mensagem do lead contém palavra-chave específica
//     (V1 — funcional, avaliado no enqueue)
//   - segment_entered: lead entra em segmentação salva (V1 — placeholder
//     visual, runtime exige hook no segment evaluator do CRM, PR 11)
//   - pipeline_stage_entered: lead/deal muda pra stage específica (V1 —
//     placeholder visual, runtime exige hook no Kanban, PR 11)

export type FlowEntryTrigger =
  | "conversation_started"
  | "keyword_match"
  | "segment_entered"
  | "pipeline_stage_entered";

export interface FlowEntryNode extends FlowNodeBase {
  type: "entry";
  data: {
    label: string;
    trigger: FlowEntryTrigger;
    /** Payload específico do trigger. Shape:
     *  - conversation_started: {} (sem config)
     *  - keyword_match: { keywords: string[] } (1+ termos; match
     *    case-insensitive via `includes`)
     *  - segment_entered: { segment_id: string }
     *  - pipeline_stage_entered: { stage_id: string } */
    config?: Record<string, unknown>;
  };
}

// ----------------------------------------------------------------------------
// Node: AI Agent — onde a IA conversa
// ----------------------------------------------------------------------------
// Cada AI node tem N "instruções" — texto livre que a IA vê no prompt + um
// `output_handle` nomeado. Cliente conecta visualmente uma edge saindo de
// cada handle pra um node alvo (action ou condition). Quando a IA aciona
// a instrução (via tool call ou marca semântica), runtime segue a edge.

export interface FlowAIInstruction {
  /** UUID local — identifica a instrução dentro do node. */
  id: string;
  /** Texto que a IA vê no system_prompt. Ex: "Quando coletar os 4 dados". */
  description: string;
  /** Nome do output handle no React Flow. Ex: "lead_qualificado". Deve
   * ser único dentro do node. */
  output_handle: string;
}

export interface FlowAIAgentNode extends FlowNodeBase {
  type: "ai_agent";
  data: {
    label: string;
    /** System prompt principal da IA neste node. */
    system_prompt: string;
    /** Override de modelo (default vem de agent_configs.model). */
    model?: string;
    /** Instruções com handles nomeados — definem branches deterministicos. */
    instructions: FlowAIInstruction[];
  };
}

// ----------------------------------------------------------------------------
// Node: Action — ação determinística (não passa pela IA)
// ----------------------------------------------------------------------------
// Disparada quando uma edge entra. action_type mapeia 1:1 com handlers
// nativos do runtime (add_tag, move_pipeline_stage, etc). config é o
// payload tipado por action_type — runtime valida defensivamente.

export type FlowActionType =
  | "add_tag"
  | "remove_tag"
  | "move_pipeline_stage"
  | "create_appointment"
  | "trigger_notification"
  | "send_media"
  | "stop_agent"
  | "transfer_to_user"
  | "transfer_to_agent"
  // PR-FLOW-PIVOT PR 8 (mai/2026): IA escreve em lead_custom_field_values.
  // Action node (não via IA): runtime resolve field_key via config.
  | "set_lead_custom_field"
  // PR-FLOW-PIVOT PR 9 (mai/2026): action node envia texto WhatsApp
  // determinístico SEM passar pela IA. config: { message: string } com
  // placeholders {{lead.name}}/phone/email.
  | "send_whatsapp_message"
  // PR-FLOW-PIVOT PR 13 (mai/2026): distribui lead pra um atendente
  // humano via algoritmo least-loaded. config: {} (V1 sem filtros —
  // todos os membros assignable da org são candidatos). Paridade com
  // queue/round-robin do flow.json do Jordan.
  | "round_robin_user";

/**
 * Mapeia FlowActionType pra NativeHandlerName quando aplicável. Alguns
 * tipos novos (`remove_tag`) ainda não existem em NATIVE_HANDLERS — serão
 * adicionados nos PRs subsequentes do pivot.
 */
export interface FlowActionNode extends FlowNodeBase {
  type: "action";
  data: {
    label: string;
    action_type: FlowActionType;
    /** Payload específico do action_type. Shape valida na aplicação
     * (não no DB) pra evitar CHECK constraints frágeis em discriminated
     * unions. */
    config: Record<string, unknown>;
  };
}

// ----------------------------------------------------------------------------
// Node: Condition — verificação Sim/Não que ramifica o flow
// ----------------------------------------------------------------------------
// Cada condition node tem 2 handles de saída fixos: "yes" e "no". Runtime
// avalia condition_type + config contra estado do lead/conversation e
// segue a edge correspondente.

export type FlowConditionType =
  | "has_tag"
  | "lead_custom_field_equals"
  | "in_segment";

export interface FlowConditionNode extends FlowNodeBase {
  type: "condition";
  data: {
    label: string;
    condition_type: FlowConditionType;
    config: Record<string, unknown>;
  };
}

// ----------------------------------------------------------------------------
// Union de todos os nodes
// ----------------------------------------------------------------------------

export type FlowNode =
  | FlowEntryNode
  | FlowAIAgentNode
  | FlowActionNode
  | FlowConditionNode;

// ============================================================================
// Edges — conectam handles entre nodes
// ============================================================================

export interface FlowEdge {
  /** UUID gerado client-side. */
  id: string;
  /** Node ID origem. */
  source: string;
  /** Node ID destino. */
  target: string;
  /** Nome do handle de saída no source. Pra AI node = instrução output_handle.
   * Pra condition node = "yes" | "no". Pra entry/action node = "default" (1 saída). */
  sourceHandle: string;
  /** Handle de entrada no target. Default "in" — V1 usa entrada única por node. */
  targetHandle?: string;
}

// ============================================================================
// Viewport — pan/zoom persistido
// ============================================================================

export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

// ============================================================================
// Top-level FlowConfig — shape persistido em agent_flows
// ============================================================================

export interface FlowConfig {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: FlowViewport;
  /** Allowlist de agent_tools.id que a IA pode chamar em TODO o flow.
   * V2 pode adicionar override por AI node. */
  enabled_tools: string[];
}

export const DEFAULT_FLOW_VIEWPORT: FlowViewport = Object.freeze({
  x: 0,
  y: 0,
  zoom: 1,
});

export const DEFAULT_FLOW_CONFIG: FlowConfig = Object.freeze({
  nodes: [],
  edges: [],
  viewport: { ...DEFAULT_FLOW_VIEWPORT },
  enabled_tools: [],
});

// ============================================================================
// Defensive parsing — normaliza JSONB lido do DB
// ============================================================================
//
// Mesmo padrão de normalizeStageActionConfig: runtime nunca quebra com
// shape corrompido. Inválidos são descartados; defaults preenchem campos
// faltantes.

const MAX_NODES_PER_FLOW = 200;
const MAX_EDGES_PER_FLOW = 500;
const MAX_INSTRUCTIONS_PER_AI_NODE = 20;
const MAX_LABEL_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_SYSTEM_PROMPT_LENGTH = 20000;
const MAX_HANDLE_NAME_LENGTH = 80;
const MAX_ENABLED_TOOLS = 50;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function trimToMax(value: unknown, max: number): string {
  if (!isString(value)) return "";
  return value.slice(0, max);
}

function normalizePosition(raw: unknown): FlowNodePosition {
  if (!raw || typeof raw !== "object") return { x: 0, y: 0 };
  const obj = raw as Record<string, unknown>;
  const x = typeof obj.x === "number" && Number.isFinite(obj.x) ? obj.x : 0;
  const y = typeof obj.y === "number" && Number.isFinite(obj.y) ? obj.y : 0;
  return { x, y };
}

function normalizeViewport(raw: unknown): FlowViewport {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_FLOW_VIEWPORT };
  const obj = raw as Record<string, unknown>;
  const x = typeof obj.x === "number" && Number.isFinite(obj.x) ? obj.x : 0;
  const y = typeof obj.y === "number" && Number.isFinite(obj.y) ? obj.y : 0;
  const zoom =
    typeof obj.zoom === "number" && Number.isFinite(obj.zoom) && obj.zoom > 0
      ? obj.zoom
      : 1;
  return { x, y, zoom };
}

function normalizeInstruction(raw: unknown): FlowAIInstruction | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!isString(obj.id) || obj.id.length === 0) return null;
  const description = trimToMax(obj.description, MAX_DESCRIPTION_LENGTH);
  const output_handle = trimToMax(obj.output_handle, MAX_HANDLE_NAME_LENGTH);
  if (output_handle.length === 0) return null;
  return { id: obj.id, description, output_handle };
}

function normalizeNode(raw: unknown): FlowNode | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!isString(obj.id) || obj.id.length === 0) return null;
  if (!isString(obj.type)) return null;
  const position = normalizePosition(obj.position);
  const dataRaw = (obj.data ?? {}) as Record<string, unknown>;
  const label = trimToMax(dataRaw.label, MAX_LABEL_LENGTH);

  switch (obj.type) {
    case "entry": {
      // PR 10 (mai/2026): 4 triggers válidos. Default fallback pra
      // "conversation_started" se shape vier corrompido.
      const validTriggers: readonly FlowEntryTrigger[] = [
        "conversation_started",
        "keyword_match",
        "segment_entered",
        "pipeline_stage_entered",
      ];
      const trigger = (validTriggers as readonly string[]).includes(
        dataRaw.trigger as string,
      )
        ? (dataRaw.trigger as FlowEntryTrigger)
        : "conversation_started";
      const config =
        dataRaw.config && typeof dataRaw.config === "object" && !Array.isArray(dataRaw.config)
          ? (dataRaw.config as Record<string, unknown>)
          : {};
      return {
        id: obj.id,
        type: "entry",
        position,
        data: { label, trigger, config },
      };
    }
    case "ai_agent": {
      const system_prompt = trimToMax(dataRaw.system_prompt, MAX_SYSTEM_PROMPT_LENGTH);
      const model = isString(dataRaw.model) ? dataRaw.model : undefined;
      const rawInstructions = Array.isArray(dataRaw.instructions)
        ? dataRaw.instructions
        : [];
      const instructions: FlowAIInstruction[] = [];
      for (const item of rawInstructions) {
        if (instructions.length >= MAX_INSTRUCTIONS_PER_AI_NODE) break;
        const i = normalizeInstruction(item);
        if (i) instructions.push(i);
      }
      return {
        id: obj.id,
        type: "ai_agent",
        position,
        data: {
          label,
          system_prompt,
          ...(model ? { model } : {}),
          instructions,
        },
      };
    }
    case "action": {
      if (!isString(dataRaw.action_type)) return null;
      const action_type = dataRaw.action_type as FlowActionType;
      const config =
        dataRaw.config && typeof dataRaw.config === "object" && !Array.isArray(dataRaw.config)
          ? (dataRaw.config as Record<string, unknown>)
          : {};
      return {
        id: obj.id,
        type: "action",
        position,
        data: { label, action_type, config },
      };
    }
    case "condition": {
      if (!isString(dataRaw.condition_type)) return null;
      const condition_type = dataRaw.condition_type as FlowConditionType;
      const config =
        dataRaw.config && typeof dataRaw.config === "object" && !Array.isArray(dataRaw.config)
          ? (dataRaw.config as Record<string, unknown>)
          : {};
      return {
        id: obj.id,
        type: "condition",
        position,
        data: { label, condition_type, config },
      };
    }
    default:
      return null;
  }
}

function normalizeEdge(raw: unknown): FlowEdge | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (
    !isString(obj.id) ||
    !isString(obj.source) ||
    !isString(obj.target) ||
    !isString(obj.sourceHandle)
  ) {
    return null;
  }
  const edge: FlowEdge = {
    id: obj.id,
    source: obj.source,
    target: obj.target,
    sourceHandle: trimToMax(obj.sourceHandle, MAX_HANDLE_NAME_LENGTH),
  };
  if (isString(obj.targetHandle) && obj.targetHandle.length > 0) {
    edge.targetHandle = trimToMax(obj.targetHandle, MAX_HANDLE_NAME_LENGTH);
  }
  return edge;
}

function normalizeEnabledTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= MAX_ENABLED_TOOLS) break;
    if (!isString(item) || item.length === 0) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Normaliza FlowConfig completo do JSONB. Sempre retorna shape válido,
 * mesmo se raw vier malformado. Nodes/edges inválidos são descartados
 * silenciosamente (defensive — runtime não quebra por config corrompida).
 */
export function normalizeFlowConfig(raw: {
  nodes?: unknown;
  edges?: unknown;
  viewport?: unknown;
  enabled_tools?: unknown;
}): FlowConfig {
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];

  const nodes: FlowNode[] = [];
  for (const item of rawNodes) {
    if (nodes.length >= MAX_NODES_PER_FLOW) break;
    const node = normalizeNode(item);
    if (node) nodes.push(node);
  }

  const validNodeIds = new Set(nodes.map((n) => n.id));

  const edges: FlowEdge[] = [];
  for (const item of rawEdges) {
    if (edges.length >= MAX_EDGES_PER_FLOW) break;
    const edge = normalizeEdge(item);
    if (!edge) continue;
    // Descarta edges com referências quebradas — não temos como executar.
    if (!validNodeIds.has(edge.source) || !validNodeIds.has(edge.target)) continue;
    edges.push(edge);
  }

  return {
    nodes,
    edges,
    viewport: normalizeViewport(raw.viewport),
    enabled_tools: normalizeEnabledTools(raw.enabled_tools),
  };
}

// ============================================================================
// Helpers de query do grafo (usados por runtime + UI)
// ============================================================================

/**
 * Retorna o node de entrada (type='entry'). Flow válido deve ter
 * exatamente 1 — UI valida antes de salvar. Runtime tolera 0 (no-op)
 * ou múltiplos (pega o primeiro determinístico).
 */
export function findEntryNode(flow: FlowConfig): FlowEntryNode | null {
  for (const node of flow.nodes) {
    if (node.type === "entry") return node;
  }
  return null;
}

/**
 * Retorna todas as edges saindo de um node específico, opcionalmente
 * filtradas por sourceHandle. Usado pelo runtime pra decidir próximos
 * nodes a executar.
 */
export function findOutgoingEdges(
  flow: FlowConfig,
  sourceNodeId: string,
  sourceHandle?: string,
): FlowEdge[] {
  return flow.edges.filter(
    (e) =>
      e.source === sourceNodeId &&
      (sourceHandle === undefined || e.sourceHandle === sourceHandle),
  );
}

/**
 * Retorna nodes alvo das edges saindo de (sourceNodeId, sourceHandle).
 * Helper composto pra runtime executar branches.
 */
export function findNextNodes(
  flow: FlowConfig,
  sourceNodeId: string,
  sourceHandle: string,
): FlowNode[] {
  const edges = findOutgoingEdges(flow, sourceNodeId, sourceHandle);
  const targetIds = new Set(edges.map((e) => e.target));
  return flow.nodes.filter((n) => targetIds.has(n.id));
}

/**
 * Lookup de node por ID. O(N) — flows V1 raramente passam de ~30 nodes.
 * Se virar gargalo, runtime pode construir Map<id, node> uma vez por
 * execução.
 */
export function getNodeById(flow: FlowConfig, nodeId: string): FlowNode | null {
  return flow.nodes.find((n) => n.id === nodeId) ?? null;
}

// ============================================================================
// Bridge: NativeHandlerName ↔ FlowActionType
// ============================================================================
//
// FlowActionType é a label da UI ("add_tag") e NativeHandlerName é a
// label do runtime — coincidem 1:1 quando o handler já existe. Tipos
// novos (`remove_tag`) ainda não estão em NATIVE_HANDLERS; serão
// adicionados quando o runtime PR (#2) implementar o handler.

export function flowActionTypeToNativeHandler(
  actionType: FlowActionType,
): NativeHandlerName | null {
  // Tipos com handler nativo equivalente
  const direct: Record<string, NativeHandlerName> = {
    add_tag: "add_tag",
    move_pipeline_stage: "move_pipeline_stage",
    create_appointment: "create_appointment",
    trigger_notification: "trigger_notification",
    send_media: "send_media",
    stop_agent: "stop_agent",
    transfer_to_user: "transfer_to_user",
    transfer_to_agent: "transfer_to_agent",
    set_lead_custom_field: "set_lead_custom_field",
    // `send_whatsapp_message` (PR 9) NÃO mapeia: é tratado por
    // special-case no runner (emite send_text via FlowProviderStub em
    // vez de chamar handler nativo).
    round_robin_user: "round_robin_user",
  };
  return direct[actionType] ?? null;
}

// ============================================================================
// PR-FLOW-PIVOT PR 10 (mai/2026): Helpers de entry trigger evaluation
// ============================================================================
//
// Runtime usa pra decidir se uma inbound message dispara o flow. Cada
// trigger tem semantica distinta de fonte de evento:
//   - conversation_started: sempre dispara em qualquer msg inbound
//   - keyword_match: dispara se inbound contém alguma palavra-chave
//   - segment_entered / pipeline_stage_entered: NÃO disparam por msg
//     inbound — exigem hook do CRM (segment evaluator, kanban). V1 marca
//     como "não suportado" e o runtime cai pro pipeline legacy (sem flow).

/**
 * Avalia se uma mensagem inbound dispara o flow com base no entry trigger.
 *
 * @returns true = enfileira normalmente; false = skip (flow não escuta
 *   essa fonte de evento ou keyword não casou)
 */
export function shouldTriggerFlowFromInbound(
  entry: FlowEntryNode,
  inboundText: string,
): boolean {
  const trigger = entry.data.trigger;
  if (trigger === "conversation_started") return true;

  if (trigger === "keyword_match") {
    const config = entry.data.config ?? {};
    const keywords = Array.isArray(config.keywords)
      ? (config.keywords as unknown[]).filter(
          (k): k is string => typeof k === "string" && k.trim().length > 0,
        )
      : [];
    if (keywords.length === 0) return false; // sem keywords cadastradas, nunca dispara
    const normalized = inboundText.toLowerCase();
    return keywords.some((kw) => normalized.includes(kw.toLowerCase()));
  }

  // segment_entered / pipeline_stage_entered — não dispara por inbound
  // (esses eventos vêm de fora do pipeline WhatsApp).
  return false;
}
