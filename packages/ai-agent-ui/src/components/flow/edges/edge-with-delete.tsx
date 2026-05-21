"use client";

// AI Agent — custom edge com botão X no meio.
//
// PR 20 UX (mai/2026): inspirado no Jordan/ManyChat — usuário clica
// no X que aparece no meio da edge pra deletar a conexão SEM precisar
// abrir menu/contexto. React Flow expõe BaseEdge (curva bezier) +
// EdgeLabelRenderer (overlay HTML alinhado ao centro da edge).
//
// O callback `data.onDelete` é injetado pelo FlowCanvas via memoized
// edgeTypes (igual nodeTypes). React Flow guarda a função no `data` da
// edge — não é serializada pro JSON do flow (callbacks não persistem),
// mas é rebindada toda vez que FlowCanvas re-renderiza.

import * as React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";

export function EdgeWithDelete({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onDelete = (data as { onDelete?: (id: string) => void } | undefined)
    ?.onDelete;

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      {onDelete ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            // React Flow exige `nodrag nopan` + pointer-events:all pra
            // o botão aceitar clique (o overlay do canvas é
            // pointer-events:none por padrão).
            className="nodrag nopan absolute flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:scale-110 transition-transform opacity-0 hover:opacity-100 group-hover/canvas:opacity-100"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(id);
            }}
            aria-label="Remover conexão"
            title="Remover conexão"
          >
            <X className="size-3" />
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
