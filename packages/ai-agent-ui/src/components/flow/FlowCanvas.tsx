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
  MiniMap,
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
import { Loader2, Redo2, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type {
  FlowConfig,
  FlowEdge,
  FlowNode as PersiaFlowNode,
} from "@persia/shared/ai-agent";
import { normalizeFlowConfig } from "@persia/shared/ai-agent";
import { Button } from "@persia/ui/button";
import { useAgentActions } from "../../context";
import type { FlowCatalogs } from "./catalog-types";
import { EMPTY_FLOW_CATALOGS } from "./catalog-types";
import { FlowSidebar, FLOW_DRAG_KEY } from "./FlowSidebar";
import { findSidebarItem } from "./node-catalog";
import { useFlowHistory } from "./use-flow-history";
// PR 21 (mai/2026): NodeConfigSheet não mais usada — forms inline.
import { EntryNodeView } from "./nodes/EntryNodeView";
import { AIAgentNodeView } from "./nodes/AIAgentNodeView";
import { ActionNodeView } from "./nodes/ActionNodeView";
import { ConditionNodeView } from "./nodes/ConditionNodeView";
import { EdgeWithDelete } from "./edges/edge-with-delete";

// ============================================================================
// React Flow node bindings — mapeia type→component dos custom nodes
// ============================================================================

// PR 17 UX (mai/2026): nodeTypes movido pra dentro do componente
// via useMemo([handleNodeDelete]) pra que o callback de delete
// fique disponível dentro dos node views. Antes era const top-level
// e sem acesso a state do parent.

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

function FlowCanvasInner({ configId }: FlowCanvasProps) {
  const actions = useAgentActions();
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes] = React.useState<Node[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [viewport, setViewport] = React.useState({ x: 0, y: 0, zoom: 1 });
  const [enabledTools, setEnabledTools] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  // PR 21 (mai/2026): configSheetOpen removido — Sheet não é mais
  // renderizada. Forms inline dentro de cada node card.
  const [catalogs, setCatalogs] = React.useState<FlowCatalogs>(EMPTY_FLOW_CATALOGS);
  const [catalogsLoading, setCatalogsLoading] = React.useState(false);

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
  }, [history]);

  // -- Load flow --
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await actions.getFlow(configId);
        if (cancelled) return;
        if (config) {
          const { nodes: rfNodes, edges: rfEdges } = persiaToReactFlow(config);
          setNodes(rfNodes);
          setEdges(rfEdges);
          setViewport(config.viewport);
          setEnabledTools(config.enabled_tools);
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
      if (changes.some((c) => c.type !== "select")) setDirty(true);
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

  // -- Lazy load dos catálogos quando o usuário abre o primeiro node --
  const ensureCatalogsLoaded = React.useCallback(async () => {
    if (catalogsLoading) return;
    if (
      catalogs.tags.length > 0 ||
      catalogs.pipeline_stages.length > 0 ||
      catalogs.notification_templates.length > 0
    ) {
      return; // já carregado
    }
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
      setCatalogsLoading(false);
    }
  }, [actions, catalogs, catalogsLoading, configId]);

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

  // -- Sheet pediu remoção do node --
  const handleNodeDelete = React.useCallback(
    (nodeId: string) => {
      // PR 17: descobre tipo pra impedir delete acidental do entry
      // node (que é a porta única do flow — sem ele nada dispara).
      const target = nodes.find((n) => n.id === nodeId);
      if (target?.type === "entry") return;
      snapshotBeforeMutation();
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
      // PR 24: limpa seleção se o deletado era o selecionado.
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      setDirty(true);
    },
    [nodes, selectedNodeId, snapshotBeforeMutation],
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
      entry: ({ data, selected, id }) => (
        <EntryNodeView
          data={data as never}
          selected={selected}
          onPatch={(newData) => handleNodePatch(id, newData)}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      ),
      ai_agent: ({ data, selected, id }) => (
        <AIAgentNodeView
          data={data as never}
          selected={selected}
          onDelete={() => handleNodeDelete(id)}
          onDuplicate={() => handleNodeDuplicate(id)}
          onPatch={(newData) => handleNodePatch(id, newData)}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      ),
      action: ({ data, selected, id }) => (
        <ActionNodeView
          data={data as never}
          selected={selected}
          onDelete={() => handleNodeDelete(id)}
          onDuplicate={() => handleNodeDuplicate(id)}
          onPatch={(newData) => handleNodePatch(id, newData)}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      ),
      condition: ({ data, selected, id }) => (
        <ConditionNodeView
          data={data as never}
          selected={selected}
          onDelete={() => handleNodeDelete(id)}
          onDuplicate={() => handleNodeDuplicate(id)}
          onPatch={(newData) => handleNodePatch(id, newData)}
          catalogs={catalogs}
          catalogsLoading={catalogsLoading}
        />
      ),
    }),
    [handleNodeDelete, handleNodeDuplicate, handleNodePatch, catalogs, catalogsLoading],
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
  const onDragOver = React.useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(FLOW_DRAG_KEY)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const instantiateNodeAt = React.useCallback(
    (taskKey: string, screenPos: { x: number; y: number }) => {
      const item = findSidebarItem(taskKey);
      if (!item) return;
      const position = screenToFlowPosition(screenPos);
      const newNode: Node = {
        id: `node-${crypto.randomUUID()}`,
        type: item.node_type,
        position,
        data: { ...item.default_data },
      };
      snapshotBeforeMutation();
      setNodes((nds) => [...nds, newNode]);
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
      instantiateNodeAt(taskKey, { x: e.clientX, y: e.clientY });
    },
    [instantiateNodeAt],
  );

  // PR 17 UX (mai/2026): add por clique no botão + da sidebar. Em vez
  // de exigir drag-and-drop (intimidador em desktop apertado e
  // impossível em touch), aceita clique simples. Posição default
  // = centro visível do canvas (offset randomizado em 80px pra
  // múltiplos adds não empilharem).
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

  // -- Save (manual via botão + auto-save debounce) --
  const handleSave = React.useCallback(async () => {
    setSaving(true);
    try {
      const config = reactFlowToPersia(nodes, edges, viewport, enabledTools);
      const res = await actions.saveFlow(configId, config);
      setDirty(false);
      toast.success(`Fluxo salvo (versão ${res.version}).`);
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
  }, [actions, configId, edges, enabledTools, nodes, viewport]);

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
  const handleNodeDeleteRef = React.useRef(handleNodeDelete);
  const handleNodeDuplicateRef = React.useRef(handleNodeDuplicate);
  const selectedNodeIdRef = React.useRef(selectedNodeId);
  const dirtyRef = React.useRef(dirty);
  React.useEffect(() => {
    handleUndoRef.current = handleUndo;
  }, [handleUndo]);
  React.useEffect(() => {
    handleRedoRef.current = handleRedo;
  }, [handleRedo]);
  React.useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);
  React.useEffect(() => {
    handleNodeDeleteRef.current = handleNodeDelete;
  }, [handleNodeDelete]);
  React.useEffect(() => {
    handleNodeDuplicateRef.current = handleNodeDuplicate;
  }, [handleNodeDuplicate]);
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
    <div className="flex h-[calc(100vh-180px)] min-h-[600px] rounded-xl border border-border/60 overflow-hidden bg-background">
      <FlowSidebar onAdd={handleSidebarAdd} />
      <div
        ref={containerRef}
        data-persia-flow-container="true"
        className="flex-1 relative"
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
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
          onNodeClick={onNodeClick}
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
          attributionPosition="bottom-left"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls position="bottom-right" showInteractive={false} />
          {nodes.length > 5 ? <MiniMap pannable zoomable /> : null}
        </ReactFlow>
        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center max-w-md space-y-4">
              <div className="space-y-1">
                <p className="text-base font-semibold text-foreground">
                  Comece pelo primeiro passo do fluxo
                </p>
                <p className="text-xs text-muted-foreground">
                  Use os botões abaixo OU arraste um card da lateral pra
                  montar o atendimento.
                </p>
              </div>
              {/* PR 18 UX (mai/2026): CTAs explícitos como alternativa ao
                  drag (intimidador pra novos usuários). Adicionam node
                  no centro do canvas via handleSidebarAdd. */}
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSidebarAdd("entry.conversation_started")}
                >
                  Adicionar entrada
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    // Sequência: entrada + IA conectados por edge default —
                    // permite "começar a conversar" em 1 clique.
                    handleSidebarAdd("entry.conversation_started");
                    setTimeout(() => handleSidebarAdd("ai_agent.default"), 30);
                  }}
                >
                  Adicionar atendimento com IA
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                Dica: o fluxo precisa de uma entrada e pelo menos uma ação
                ou conversa com IA pra começar a responder leads.
              </p>
            </div>
          </div>
        ) : null}
      </div>
      {/* PR 21 (mai/2026): NodeConfigSheet removida do runtime —
          config foi pra inline dentro de cada node (InlineFormPanel).
          Componente Sheet continua exportando os forms, mas não é
          mais renderizado aqui. */}
    </div>
  );
}
