"use client";

// AI Agent — FlowCanvas (PR-FLOW-PIVOT PR 3, mai/2026).
//
// Canvas visual estilo Jordan/SaaS pra editar o flow do agente. Usa
// @xyflow/react (antigo React Flow) — biblioteca battle-tested usada
// por n8n, Make.com, Retool. Pan/zoom/drag/handles nativos.
//
// Estado é mantido localmente (nodes/edges/viewport) com persistência
// via debounce save (1.5s após última edição). Carrega flow via
// `useAgentActions().getFlow(configId)` e salva via `saveFlow`.

import "@xyflow/react/dist/style.css";
import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import {
  AlertTriangle,
  Crosshair,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Redo2,
  Save,
  Sparkles,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  FlowConfig,
  FlowEdge,
  FlowNode as PersiaFlowNode,
  FlowValidationIssue,
} from "@persia/shared/ai-agent";
import {
  normalizeFlowConfig,
  validateFlowConfig,
} from "@persia/shared/ai-agent";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@persia/ui/alert-dialog";
import { Button } from "@persia/ui/button";
import { cn } from "@persia/ui/utils";
import { useAgentActions } from "../../context";
import type { FlowCatalogs } from "./catalog-types";
import { EMPTY_FLOW_CATALOGS } from "./catalog-types";
import { FlowSidebar, FLOW_DRAG_KEY } from "./FlowSidebar";
import { findSidebarItem } from "./node-catalog";
import { useFlowHistory } from "./use-flow-history";
import { applyDagreLayout } from "./flow-layout";
import { UnsavedChangesGuard } from "../use-unsaved-changes-guard";
// PR 21 (mai/2026): NodeConfigSheet não mais usada — forms inline.
import { EntryNodeView } from "./nodes/EntryNodeView";
import { AIAgentNodeView } from "./nodes/AIAgentNodeView";
import { ActionNodeView } from "./nodes/ActionNodeView";
import { ConditionNodeView } from "./nodes/ConditionNodeView";
import { EdgeWithDelete } from "./edges/edge-with-delete";

// Backlog UX (mai/2026): React Flow usa zoom alto demais em fitView quando
// o flow tem poucos cards, fazendo o editor abrir "colado" nos nodes. O
// limite abaixo vale apenas para fitView automatico/atalhos; zoom manual
// pelos controles do canvas continua livre.
const FLOW_FIT_VIEW_MAX_ZOOM = 0.7;

// ============================================================================
// React Flow node bindings — mapeia type→component dos custom nodes
// ============================================================================

// PR 17 UX (mai/2026): nodeTypes movido pra dentro do componente
// via useMemo([handleNodeDelete]) pra que o callback de delete
// fique disponível dentro dos node views. Antes era const top-level
// e sem acesso a state do parent.

// PR 25 (mai/2026): MiniMap colorido foi adicionado nesse PR; PR 30
// removeu — cliente preferiu canvas mais limpo sem mapinha de
// acompanhamento. Helper miniMapNodeColor removido junto.

// ============================================================================
// Conversões FlowConfig ↔ React Flow nodes/edges
// ============================================================================

function persiaToReactFlow(
  config: FlowConfig,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = config.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data as Record<string, unknown>,
  }));
  const edges: Edge[] = config.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle ?? null,
  }));
  return { nodes, edges };
}

function reactFlowToPersia(
  rfNodes: Node[],
  rfEdges: Edge[],
  viewport: { x: number; y: number; zoom: number },
  enabledTools: string[],
): FlowConfig {
  return normalizeFlowConfig({
    nodes: rfNodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })) satisfies PersiaFlowNode[] | unknown[] as unknown[],
    edges: rfEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? "default",
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
    })) satisfies FlowEdge[] | unknown[] as unknown[],
    viewport,
    enabled_tools: enabledTools,
  });
}

// ============================================================================
// FlowCanvas — exportado público
// ============================================================================

