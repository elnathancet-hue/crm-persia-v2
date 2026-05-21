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
            // PR 23 fix (mai/2026): X estava com opacity-0 + group-hover
            // do canvas — dependia de um `group/canvas` no parent que
            // nem sempre era acertado, e quando aparecia, o `hover:scale-110`
            // movia o visual sem mover a hitbox. Resultado: usuário via o X
            // numa posição, clicava ali, e o clique caía fora. Fix:
            //   - sempre visível (opacity-70, opacity-100 em hover)
            //   - sem scale no hover (hitbox = visual)
            //   - size 6 (vs 5) com ring pra contraste em qualquer fundo
            //   - touch-friendly: hit area maior que ícone interno
            // React Flow exige `nodrag nopan` + pointer-events:auto pra
            // o botão aceitar clique (o overlay do canvas é
            // pointer-events:none por padrão).
            className="nodrag nopan absolute flex size-6 items-center justify-center rounded-full bg-background text-foreground shadow-md ring-1 ring-border opacity-70 hover:opacity-100 hover:bg-destructive hover:text-destructive-foreground hover:ring-destructive transition-colors"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "auto",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(id);
            }}
            aria-label="Remover conexão"
            title="Remover conexão"
          >
            <X className="size-3.5" strokeWidth={2.5} />
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
