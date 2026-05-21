// PR 25 (mai/2026): auto-layout do canvas usando Dagre.
//
// Dagre é o lib de layout DAG usado por React Flow examples oficiais
// (https://reactflow.dev/examples/layout/dagre) e por n8n. Ele recebe
// um grafo + dimensões dos nodes + direção (LR / TB) e devolve
// posições "limpas" — nodes alinhados em camadas, edges não cruzam,
// espaçamento uniforme.
//
// Por que LR (Left → Right) por default:
//   - Fluxos do tipo "atendimento" são naturalmente lineares: entry
//     no canto esquerdo → IA no meio → ações à direita. Vertical (TB)
//     seria cómodo pra fluxos curtos mas explode pra baixo em fluxos
//     grandes (Jordan = 12 nodes).
//   - Match com mental model do cliente (Jordan/ManyChat usam LR).
//
// Limitações conhecidas:
//   - Posições retornadas são "ideais" — não respeitam input do user.
//     Botão "Organizar" deve avisar antes (confirm dialog) e permitir
//     undo (já feito via useFlowHistory no PR 24).
//   - Dagre não conhece largura real do node — passamos default
//     (260px = node compact, ver node-shell). Se layout sair apertado,
//     pode aumentar NODE_WIDTH/HEIGHT pra dar mais respiro.

import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";

const NODE_WIDTH = 260;
const NODE_HEIGHT = 120;
// Espaçamento entre camadas (rank separator) — quanto maior, mais
// "respiro" entre fileiras de nodes. 120 cabe edges com label do X
// sem amontoar.
const RANK_SEP = 120;
// Espaçamento entre nodes da mesma camada (node separator).
const NODE_SEP = 60;

export type LayoutDirection = "LR" | "TB";

/**
 * Aplica layout Dagre aos nodes/edges, retornando array novo de
 * nodes com `position` recalculada. Não mutates input.
 *
 * Dagre devolve coordenadas do CENTRO do node — convertemos pro
 * canto superior esquerdo subtraindo metade da largura/altura (que
 * é o que React Flow espera).
 */
export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection = "LR",
): Node[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    // Posiciona ranks a partir do canto superior esquerdo — combina
    // com origem do React Flow viewport.
    align: "UL",
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const dagreNode = g.node(node.id);
    // Dagre retorna centro; React Flow espera top-left.
    return {
      ...node,
      position: {
        x: dagreNode.x - NODE_WIDTH / 2,
        y: dagreNode.y - NODE_HEIGHT / 2,
      },
    };
  });
}