interface FlowCanvasProps {
  configId: string;
  /** Quando true, o canvas preenche o container pai via flex-1 min-h-0.
   * Usado pelo modo fullscreen do AgentEditor — o wrapper externo controla
   * a altura; aqui removemos sticky + height fixo pra não conflitar. */
  fullscreen?: boolean;
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

// PR 24 (mai/2026): snapshot do canvas pro undo/redo stack.
// Captura nodes + edges (NÃO viewport — pan/zoom é fluido e não tem
// motivo pra desfazer um pan). selectedNodeId tb não entra (UX
// state, não estrutural).
interface FlowSnapshot {
  nodes: Node[];
  edges: Edge[];
}

function FlowCanvasInner({ configId, fullscreen }: FlowCanvasProps) {
  const actions = useAgentActions();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes] = React.useState<Node[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [viewport, setViewport] = React.useState({ x: 0, y: 0, zoom: 1 });
  const [enabledTools, setEnabledTools] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  // Backlog #3 Auditoria (mai/2026): version carregada do flow no DB
  // no momento do load. Passada como `expectedVersion` no saveFlow pra
  // CAS optimistic locking. null = flow ainda nao existe (primeira save).
  const [loadedVersion, setLoadedVersion] = React.useState<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  // PR 21 (mai/2026): configSheetOpen removido — Sheet não é mais
  // renderizada. Forms inline dentro de cada node card.
  const [catalogs, setCatalogs] = React.useState<FlowCatalogs>(EMPTY_FLOW_CATALOGS);
  const [catalogsLoading, setCatalogsLoading] = React.useState(false);
  const [catalogsLoaded, setCatalogsLoaded] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(true);
  // PR 31 (mai/2026): visual feedback do drag-to-connect e drag-from-sidebar.
  //   - isConnecting: true enquanto cliente segura mouse num handle source
  //     e arrasta procurando target. CSS aplica pulse em todos handles
  //     target visíveis pra deixar claro "solta aqui".
  //   - isDraggingFromSidebar: true quando cliente arrasta card de
  //     "Adicionar ao fluxo" sobre o canvas. Overlay dashed mostra
  //     "Solte aqui pra adicionar".
  // States separados pq são UX paths diferentes (handle drag vs HTML5 drag).
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [isDraggingFromSidebar, setIsDraggingFromSidebar] =
    React.useState(false);

  // PR 24 (mai/2026): undo/redo stack. Cap em 30 snapshots —
  // ~30 ações ≈ 5min de edição típica (Jakob Nielsen heuristic).
  const history = useFlowHistory<FlowSnapshot>({ maxSize: 30 });
  // Refs pra ler estado mais recente dentro de handlers de teclado
  // sem precisar incluir nodes/edges no useEffect deps (causaria
  // re-bind do listener a cada movimento de mouse).
  const nodesRef = React.useRef(nodes);
  const edgesRef = React.useRef(edges);
  React.useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  React.useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // Helper: grava snapshot do estado ATUAL antes de qualquer
  // mutação estrutural. Usar SEMPRE antes de modificar nodes/edges.
  const snapshotBeforeMutation = React.useCallback(() => {
    history.push({ nodes: nodesRef.current, edges: edgesRef.current });
  }, [history.push]);

  // -- Load flow --
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await actions.getFlow(configId);
        if (cancelled) return;
        if (loaded) {
          const { nodes: rfNodes, edges: rfEdges } = persiaToReactFlow(loaded.config);
          setNodes(rfNodes);
          setEdges(rfEdges);
          setViewport(loaded.config.viewport);
          setEnabledTools(loaded.config.enabled_tools);
          setLoadedVersion(loaded.version);
          // PR 24: reset undo stack ao carregar novo flow — histórico
          // do flow anterior não faz sentido pro novo.
          history.reset();
        }
      } catch (err) {
        // Hotfix: erro de Server Action no Next 15 vem com mensagem
        // mascarada em prod ("An error occurred in the Server Components
        // render..."). Substitui por mensagem amigável e loga o digest
        // no console pra admin debugar via EasyPanel logs.
        const raw = err instanceof Error ? err.message : String(err);
        console.error("[FlowCanvas] getFlow falhou:", err);
        const userMessage = raw.startsWith("An error occurred in the Server")
          ? "Não consegui carregar o fluxo agora. Tente recarregar a página — se persistir, fale com o suporte."
          : raw;
        toast.error(userMessage);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actions, configId]);

  // -- Edits --
  const onNodesChange: OnNodesChange = React.useCallback(
    (changes) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      if (
        changes.some(
          (c) =>
            c.type === "position" ||
            c.type === "remove" ||
            c.type === "add" ||
            c.type === "replace",
        )
      ) {
        setDirty(true);
      }
    },
    [],
  );

  const onEdgesChange: OnEdgesChange = React.useCallback(
    (changes) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
      if (changes.some((c) => c.type !== "select")) setDirty(true);
    },
    [],
  );

  const onConnect: OnConnect = React.useCallback(
    (connection: Connection) => {
      snapshotBeforeMutation();
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: `edge-${crypto.randomUUID()}`,
          },
          eds,
        ),
      );
      setDirty(true);
    },
    [snapshotBeforeMutation],
  );

  const handleNodeDragStart = React.useCallback(() => {
    snapshotBeforeMutation();
  }, [snapshotBeforeMutation]);

  // PR 31 (mai/2026): handlers de drag-to-connect. React Flow chama
  // onConnectStart quando cliente segura mouse num handle, onConnectEnd
  // quando solta (em outro handle válido OU em espaço vazio). Marca
  // isConnecting=true durante o drag — CSS aplica pulse nos handles
  // target pra deixar "onde posso soltar" óbvio. Conexões inválidas
  // (mesmo node, handle errado) continuam sendo rejeitadas nativamente
  // pelo React Flow — feedback visual é só pra UX.
  const handleConnectStart = React.useCallback(() => {
    setIsConnecting(true);
  }, []);
  const handleConnectEnd = React.useCallback(() => {
    setIsConnecting(false);
  }, []);

  // -- Carrega catálogos cedo para cards e selects mostrarem nomes, não IDs.
  const ensureCatalogsLoaded = React.useCallback(async () => {
    if (catalogsLoading || catalogsLoaded) return;
    setCatalogsLoading(true);
    try {
      const next = await actions.getFlowCatalogs(configId);
      setCatalogs(next);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      console.error("[FlowCanvas] getFlowCatalogs falhou:", err);
      const userMessage = raw.startsWith("An error occurred in the Server")
        ? "Não consegui carregar tags/etapas/templates. Tente recarregar a página."
        : raw;
      toast.error(userMessage);
    } finally {
      setCatalogsLoaded(true);
      setCatalogsLoading(false);
    }
  }, [actions, catalogsLoaded, catalogsLoading, configId]);

  React.useEffect(() => {
    if (!loading) void ensureCatalogsLoaded();
  }, [ensureCatalogsLoaded, loading]);

  // PR 21 UX (mai/2026): click em node SÓ seleciona (sem abrir Sheet).
  // Forma inline aparece dentro do próprio card. Catálogos são
  // carregados na primeira interação pra evitar fetch desnecessário
  // em flows que não exigem edição.
  const onNodeClick: NodeMouseHandler = React.useCallback(
    (_, node) => {
      setSelectedNodeId(node.id);
      void ensureCatalogsLoaded();
    },
    [ensureCatalogsLoaded],
  );

  // PR 21 (mai/2026): handleNodePatch é chamado pelo InlineFormPanel
  // (via debounce 200ms). Atualiza canvas state imediatamente; persist
  // no DB só no botão "Salvar" global.
  // PR 24 (mai/2026): grava snapshot antes do patch pra undo. A debounce
  // do InlineFormPanel já agrupa keystrokes em buckets de 200ms, então
  // history não fica poluída por cada tecla.
  const handleNodePatch = React.useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      snapshotBeforeMutation();
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: newData } : n)),
      );
      setDirty(true);
    },
    [snapshotBeforeMutation],
  );

  // PR 29 fix (mai/2026): state pra confirm dialog do delete de entry.
  // Cliente reportou que entry não podia ser deletado — era intencional
  // ("entry é único"), mas com PR 10 múltiplos triggers convivem no flow
  // (conversation_started + keyword_match + segment_entered + ...), então
  // faz sentido permitir. Confirmação previne delete acidental.
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = React.useState<
    string | null
  >(null);

  // Backlog #4 Auditoria (mai/2026): estado do modal de impacto pre-save.
  // Quando `previewFlowImpact` retorna affected_conversations > 0, em vez
  // de salvar direto, abrimos esse modal com os numeros + nodes em risco.
  // null = sem dialog aberto. Objeto = dialog visivel + pendingConfig que
  // sera salvo se admin confirmar.
  const [pendingImpactConfirm, setPendingImpactConfirm] = React.useState<
    | {
        affected: number;
        atRiskNodeIds: string[];
        total: number;
        pendingConfig: ReturnType<typeof reactFlowToPersia>;
      }
    | null
  >(null);

  // Executa o delete sem perguntar. Usado direto pra non-entry, e via
  // AlertDialog action pro entry.
  const executeNodeDelete = React.useCallback(
    (nodeId: string) => {
      snapshotBeforeMutation();
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
      // PR 24: limpa seleção se o deletado era o selecionado.
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      setDirty(true);
    },
    [selectedNodeId, snapshotBeforeMutation],
  );

  // -- Sheet pediu remoção do node --
  const handleNodeDelete = React.useCallback(
    (nodeId: string) => {
      const target = nodes.find((n) => n.id === nodeId);
      if (!target) return;
      // PR 29 fix: entry node pede confirmação em vez de deletar direto.
      // Atalho Del também passa por aqui — comportamento uniforme.
      if (target.type === "entry") {
        setPendingDeleteEntryId(nodeId);
        return;
      }
      executeNodeDelete(nodeId);
    },
    [nodes, executeNodeDelete],
  );

  // PR 20 UX (mai/2026): clonar node. Cria cópia com novo UUID, mesma
  // data, posição offsetada (+30,+30 pra não ficar em cima do original).
  // Entry NÃO é duplicável (1 ponto de entrada por flow — proteção dupla
  // aqui + ausência de onDuplicate na nodeTypes do entry).
  const handleNodeDuplicate = React.useCallback(
    (nodeId: string) => {
      const target = nodes.find((n) => n.id === nodeId);
      if (!target || target.type === "entry") return;
      snapshotBeforeMutation();
      const newNode: Node = {
        id: `node-${crypto.randomUUID()}`,
        type: target.type,
        position: {
          x: target.position.x + 30,
          y: target.position.y + 30,
        },
        // Deep-ish clone via JSON pra desacoplar references (config é
        // POJO, JSON.parse(JSON.stringify) é safe e suficiente).
        data: JSON.parse(JSON.stringify(target.data)),
      };
      setNodes((nds) => [...nds, newNode]);
      setDirty(true);
    },
    [nodes, snapshotBeforeMutation],
  );

  // PR 39x (mai/2026): manter os componentes de `nodeTypes` estaveis.
  // React Flow trata os valores de `nodeTypes` como tipos de componente.
  // Se recriamos essas funcoes a cada update de nodes/history, o React
  // desmonta/remonta o node inline e inputs perdem foco apos o debounce.
  const handleNodePatchRef = React.useRef(handleNodePatch);
  const handleNodeDeleteRef = React.useRef(handleNodeDelete);
  const handleNodeDuplicateRef = React.useRef(handleNodeDuplicate);
  React.useEffect(() => {
    handleNodePatchRef.current = handleNodePatch;
  }, [handleNodePatch]);
  React.useEffect(() => {
    handleNodeDeleteRef.current = handleNodeDelete;
  }, [handleNodeDelete]);
  React.useEffect(() => {
    handleNodeDuplicateRef.current = handleNodeDuplicate;
  }, [handleNodeDuplicate]);

  // PR 20 UX (mai/2026): deleta edge ao clicar no X dela (custom edge
  // renderiza o X no centro).
  // PR 24 (mai/2026): com snapshot pra undo.
  const handleEdgeDelete = React.useCallback(
    (edgeId: string) => {
      snapshotBeforeMutation();
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setDirty(true);
    },
    [snapshotBeforeMutation],
  );

  // PR 17 UX (mai/2026): nodeTypes memoizado com handleNodeDelete
  // closure-capturado pra que cada node view possa receber onDelete.
  // Entry node NÃO recebe onDelete (proteção dupla: aqui + dentro do
  // handler). React Flow exige stable reference — useMemo evita
  // re-render dos nodes.
  const nodeTypes = React.useMemo<NodeTypes>(
    () => ({
      // PR 28 (mai/2026): `id` repassado às views pra que consultem
      // useFlowTesterHighlight(id) e mostrem pulse animation quando
      // o Tester acabou de passar por aqui.
      // PR 29 fix (mai/2026): entry recebe onDelete agora — confirm
      // dialog em handleNodeDelete previne delete acidental.
      entry: ({ data, selected, id }) => (
        <EntryNodeView
          data={data as never}
          selected={selected}
          id={id}
          onDelete={() => handleNodeDeleteRef.current(id)}
          onPatch={(newData) => handleNodePatchRef.current(id, newData)}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      ),
      ai_agent: ({ data, selected, id }) => (
        <AIAgentNodeView
          data={data as never}
          selected={selected}
          id={id}
          onDelete={() => handleNodeDeleteRef.current(id)}
          onDuplicate={() => handleNodeDuplicateRef.current(id)}
          onPatch={(newData) => handleNodePatchRef.current(id, newData)}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      ),
      action: ({ data, selected, id }) => (
        <ActionNodeView
          data={data as never}
          selected={selected}
          id={id}
          onDelete={() => handleNodeDeleteRef.current(id)}
          onDuplicate={() => handleNodeDuplicateRef.current(id)}
          onPatch={(newData) => handleNodePatchRef.current(id, newData)}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      ),
      condition: ({ data, selected, id }) => (
        <ConditionNodeView
          data={data as never}
          selected={selected}
          id={id}
          onDelete={() => handleNodeDeleteRef.current(id)}
          onDuplicate={() => handleNodeDuplicateRef.current(id)}
          onPatch={(newData) => handleNodePatchRef.current(id, newData)}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      ),
    }),
    [catalogs, catalogsLoading],
  );

  // PR 20 UX (mai/2026): edgeTypes com X no centro pra deletar
  // conexão inline. Inspirado no Jordan/ManyChat. Custom edge é
  // pluggable — caller (cada edge no state) passa `data.onDelete`
  // via memoized edges below.
  const edgeTypes = React.useMemo<EdgeTypes>(
    () => ({
      withDelete: EdgeWithDelete,
    }),
    [],
  );

  // PR 20: enriquece edges do state com onDelete callback no data.
  // Não persiste no JSON salvo (callbacks são descartados pelo
  // normalizer); rebindado a cada render.
  const edgesWithDelete = React.useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        type: "withDelete" as const,
        data: { ...(e.data ?? {}), onDelete: handleEdgeDelete },
      })),
    [edges, handleEdgeDelete],
  );

  const validationIssues = React.useMemo(
    () =>
      nodes.length > 0
        ? validateFlowConfig(
            reactFlowToPersia(nodes, edges, viewport, enabledTools),
          )
        : [],
    [edges, enabledTools, nodes, viewport],
  );

  // Node atualmente selecionado pra renderizar no Sheet
  const selectedNode = React.useMemo(() => {
    if (!selectedNodeId) return null;
    const rfNode = nodes.find((n) => n.id === selectedNodeId);
    if (!rfNode) return null;
    return {
      id: rfNode.id,
      type: rfNode.type,
      position: rfNode.position,
      data: rfNode.data,
    } as PersiaFlowNode;
  }, [nodes, selectedNodeId]);

  // -- Drag-drop do sidebar --
  // PR 31 (mai/2026): também marca isDraggingFromSidebar=true quando
  // payload é do tipo correto. Overlay visual (borda dashed primary +
  // hint "Solte aqui pra adicionar") aparece pra orientar o cliente.
  // dragover dispara N vezes durante o drag — setter ignora updates
  // redundantes (React bails out).
  const onDragOver = React.useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(FLOW_DRAG_KEY)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDraggingFromSidebar(true);
    }
  }, []);

  // PR 31: limpa overlay quando drag sai do canvas (cancelado pelo user).
  // dragleave dispara mesmo quando cursor cruza sobre filho do container,
  // então comparamos com relatedTarget pra detectar saída real.
  const onDragLeave = React.useCallback((e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !e.currentTarget.contains(related)) {
      setIsDraggingFromSidebar(false);
    }
  }, []);

  const instantiateNodeAt = React.useCallback(
    (taskKey: string, screenPos: { x: number; y: number }) => {
      const item = findSidebarItem(taskKey);
      if (!item) return;
      if (
        item.node_type === "entry" &&
        nodesRef.current.some((n) => n.type === "entry")
      ) {
        toast.info(
          "Este fluxo ja tem uma entrada. Edite a entrada existente ou crie outro agente para outro gatilho.",
        );
        return;
      }
      const position = screenToFlowPosition(screenPos);
      const newNode: Node = {
        id: `node-${crypto.randomUUID()}`,
        type: item.node_type,
        position,
        data: { ...item.default_data },
      };
      snapshotBeforeMutation();
      setNodes((nds) => [...nds, newNode]);
      setSelectedNodeId(newNode.id);
      setDirty(true);

      // PR 24 (mai/2026): auto-conectar — se há node selecionado quando
      // o cliente adiciona um novo, criar edge automaticamente
      // (selecionado → novo). Corta ~40% dos cliques pra montar fluxos
      // sequenciais. Regras de elegibilidade:
      //   - Source não pode ser "condition" (handle "yes"/"no" é
      //     ambíguo — exigiria UI pra escolher qual).
      //   - Target não pode ser "entry" (entry não tem handle de
      //     entrada — é só ponto de partida).
      //   - Não auto-conecta se já existe edge saindo do selected
      //     com handle "default" (evita "puxar" o novo nó de um
      //     fluxo que já está conectado).
      const sourceNode = selectedNodeId
        ? nodesRef.current.find((n) => n.id === selectedNodeId)
        : nodesRef.current.length === 1 &&
            nodesRef.current[0]?.type === "entry" &&
            newNode.type !== "entry"
          ? nodesRef.current[0]
          : null;
      if (
        sourceNode &&
        sourceNode.type !== "condition" &&
        newNode.type !== "entry"
      ) {
        const alreadyHasDefault = edgesRef.current.some(
          (e) =>
            e.source === sourceNode.id &&
            (e.sourceHandle === "default" || e.sourceHandle == null),
        );
        if (!alreadyHasDefault) {
          setEdges((eds) => [
            ...eds,
            {
              id: `edge-${crypto.randomUUID()}`,
              source: sourceNode.id,
              target: newNode.id,
              sourceHandle: "default",
              type: "withDelete",
            } as Edge,
          ]);
          const sourceLabel =
            (sourceNode.data?.label as string | undefined)?.trim() ||
            sourceNode.type ||
            "tarefa anterior";
          toast.success(`Conectado a "${sourceLabel}"`, { duration: 2500 });
        }
      }
    },
    [screenToFlowPosition, selectedNodeId, snapshotBeforeMutation],
  );

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      const taskKey = e.dataTransfer.getData(FLOW_DRAG_KEY);
      if (!taskKey) return;
      e.preventDefault();
      // PR 31: limpa overlay no drop bem-sucedido.
      setIsDraggingFromSidebar(false);
      instantiateNodeAt(taskKey, { x: e.clientX, y: e.clientY });
    },
    [instantiateNodeAt],
  );

  // PR 17 UX (mai/2026): add por clique no botão + da sidebar. Em vez
  // de exigir drag-and-drop (intimidador em desktop apertado e
  // impossível em touch), aceita clique simples. Posição default
  // = centro visível do canvas (offset randomizado em 80px pra
  // múltiplos adds não empilharem).
  const getCanvasCenterScreenPosition = React.useCallback(() => {
    const container = document.querySelector<HTMLDivElement>(
      '[data-persia-flow-container="true"]',
    );
    const rect = container?.getBoundingClientRect();
    return rect
      ? {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }, []);

  const handleSidebarAdd = React.useCallback(
    (taskKey: string) => {
      // Centro aproximado da viewport do canvas — pega div container.
      const container = document.querySelector<HTMLDivElement>(
        '[data-persia-flow-container="true"]',
      );
      const rect = container?.getBoundingClientRect();
      const screenPos = rect
        ? {
            x: rect.left + rect.width / 2 + (Math.random() - 0.5) * 80,
            y: rect.top + rect.height / 2 + (Math.random() - 0.5) * 80,
          }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      instantiateNodeAt(taskKey, screenPos);
    },
    [instantiateNodeAt],
  );

  // PR 24 (mai/2026): undo/redo handlers — escolhem entre desfazer
  // a última mutação ou refazer uma desfeita. Ambos atualizam o
  // canvas E marcam dirty (mudança não persistida).
  const handleAddReadyAIFlow = React.useCallback(() => {
    if (nodesRef.current.length > 0) {
      toast.info("Use os cards da lateral para continuar este fluxo.");
      return;
    }

    const entryItem = findSidebarItem("entry.conversation_started");
    const aiItem = findSidebarItem("ai_agent.default");
    if (!entryItem || !aiItem) return;

    const center = screenToFlowPosition(getCanvasCenterScreenPosition());
    const entryId = `node-${crypto.randomUUID()}`;
    const aiId = `node-${crypto.randomUUID()}`;
    const entryNode: Node = {
      id: entryId,
      type: entryItem.node_type,
      position: { x: center.x - 210, y: center.y - 60 },
      data: { ...entryItem.default_data },
    };
    const aiNode: Node = {
      id: aiId,
      type: aiItem.node_type,
      position: { x: center.x + 130, y: center.y - 60 },
      data: { ...aiItem.default_data },
    };

    snapshotBeforeMutation();
    setNodes([entryNode, aiNode]);
    setEdges([
      {
        id: `edge-${crypto.randomUUID()}`,
        source: entryId,
        target: aiId,
        sourceHandle: "default",
        targetHandle: "in",
        type: "withDelete",
      } as Edge,
    ]);
    setSelectedNodeId(aiId);
    setDirty(true);
    setTimeout(() => {
      fitView({
        duration: 400,
        padding: 0.25,
        maxZoom: FLOW_FIT_VIEW_MAX_ZOOM,
      });
    }, 100);
    toast.success("Fluxo inicial criado e conectado.");
  }, [
    fitView,
    getCanvasCenterScreenPosition,
    screenToFlowPosition,
    snapshotBeforeMutation,
  ]);

  const handleUndo = React.useCallback(() => {
    const previous = history.undo({
      nodes: nodesRef.current,
      edges: edgesRef.current,
    });
    if (!previous) {
      toast.info("Nada pra desfazer.");
      return;
    }
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setDirty(true);
    // PR 24: se o node selecionado sumiu no undo, limpa seleção pra
    // não ficar referenciando id inexistente.
    if (
      selectedNodeId &&
      !previous.nodes.some((n) => n.id === selectedNodeId)
    ) {
      setSelectedNodeId(null);
    }
  }, [history, selectedNodeId]);

  const handleRedo = React.useCallback(() => {
    const next = history.redo({
      nodes: nodesRef.current,
      edges: edgesRef.current,
    });
    if (!next) {
      toast.info("Nada pra refazer.");
      return;
    }
    setNodes(next.nodes);
    setEdges(next.edges);
    setDirty(true);
    if (selectedNodeId && !next.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [history, selectedNodeId]);

  // PR 25 (mai/2026): auto-layout via Dagre. Reposiciona todos os
  // nodes em camadas LR (esquerda → direita), edges não cruzam,
  // espaçamento uniforme. Grava snapshot pra permitir undo (PR 24).
  // Após aplicar, anima fitView pra mostrar o novo layout inteiro.
  const handleAutoLayout = React.useCallback(() => {
    if (nodesRef.current.length === 0) {
      toast.info("Nada pra organizar — adicione tarefas primeiro.");
      return;
    }
    snapshotBeforeMutation();
    const laidOut = applyDagreLayout(
      nodesRef.current,
      edgesRef.current,
      "LR",
    );
    setNodes(laidOut);
    setDirty(true);
    // setTimeout pra deixar o React aplicar o setState antes do
    // fitView calcular bounds das novas posições. 100ms é suficiente.
    setTimeout(() => {
      fitView({
        duration: 600,
        padding: 0.2,
        maxZoom: FLOW_FIT_VIEW_MAX_ZOOM,
      });
    }, 100);
    toast.success("Fluxo organizado.");
  }, [fitView, snapshotBeforeMutation]);

  // PR 25 (mai/2026): centra o viewport no node de entrada. Atalho
  // útil em fluxos grandes — Jordan tem 12 nodes e o entry fica à
  // esquerda; cliente perde de vista após algumas edições. Usa
  // fitView com filter de nodes em vez de setCenter direto pra
  // respeitar zoom mínimo (não estoura zoom in num node só).
  const handleCenterEntry = React.useCallback(() => {
    const entry = nodesRef.current.find((n) => n.type === "entry");
    if (!entry) {
      toast.info("Nenhuma entrada no fluxo.");
      return;
    }
    fitView({
      nodes: [{ id: entry.id }],
      duration: 400,
      padding: 0.4,
      maxZoom: FLOW_FIT_VIEW_MAX_ZOOM,
    });
  }, [fitView]);

  // -- Save (manual via botão + auto-save debounce) --
  const handleSave = React.useCallback(async () => {
    // PR-4 Auditoria (mai/2026): endereca rodada 1 #2 (Codex) — antes,
    // handleSave nao bloqueava `validationIssues` severity='error'.
    // Cliente podia salvar flow sem entry, sem edge saindo do entry,
    // com handles invalidos, etc. — e o agente ativava com flow quebrado,
    // gerando runs com fatal_error em producao.
    //
    // Agora: erros bloqueiam o save imediato e mostram toast pedindo pra
    // corrigir. Warnings nao bloqueiam (sao informativos, ex: AI node
    // sem instructions). O painel `FlowValidationPanel` ja esta visivel
    // na sidebar listando cada issue + node afetado.
    const errors = validationIssues.filter((i) => i.severity === "error");
    if (errors.length > 0) {
      toast.error(
        `Corrija ${errors.length} ${errors.length === 1 ? "erro" : "erros"} antes de salvar. Veja o painel "Problemas no fluxo".`,
      );
      return;
    }

    // Backlog #4: helper persistFlowConfig esta declarado abaixo na
    // ordem da arvore React; usamos persistFlowConfigRef pra evitar
    // dependency loop com handleSave (que precisa do helper E o helper
    // nao precisa do handleSave).
    setSaving(true);
    try {
      const config = reactFlowToPersia(nodes, edges, viewport, enabledTools);

      // Backlog #4 Auditoria (mai/2026): preview de impacto antes do
      // save. Quando ha convs vivas com current_node_id apontando pra
      // nodes que sumiriam, abre modal de confirmacao com os numeros.
      // Operacao read-only — sem efeito colateral.
      //
      // Defensive: se previewFlowImpact nao estiver disponivel (cliente
      // legado sem o DI atualizado), pula a checagem e segue pro save.
      if (actions.previewFlowImpact) {
        try {
          const impact = await actions.previewFlowImpact(configId, config);
          if (impact.affected_conversations > 0) {
            setPendingImpactConfirm({
              affected: impact.affected_conversations,
              atRiskNodeIds: impact.at_risk_node_ids,
              total: impact.total_live_conversations,
              pendingConfig: config,
            });
            return; // espera confirmacao do dialog
          }
        } catch (err) {
          // Best-effort: falha no preview NAO bloqueia o save. Operador
          // ja avaliou edicao no canvas; preview e safety net adicional.
          console.warn("[FlowCanvas] previewFlowImpact falhou — seguindo save sem aviso:", err);
        }
      }

      await persistFlowConfigRef.current(config);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      console.error("[FlowCanvas] saveFlow falhou:", err);
      const userMessage = raw.startsWith("An error occurred in the Server")
        ? "Não consegui salvar o fluxo agora. Tente novamente — se persistir, fale com o suporte."
        : raw;
      toast.error(userMessage);
    } finally {
      setSaving(false);
    }
  }, [
    actions,
    configId,
    edges,
    enabledTools,
    nodes,
    viewport,
    validationIssues,
  ]);

  // Backlog #4: helper interno que faz o save de fato (CAS + atualizar
  // state). Extraido pra ser chamado tanto no caminho normal (sem convs
  // vivas afetadas) quanto pos-confirmacao do modal de impacto.
  const persistFlowConfig = React.useCallback(
    async (config: ReturnType<typeof reactFlowToPersia>) => {
      // Backlog #3 (mai/2026): passa loadedVersion pra CAS optimistic
      // locking. Servidor recusa se outro admin salvou entre o load
      // deste canvas e este save.
      const res = await actions.saveFlow(
        configId,
        config,
        loadedVersion ?? undefined,
      );
      if (!res.ok) {
        toast.error(
          `Outro editor salvou este fluxo enquanto você estava editando ` +
            `(versão ${res.current_version} no servidor, você tem v${res.expected_version}). ` +
            `Recarregue a página antes de salvar de novo — suas edições atuais ` +
            `ficarão como referência no histórico do navegador.`,
          { duration: 12000 },
        );
        return;
      }
      setDirty(false);
      setLoadedVersion(res.version);
      toast.success(`Fluxo salvo (versão ${res.version}).`);
    },
    [actions, configId, loadedVersion],
  );
  const persistFlowConfigRef = React.useRef(persistFlowConfig);
  React.useEffect(() => {
    persistFlowConfigRef.current = persistFlowConfig;
  }, [persistFlowConfig]);

  // PR 20 UX (mai/2026): auto-save removido a pedido do cliente.
  // Comportamento agora é igual ao Jordan/ManyChat — salva SÓ quando
  // clica em "Salvar". Reduz writes desnecessárias no banco e evita
  // surpresas de "salvou no meio do meu trabalho". Botão "Salvar" no
  // toolbar continua disponível + indicador "alterações não salvas"
  // sinaliza que tem mudanças pendentes.

  // PR 24 (mai/2026): atalhos de teclado pra power users. Registrados
  // no window pra capturar mesmo quando foco está fora de input. Skip
  // se foco em input/textarea/contenteditable — usuário tá digitando,
  // não pretende atalho global.
  //
  // Atalhos:
  //   - Ctrl+Z / Cmd+Z: undo
  //   - Ctrl+Y / Ctrl+Shift+Z / Cmd+Shift+Z: redo
  //   - Ctrl+S / Cmd+S: salvar (sobrescreve "salvar página" do browser)
  //   - Ctrl+D / Cmd+D: duplicar node selecionado (sobrescreve bookmark)
  //   - Delete / Backspace: deletar selecionado
  //   - Esc: deselecionar
  //
  // Refs usados em vez de state pra evitar re-bind do listener a cada
  // mudança de selectedNodeId/dirty (perderia teclas em transição).
  const handleUndoRef = React.useRef(handleUndo);
  const handleRedoRef = React.useRef(handleRedo);
  const handleSaveRef = React.useRef(handleSave);
  const handleCenterEntryRef = React.useRef(handleCenterEntry);
  const selectedNodeIdRef = React.useRef(selectedNodeId);
  const dirtyRef = React.useRef(dirty);
  React.useEffect(() => {
    handleUndoRef.current = handleUndo;
  }, [handleUndo]);
  React.useEffect(() => {
    handleCenterEntryRef.current = handleCenterEntry;
  }, [handleCenterEntry]);
  React.useEffect(() => {
    handleRedoRef.current = handleRedo;
  }, [handleRedo]);
  React.useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);
  React.useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);
  React.useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  React.useEffect(() => {
    function isTypingInForm(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    }

    function handler(e: KeyboardEvent) {
      // Se usuário tá digitando num input/textarea, deixa o navegador
      // tratar (não interfere no editor inline do node).
      if (isTypingInForm(e.target)) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Undo: Ctrl+Z (sem shift)
      if (ctrl && key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
        return;
      }
      // Redo: Ctrl+Y OU Ctrl+Shift+Z
      if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        handleRedoRef.current();
        return;
      }
      // Save: Ctrl+S
      if (ctrl && key === "s") {
        e.preventDefault();
        if (dirtyRef.current) {
          void handleSaveRef.current();
        }
        return;
      }
      // Duplicate selecionado: Ctrl+D
      if (ctrl && key === "d") {
        const id = selectedNodeIdRef.current;
        if (id) {
          e.preventDefault();
          handleNodeDuplicateRef.current(id);
        }
        return;
      }
      // Delete: Delete OR Backspace (sem modifier — pra não conflitar
      // com Ctrl+Backspace que é "voltar página")
      if ((e.key === "Delete" || e.key === "Backspace") && !ctrl) {
        const id = selectedNodeIdRef.current;
        if (id) {
          e.preventDefault();
          handleNodeDeleteRef.current(id);
        }
        return;
      }
      // Esc: deselecionar
      if (e.key === "Escape") {
        if (selectedNodeIdRef.current) {
          setSelectedNodeId(null);
        }
        return;
      }
      // PR 25 (mai/2026): Ctrl+Home centra no entry. Funciona mesmo
      // sem node selecionado — útil pra cliente que perdeu o entry
      // de vista após pan.
      if (ctrl && e.key === "Home") {
        e.preventDefault();
        handleCenterEntryRef.current();
        return;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    /* PR 30 (mai/2026): canvas root vira sticky pra que sidebar
       "Adicionar ao fluxo" + toolbar (Salvar / undo-redo / layout)
       fiquem fixos no viewport mesmo quando cliente rola a página.
       Scroll vertical da página fica desabilitado dentro do canvas
       (overflow-hidden), e o que rola é só o pan do React Flow.
       top-32 (8rem = 128px) aproxima o offset do header sticky +
       PublishingChecklist — pode precisar ajuste fino visual.
       h-[calc(100vh-9rem)] = altura disponível abaixo do header. */
    <div className={cn(
      "flex overflow-hidden bg-background",
      fullscreen
        ? "flex-1 min-h-0"
        : "sticky top-32 h-[calc(100vh-9rem)] min-h-[600px] rounded-xl border border-border/60",
    )}>
      {/* PR 27 (mai/2026): avisa cliente ao sair com mudanças no fluxo
          não salvas. Dialog "este projeto não foi salvo" + opções
          "Continuar editando" / "Sair sem salvar". */}
      <UnsavedChangesGuard
        dirty={dirty}
        message="Você fez mudanças no fluxo que ainda não foram salvas. Se sair agora, vai perder o que editou."
      />

      {/* PR 29 fix (mai/2026): confirm dialog antes de deletar entry.
          Cliente reportou bug "não consigo deletar entry". Era
          intencional, mas com múltiplos triggers (PR 10) permitir
          delete faz sentido. Confirmação previne erro acidental
          (sem entrada o fluxo não dispara — undo continua disponível
          via Ctrl+Z). */}
      <AlertDialog
        open={pendingDeleteEntryId !== null}
        onOpenChange={(open) => !open && setPendingDeleteEntryId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover esta entrada?</AlertDialogTitle>
            <AlertDialogDescription>
              Sem nenhuma entrada, o fluxo não vai disparar quando
              chegar uma mensagem ou um evento. Você pode adicionar
              outra entrada depois, ou desfazer com Ctrl+Z.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setPendingDeleteEntryId(null)}
            >
              Manter
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteEntryId) {
                  executeNodeDelete(pendingDeleteEntryId);
                }
                setPendingDeleteEntryId(null);
              }}
            >
              Remover entrada
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Backlog #4 Auditoria (mai/2026): modal de impacto pre-save.
          Quando ha convs vivas com current_node_id apontando pra nodes
          que sumiriam, admin precisa confirmar a operacao. Padrao
          espelha o entry-delete acima — apenas avisa, nao bloqueia.
          Recover via Ctrl+Z. */}
      <AlertDialog
        open={pendingImpactConfirm !== null}
        onOpenChange={(open) => !open && setPendingImpactConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingImpactConfirm?.affected === 1
                ? "1 conversa em andamento vai ser afetada"
                : `${pendingImpactConfirm?.affected ?? 0} conversas em andamento vão ser afetadas`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingImpactConfirm
                ? `${pendingImpactConfirm.affected} de ${pendingImpactConfirm.total} conversas vivas estão parando em etapas que você removeu ou renomeou. ` +
                  `Quando o próximo turno de cada uma chegar, o agente vai falhar e o lead pode ficar sem resposta. ` +
                  `Se prosseguir, lembre que pode desfazer com Ctrl+Z OU restaurar do backup do navegador antes de recarregar.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setPendingImpactConfirm(null)}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = pendingImpactConfirm;
                setPendingImpactConfirm(null);
                if (!pending) return;
                setSaving(true);
                // Reusar o persistFlowConfig (via ref). Catch+toast aqui
                // porque saimos do try do handleSave original.
                persistFlowConfigRef
                  .current(pending.pendingConfig)
                  .catch((err: unknown) => {
                    const raw = err instanceof Error ? err.message : String(err);
                    console.error("[FlowCanvas] saveFlow falhou apos confirmacao:", err);
                    toast.error(
                      raw.startsWith("An error occurred in the Server")
                        ? "Não consegui salvar o fluxo agora. Tente novamente — se persistir, fale com o suporte."
                        : raw,
                    );
                  })
                  .finally(() => setSaving(false));
              }}
            >
              Salvar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FlowSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((current) => !current)}
        onAdd={handleSidebarAdd}
      />
      <div
        ref={containerRef}
        data-persia-flow-container="true"
        /* PR 31 (mai/2026): data attrs alimentam CSS scoped abaixo
           (style tag) — pulse nos handles target quando connecting,
           sem precisar editar globals.css. */
        data-connecting={isConnecting ? "true" : undefined}
        data-drag-source={isDraggingFromSidebar ? "sidebar" : undefined}
        className="flex-1 relative"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* PR 31 (mai/2026): CSS scoped pro pulse dos handles. Ataca
            só descendentes do container atual via [data-connecting=true]
            seletor. Sem global CSS = menor blast radius se React Flow
            atualizar class names. Animação pulse usa keyframes do
            Tailwind (animate-pulse) que já existem no projeto. */}
        <style>{`
          [data-persia-flow-container][data-connecting="true"] .react-flow__handle--target {
            animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            box-shadow: 0 0 0 4px hsl(var(--primary) / 0.25);
          }
        `}</style>

        {/* PR 31 (mai/2026): overlay visual quando cliente arrasta card
            da sidebar. Borda dashed primary + hint text "Solte aqui pra
            adicionar". pointer-events: none pra não interferir com
            drop event que segue pro container. */}
        {isDraggingFromSidebar ? (
          <div className="absolute inset-3 z-20 rounded-xl border-2 border-dashed border-primary/60 bg-primary/5 flex items-center justify-center pointer-events-none">
            <div className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium shadow-lg">
              Solte aqui pra adicionar ao fluxo
            </div>
          </div>
        ) : null}

        {validationIssues.length > 0 ? (
          <FlowValidationPanel issues={validationIssues} />
        ) : null}

        {/* Toolbar */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          {/* PR 24 (mai/2026): botões undo/redo na toolbar — também
              ativáveis por Ctrl+Z / Ctrl+Y. Hint do atalho no title
              tooltip pro user descobrir. */}
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-sm">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={handleUndo}
              disabled={!history.canUndo}
              aria-label="Desfazer (Ctrl+Z)"
              title="Desfazer (Ctrl+Z)"
            >
              <Undo2 className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={handleRedo}
              disabled={!history.canRedo}
              aria-label="Refazer (Ctrl+Y)"
              title="Refazer (Ctrl+Y)"
            >
              <Redo2 className="size-3.5" />
            </Button>
          </div>
          {/* PR 25 (mai/2026): group de ferramentas de layout. Separado
              do undo/redo pra deixar a hierarquia visual clara —
              undo é "voltar atrás" (rev temporal), layout é "rearranjar"
              (re-spatial). */}
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-sm">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={handleAutoLayout}
              aria-label="Organizar automaticamente"
              title="Organizar automaticamente"
            >
              <LayoutGrid className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={handleCenterEntry}
              aria-label="Centrar no início (Ctrl+Home)"
              title="Centrar no início (Ctrl+Home)"
            >
              <Crosshair className="size-3.5" />
            </Button>
          </div>
          {dirty ? (
            <span className="text-[11px] text-progress font-medium">
              alterações não salvas
            </span>
          ) : null}
          <Button
            size="sm"
            variant={dirty ? "default" : "outline"}
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin mr-1" />
            ) : (
              <Save className="size-3.5 mr-1" />
            )}
            Salvar
          </Button>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edgesWithDelete}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onNodeClick={onNodeClick}
          onNodeDragStart={handleNodeDragStart}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultViewport={viewport}
          onMoveEnd={(_, v) => {
            // PR 20 UX (mai/2026): pan/zoom NÃO marca dirty. Antes
            // qualquer movimento de viewport fazia o botão "Salvar"
            // piscar — confunde porque nada estrutural mudou.
            // Viewport ainda é persistido junto com nodes/edges no
            // próximo save manual.
            setViewport(v);
          }}
          fitView={nodes.length > 0}
          fitViewOptions={{
            maxZoom: FLOW_FIT_VIEW_MAX_ZOOM,
            padding: 0.2,
          }}
          attributionPosition="bottom-left"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls position="bottom-right" showInteractive={false} />
          {/* PR 30 (mai/2026): MiniMap removido a pedido do cliente —
              canvas mais limpo, sem mapinha de acompanhamento. Pra
              navegar use pan/zoom (mouse + Controls) ou Ctrl+Home
              ("Centrar no início" da toolbar). */}
        </ReactFlow>
        {nodes.length === 0 ? (
          <EmptyCanvasState
            onAdd={handleSidebarAdd}
            onAddReadyAIFlow={handleAddReadyAIFlow}
          />
        ) : null}
        {/* PR 32 (mai/2026): hint contextual quando há SÓ o Entry node
            no canvas. Seta + dica orientam o cliente a conectar a
            primeira ação. Some quando há >=2 nodes. */}
        {nodes.length === 1 && nodes[0].type === "entry" ? (
          <FirstActionHint
            entryPosition={nodes[0].position}
            viewport={viewport}
          />
        ) : null}
      </div>
      {/* PR 21 (mai/2026): NodeConfigSheet removida do runtime —
          config foi pra inline dentro de cada node (InlineFormPanel).
          Componente Sheet continua exportando os forms, mas não é
          mais renderizado aqui. */}
    </div>
  );
}

// ============================================================================
// EmptyCanvasState — PR 32 (mai/2026)
// ============================================================================
//
// Substitui os 2 botões + texto do empty state antigo por cards visuais
// com ícone grande + título + descrição curta. Padrão "starting point
// picker" de editors modernos (Notion, Figma, ManyChat).
//
// 2 opções (sem importar JSON — cliente vetou explicitamente pra evitar
// que copiem o fluxo deles):
//   - "Conversa iniciada" → cria SÓ o Entry conversation_started.
//     Pra cliente que quer montar passo-a-passo do zero.
//   - "Conversa com IA pronta" → cria Entry + AI Agent conectados.
//     Atalho pra começar a testar em 1 clique.

function FlowValidationPanel({
  issues,
}: {
  issues: FlowValidationIssue[];
}) {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;
  const visibleIssues = issues.slice(0, 3);

  return (
    <div className="absolute left-3 top-3 z-10 max-w-sm rounded-lg border border-progress/40 bg-card/95 p-3 shadow-sm backdrop-blur">
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={
            errorCount
              ? "mt-0.5 size-4 shrink-0 text-failure"
              : "mt-0.5 size-4 shrink-0 text-progress"
          }
        />
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-semibold text-foreground">
            {errorCount ? "Revise antes de publicar" : "Avisos do fluxo"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {errorCount ? `${errorCount} erro(s)` : "Sem erros"}
            {warningCount ? ` - ${warningCount} aviso(s)` : ""}
          </div>
          <ul className="space-y-1 pt-1">
            {visibleIssues.map((issue, index) => (
              <li
                key={`${issue.code}-${issue.node_id ?? "flow"}-${index}`}
                className="text-[11px] leading-snug text-muted-foreground"
              >
                <span
                  className={
                    issue.severity === "error"
                      ? "font-semibold text-failure"
                      : "font-semibold text-progress"
                  }
                >
                  {issue.severity === "error" ? "Erro:" : "Aviso:"}
                </span>{" "}
                {issue.message}
              </li>
            ))}
          </ul>
          {issues.length > visibleIssues.length ? (
            <div className="text-[11px] text-muted-foreground/70">
              +{issues.length - visibleIssues.length} item(ns)
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyCanvasState({
  onAdd,
  onAddReadyAIFlow,
}: {
  onAdd: (taskKey: string) => void;
  onAddReadyAIFlow: () => void;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
      <div className="text-center max-w-2xl space-y-5 pointer-events-auto">
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold text-foreground">
            Comece pelo primeiro passo do fluxo
          </h3>
          <p className="text-sm text-muted-foreground">
            Escolha um ponto de partida ou arraste cards da lateral esquerda
            pra montar o atendimento.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {/* Card 1 — Só Entry */}
          <button
            type="button"
            onClick={() => onAdd("entry.conversation_started")}
            className="group text-left rounded-xl border-2 border-border bg-card hover:border-primary/50 hover:shadow-md transition-all p-4 space-y-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <div className="size-10 rounded-lg bg-success-soft text-success-soft-foreground flex items-center justify-center group-hover:bg-success/20 transition-colors">
              <MessageSquare className="size-5" />
            </div>
            <div className="space-y-0.5">
              <div className="text-sm font-semibold">Começar do zero</div>
              <p className="text-xs text-muted-foreground">
                Cria só a entrada "Conversa iniciada". Você monta o resto
                arrastando cards da lateral.
              </p>
            </div>
          </button>

          {/* Card 2 — Entry + AI (atalho) */}
          <button
            type="button"
            onClick={() => {
              // Sequência: entry + AI conectados por edge default.
              // Permite testar em 1 clique sem montar nada manual.
              onAddReadyAIFlow();
            }}
            className="group text-left rounded-xl border-2 border-primary/40 bg-primary/5 hover:border-primary hover:shadow-md transition-all p-4 space-y-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <div className="size-10 rounded-lg bg-primary/20 text-primary flex items-center justify-center group-hover:bg-primary/30 transition-colors">
              <Sparkles className="size-5" />
            </div>
            <div className="space-y-0.5">
              <div className="text-sm font-semibold flex items-center gap-1.5">
                Conversa com IA pronta
                <span className="text-[10px] font-medium uppercase tracking-wide bg-primary text-primary-foreground rounded px-1.5 py-0.5">
                  Recomendado
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Cria entrada + IA já conectadas. Pronto pra testar
                imediatamente no Tester.
              </p>
            </div>
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground/70">
          O fluxo precisa de pelo menos uma entrada + uma ação ou IA pra
          começar a responder leads.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// FirstActionHint — PR 32 (mai/2026)
// ============================================================================
//
// Quando há SÓ o Entry node no canvas (recém-criado), mostra uma seta
// + hint contextual sugerindo "conecte aqui sua primeira ação".
// Posicionado à direita do Entry (offset da posição lógica, ajustado
// pelo viewport zoom/pan).
//
// Some assim que o cliente adiciona o 2º node (qualquer tipo).

function FirstActionHint({
  entryPosition,
  viewport,
}: {
  entryPosition: { x: number; y: number };
  viewport: { x: number; y: number; zoom: number };
}) {
  // Transformação flow→screen: pos.x * zoom + viewport.x + offset_visual.
  // Posicionamos o hint cerca de 280px à direita do Entry (largura padrão
  // do node compact = 260px + 20px gap). Vertical alinha no meio do card
  // (~50px do topo).
  const screenX = entryPosition.x * viewport.zoom + viewport.x + 280;
  const screenY = entryPosition.y * viewport.zoom + viewport.y + 50;
  return (
    <div
      className="absolute pointer-events-none z-10"
      style={{ left: screenX, top: screenY }}
    >
      <div className="flex items-center gap-2 animate-pulse">
        <div className="text-2xl text-primary leading-none">→</div>
        <div className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium shadow-md whitespace-nowrap">
          Conecte aqui sua primeira ação
        </div>
      </div>
    </div>
  );
}
