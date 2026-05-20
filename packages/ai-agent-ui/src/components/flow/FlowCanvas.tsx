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
import { FlowSidebar, FLOW_DRAG_KEY } from "./FlowSidebar";
import { findSidebarItem } from "./node-catalog";
import { EntryNodeView } from "./nodes/EntryNodeView";
import { AIAgentNodeView } from "./nodes/AIAgentNodeView";
import { ActionNodeView } from "./nodes/ActionNodeView";
import { ConditionNodeView } from "./nodes/ConditionNodeView";

// ============================================================================
// React Flow node bindings — mapeia type→component dos custom nodes
// ============================================================================

const nodeTypes: NodeTypes = {
  // Componentes recebem `{data, selected, id, ...}`. Nossos views só
  // consomem data + selected — wrapper inline injeta esses props com tipo.
  entry: ({ data, selected }) => (
    <EntryNodeView data={data as never} selected={selected} />
  ),
  ai_agent: ({ data, selected }) => (
    <AIAgentNodeView data={data as never} selected={selected} />
  ),
  action: ({ data, selected }) => (
    <ActionNodeView data={data as never} selected={selected} />
  ),
  condition: ({ data, selected }) => (
    <ConditionNodeView data={data as never} selected={selected} />
  ),
};

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
        toast.error(
          err instanceof Error ? err.message : "Falha ao carregar fluxo",
        );
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

  // -- Drag-drop do sidebar --
  const onDragOver = React.useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(FLOW_DRAG_KEY)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      const taskKey = e.dataTransfer.getData(FLOW_DRAG_KEY);
      if (!taskKey) return;
      const item = findSidebarItem(taskKey);
      if (!item) return;
      e.preventDefault();

      const position = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
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

  // -- Save (manual via botão + auto-save debounce) --
  const handleSave = React.useCallback(async () => {
    setSaving(true);
    try {
      const config = reactFlowToPersia(nodes, edges, viewport, enabledTools);
      const res = await actions.saveFlow(configId, config);
      setDirty(false);
      toast.success(`Fluxo salvo (versão ${res.version}).`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao salvar fluxo",
      );
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
      <FlowSidebar />
      <div
        ref={containerRef}
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
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center max-w-sm">
              <p className="text-sm font-medium text-foreground">
                Comece arrastando uma tarefa
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Use a sidebar à esquerda pra adicionar "Conversa iniciada" como
                ponto de partida.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
