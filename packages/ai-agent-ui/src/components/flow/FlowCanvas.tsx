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
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import { Loader2, Save } from "lucide-react";
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
import { NodeConfigSheet } from "./NodeConfigSheet";
import { EntryNodeView } from "./nodes/EntryNodeView";
import { AIAgentNodeView } from "./nodes/AIAgentNodeView";
import { ActionNodeView } from "./nodes/ActionNodeView";
import { ConditionNodeView } from "./nodes/ConditionNodeView";

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
  const [configSheetOpen, setConfigSheetOpen] = React.useState(false);
  const [catalogs, setCatalogs] = React.useState<FlowCatalogs>(EMPTY_FLOW_CATALOGS);
  const [catalogsLoading, setCatalogsLoading] = React.useState(false);

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

  const onConnect: OnConnect = React.useCallback((connection: Connection) => {
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
  }, []);

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

  // -- Click em node abre Sheet de config --
  const onNodeClick: NodeMouseHandler = React.useCallback(
    (_, node) => {
      setSelectedNodeId(node.id);
      setConfigSheetOpen(true);
      void ensureCatalogsLoaded();
    },
    [ensureCatalogsLoaded],
  );

  // -- Sheet salvou → update node data --
  const handleNodeSave = React.useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: newData } : n)),
      );
      setDirty(true);
    },
    [],
  );

  // -- Sheet pediu remoção do node --
  const handleNodeDelete = React.useCallback(
    (nodeId: string) => {
      // PR 17: descobre tipo pra impedir delete acidental do entry
      // node (que é a porta única do flow — sem ele nada dispara).
      const target = nodes.find((n) => n.id === nodeId);
      if (target?.type === "entry") return;
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
      setDirty(true);
    },
    [nodes],
  );

  // PR 17 UX (mai/2026): nodeTypes memoizado com handleNodeDelete
  // closure-capturado pra que cada node view possa receber onDelete.
  // Entry node NÃO recebe onDelete (proteção dupla: aqui + dentro do
  // handler). React Flow exige stable reference — useMemo evita
  // re-render dos nodes.
  const nodeTypes = React.useMemo<NodeTypes>(
    () => ({
      entry: ({ data, selected }) => (
        <EntryNodeView data={data as never} selected={selected} />
      ),
      ai_agent: ({ data, selected, id }) => (
        <AIAgentNodeView
          data={data as never}
          selected={selected}
          onDelete={() => handleNodeDelete(id)}
        />
      ),
      action: ({ data, selected, id }) => (
        <ActionNodeView
          data={data as never}
          selected={selected}
          onDelete={() => handleNodeDelete(id)}
        />
      ),
      condition: ({ data, selected, id }) => (
        <ConditionNodeView
          data={data as never}
          selected={selected}
          onDelete={() => handleNodeDelete(id)}
        />
      ),
    }),
    [handleNodeDelete],
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
      setNodes((nds) => [...nds, newNode]);
      setDirty(true);
    },
    [screenToFlowPosition],
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

  // Auto-save debounce: 2s após última edição. Não fecha o loop de save
  // — usuário pode salvar manualmente também via botão.
  React.useEffect(() => {
    if (!dirty) return;
    const handle = window.setTimeout(() => {
      void handleSave();
    }, 2000);
    return () => window.clearTimeout(handle);
  }, [dirty, handleSave]);

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
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          defaultViewport={viewport}
          onMoveEnd={(_, v) => {
            setViewport(v);
            setDirty(true);
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
      <NodeConfigSheet
        node={selectedNode}
        open={configSheetOpen}
        catalogs={catalogs}
        catalogsLoading={catalogsLoading}
        onOpenChange={setConfigSheetOpen}
        onSave={handleNodeSave}
        onDelete={handleNodeDelete}
      />
    </div>
  );
}
