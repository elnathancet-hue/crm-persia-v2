"use client";

// Entry node — ponto de partida do flow. 1 saída ("default") à direita.

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { MessageSquare } from "lucide-react";
import type { FlowEntryNode } from "@persia/shared/ai-agent";
import { NodeShell } from "./node-shell";

interface Props {
  data: FlowEntryNode["data"];
  selected?: boolean;
}

export function EntryNodeView({ data, selected }: Props) {
  return (
    <>
      <NodeShell
        icon={MessageSquare}
        label={data.label || "Conversa iniciada"}
        badge="Entrada"
        variant="entry"
        selected={selected}
      >
        Dispara quando o lead manda a primeira mensagem.
      </NodeShell>
      <Handle
        type="source"
        position={Position.Right}
        id="default"
        className="!size-3 !bg-success !border-2 !border-background"
      />
    </>
  );
}
